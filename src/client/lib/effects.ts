import * as fabric from "fabric";

/*
 * Photo effects (grain, light leaks, glitch, blur, halftone, distortions…).
 *
 * Every effect is a small GLSL program run by one Fabric filter class,
 * `LumioEffect`, which picks the shader by effect id. Effects stack in order,
 * and each has its own controls (not just intensity). Spatial controls are a
 * percentage of the element's long side, so an effect looks the same on a
 * 300 px thumbnail and a 4000 px photo, and on a wide one-line text box.
 *
 * The filter is registered with Fabric, so effects save and reload with the
 * design. They need WebGL (every current browser has it); without it the
 * picture shows unchanged rather than breaking.
 */

export type ParamKind = "range" | "color" | "select";

export interface ParamDef {
  key: string;
  label: string;
  kind?: ParamKind; // default "range"
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
  /** For selects. */
  options?: { label: string; value: number }[];
  unit?: string;
}

export interface EffectDef {
  id: string;
  name: string;
  category: string;
  params: ParamDef[];
  /** GLSL body. Has `uv`, `src`, `o` (output, starts as src), `p0..p11`, helpers. */
  glsl: string;
  /**
   * How far the effect reaches past the element's edge, as a fraction of its
   * long side (blurs). Shapes and text get that much room in their cache.
   */
  spread?: (values: Record<string, number | string>) => number;
}

export interface EffectState {
  id: string;
  /** param key → number, or "#rrggbb" for colours */
  values: Record<string, number | string>;
  enabled?: boolean;
}

const r = (key: string, label: string, min: number, max: number, def: number, step = 1, unit?: string): ParamDef =>
  ({ key, label, min, max, default: def, step, unit });
const col = (key: string, label: string, def: string): ParamDef => ({ key, label, kind: "color", default: def });
const sel = (key: string, label: string, def: number, options: [string, number][]): ParamDef =>
  ({ key, label, kind: "select", default: def, options: options.map(([l, v]) => ({ label: l, value: v })) });
const seed = r("seed", "Variation", 0, 100, 7);

// ── Shared GLSL ────────────────────────────────────────────────────────

const HEADER = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uStepW;
  uniform float uStepH;
  uniform float uP[12];
  varying vec2 vTexCoord;

  vec2 px;   // one pixel, in uv
  vec2 res;  // picture size, in pixels
  vec2 S;    // uv per "1.0 = long side" unit
  float aspect;

  vec4 tex(vec2 p) { return texture2D(uTexture, clamp(p, 0.0, 1.0)); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
  vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  // Disc blur with a golden-angle spiral; radius in long-side units.
  // Same, with alpha, weighting colour by coverage so soft edges do not darken.
  vec4 discBlur4(vec2 p, float radius) {
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 48; i++) {
      float fi = float(i);
      float a = fi * 2.39996;
      float rr = sqrt((fi + 0.5) / 48.0) * radius;
      vec4 c = tex(p + vec2(cos(a), sin(a)) * rr * S);
      acc += vec4(c.rgb * c.a, c.a);
    }
    return acc.a > 0.0 ? vec4(acc.rgb / acc.a, acc.a / 48.0) : vec4(0.0);
  }
  vec3 discBlur(vec2 p, float radius) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 40; i++) {
      float fi = float(i);
      float a = fi * 2.39996;
      float rr = sqrt((fi + 0.5) / 40.0) * radius;
      acc += tex(p + vec2(cos(a), sin(a)) * rr * S).rgb;
    }
    return acc / 40.0;
  }
`;

function program(body: string) {
  return `${HEADER}
  void main() {
    px = vec2(uStepW, uStepH);
    res = 1.0 / px;
    aspect = res.x / res.y;
    S = vec2(max(res.x, res.y)) / res;
    float p0 = uP[0], p1 = uP[1], p2 = uP[2], p3 = uP[3], p4 = uP[4], p5 = uP[5];
    float p6 = uP[6], p7 = uP[7], p8 = uP[8], p9 = uP[9], p10 = uP[10], p11 = uP[11];
    vec2 uv = vTexCoord;
    vec4 src = texture2D(uTexture, uv);
    vec4 o = src;
    ${body}
    gl_FragColor = vec4(clamp(o.rgb, 0.0, 1.0), o.a);
  }`;
}

// ── The catalogue ──────────────────────────────────────────────────────
// Param order = p0, p1, … ; a colour takes three slots (r, g, b).

export const EFFECTS: EffectDef[] = [
  // Layer: made for shapes, text and graphics (work on photos too)
  { id: "layer-blur", name: "Layer blur", category: "Layer", params: [
      r("radius", "Blur", 0, 15, 3, 0.1, "%")],
    spread: (v) => Number(v.radius) / 100,
    glsl: `
      o = discBlur4(uv, p0 / 100.0);` },
  { id: "progressive-blur", name: "Progressive blur", category: "Layer", params: [
      r("angle", "Direction", 0, 360, 90, 1, "°"), r("start", "Starts at", 0, 100, 30), r("end", "Full blur at", 0, 100, 100),
      r("radius", "Max blur", 0, 15, 4, 0.1, "%")],
    spread: (v) => Number(v.radius) / 100,
    glsl: `
      vec2 dir = vec2(cos(radians(p0)), sin(radians(p0)));
      float t = dot(uv - 0.5, dir) / (abs(dir.x) * 0.5 + abs(dir.y) * 0.5) * 0.5 + 0.5;
      float m = smoothstep(p1 / 100.0, max(p2, p1 + 1.0) / 100.0, t);
      o = m > 0.001 ? discBlur4(uv, p3 / 100.0 * m) : src;` },
  { id: "noise", name: "Noise", category: "Layer", params: [
      r("amount", "Amount", 0, 100, 30), r("size", "Size", 1, 8, 1, 0.5, "px"),
      sel("color", "Colour", 0, [["Mono", 0], ["Colour", 1]]), sel("blend", "Blend", 0, [["Add", 0], ["Overlay", 1]]), seed],
    glsl: `
      vec2 b = floor(uv * res / p1) + p4 * 13.0;
      vec3 n = p2 > 0.5 ? vec3(hash(b), hash(b + 2.3), hash(b + 5.9)) : vec3(hash(b));
      vec3 c = src.rgb;
      vec3 ov = mix(2.0 * c * n, 1.0 - 2.0 * (1.0 - c) * (1.0 - n), step(0.5, c));
      o.rgb = p3 < 0.5 ? c + (n - 0.5) * p0 / 100.0 * 0.6 : mix(c, ov, p0 / 100.0);` },
  { id: "texture", name: "Texture", category: "Layer", params: [
      sel("kind", "Texture", 0, [["Canvas", 0], ["Linen", 1], ["Concrete", 2], ["Crumpled paper", 3]]),
      r("amount", "Strength", 0, 100, 50), r("scale", "Scale", 20, 300, 100), seed],
    glsl: `
      vec2 q = uv / S * 100.0 / p2;
      float t;
      if (p0 < 0.5) {
        vec2 w = q * 90.0;
        t = 0.5 + 0.25 * sin(w.x) * sin(w.y * 0.97) + (vnoise(w * 0.5) - 0.5) * 0.3;
      } else if (p0 < 1.5) {
        t = 0.5 + (vnoise(vec2(q.x * 260.0, q.y * 8.0) + p3) - 0.5) * 0.5 + (vnoise(vec2(q.x * 8.0, q.y * 260.0) + p3) - 0.5) * 0.5;
      } else if (p0 < 2.5) {
        t = fbm(q * 18.0 + p3) * 0.8 + hash(floor(q * 400.0)) * 0.25 - 0.05;
      } else {
        float f = fbm(q * 6.0 + p3);
        t = 0.5 + (abs(f - 0.5) * 2.0 - 0.35) * 0.9 + (fbm(q * 30.0) - 0.5) * 0.2;
      }
      o.rgb = src.rgb * (1.0 + (t - 0.5) * p1 / 100.0 * 1.2);` },

  // Film & analog
  { id: "grain", name: "Film grain", category: "Film & analog", params: [
      r("amount", "Amount", 0, 100, 35), r("size", "Grain size", 1, 6, 1.6, 0.1, "px"), r("rough", "Roughness", 0, 100, 50),
      sel("color", "Grain colour", 0, [["Mono", 0], ["Colour", 1]]), r("shadows", "Shadows vs highlights", -100, 100, 0), seed],
    glsl: `
      vec2 g = uv * res / p1 + p5 * 17.3;
      float n = mix(vnoise(g), hash(floor(g)), p2 / 100.0) - 0.5;
      vec3 nc = p3 > 0.5 ? vec3(vnoise(g + 1.7), vnoise(g + 5.3), vnoise(g + 9.1)) - 0.5 : vec3(n);
      float l = luma(src.rgb);
      float w = mix(1.0 - abs(l - 0.5), p4 > 0.0 ? 1.0 - l : l, abs(p4) / 100.0);
      o.rgb = src.rgb + nc * (p0 / 100.0) * 0.9 * (0.4 + w);` },
  { id: "dust", name: "Dust & scratches", category: "Film & analog", params: [
      r("dust", "Dust", 0, 100, 40), r("scratches", "Scratches", 0, 100, 35), r("size", "Speck size", 0.1, 1.5, 0.4, 0.05, "%"),
      sel("tone", "Colour", 0, [["Light", 0], ["Dark", 1]]), seed],
    glsl: `
      // Specks live on a grid sized relative to the picture, so the count is the same at any resolution.
      vec2 g = uv / S / (p2 / 100.0);
      vec2 cell = floor(g);
      float pick = step(1.0 - p0 / 100.0 * 0.006, hash(cell + p4 * 3.1));
      float shape = 1.0 - smoothstep(0.15, 0.45, length(fract(g) - 0.5 + (vec2(hash(cell + 1.3), hash(cell + 2.7)) - 0.5) * 0.3));
      float d = pick * shape;
      float colx = floor(uv.x * 260.0);
      float has = step(1.0 - p1 * 0.0018, hash(vec2(colx, p4)));
      float thin = 1.0 - smoothstep(0.0, 0.5, abs(fract(uv.x * 260.0) - 0.5) * 2.0);
      float run = smoothstep(0.35, 0.65, vnoise(vec2(colx, uv.y * 6.0 + p4)));
      float m = clamp(d + has * thin * run, 0.0, 1.0);
      o.rgb = mix(src.rgb, p3 > 0.5 ? vec3(0.05) : vec3(0.96), m * 0.85);` },
  { id: "light-leak", name: "Light leak", category: "Film & analog", params: [
      r("amount", "Intensity", 0, 100, 70), col("color", "Colour", "#ff6a2b"),
      r("x", "Position X", 0, 100, 90), r("y", "Position Y", 0, 100, 20), r("size", "Size", 5, 150, 60), r("second", "Second leak", 0, 100, 40)],
    glsl: `
      vec3 leak = vec3(p1, p2, p3);
      vec2 d = (uv - vec2(p4, p5) / 100.0); d.x *= aspect;
      float f = exp(-dot(d, d) / pow(p6 / 100.0, 2.0));
      vec2 d2 = (uv - vec2(1.0 - p4 / 100.0, 1.0 - p5 / 100.0)); d2.x *= aspect;
      float f2 = exp(-dot(d2, d2) / pow(p6 / 160.0, 2.0)) * p7 / 100.0;
      vec3 l2 = vec3(leak.b, leak.r, leak.g) * 0.6 + leak * 0.4;
      vec3 add = leak * f + l2 * f2;
      o.rgb = 1.0 - (1.0 - src.rgb) * (1.0 - clamp(add * p0 / 100.0, 0.0, 1.0));` },
  { id: "halation", name: "Halation", category: "Film & analog", params: [
      r("amount", "Intensity", 0, 100, 60), r("threshold", "Threshold", 0, 100, 70), r("radius", "Spread", 0.2, 6, 1.5, 0.1, "%"),
      col("color", "Colour", "#ff3b1f")],
    glsl: `
      float acc = 0.0;
      for (int i = 0; i < 32; i++) {
        float fi = float(i); float a = fi * 2.39996; float rr = sqrt((fi + 0.5) / 32.0) * p2 / 100.0;
        float b = luma(tex(uv + vec2(cos(a), sin(a)) * rr * S).rgb);
        acc += max(b - p1 / 100.0, 0.0) / (1.0 - p1 / 100.0 + 0.001);
      }
      float h = acc / 32.0;
      o.rgb = src.rgb + vec3(p3, p4, p5) * h * (p0 / 100.0) * 1.6;` },
  { id: "vhs", name: "VHS", category: "Film & analog", params: [
      r("shift", "Colour bleed", 0, 2, 0.5, 0.05, "%"), r("lines", "Scanlines", 0, 100, 40), r("noise", "Noise", 0, 100, 30),
      r("wobble", "Tracking wobble", 0, 100, 30), r("fade", "Washed colour", 0, 100, 35), seed],
    glsl: `
      float wob = (vnoise(vec2(uv.y * 30.0, p5)) - 0.5) * p3 / 100.0 * 0.02;
      float band = smoothstep(0.985, 1.0, fract(uv.y * 1.3 + p5 * 0.37)) * p3 / 100.0;
      vec2 u2 = uv + vec2(wob + band * 0.02, 0.0);
      vec2 sh = vec2(p0 / 100.0, 0.0) * S;
      vec3 c = vec3(tex(u2 + sh).r, tex(u2).g, tex(u2 - sh).b);
      c = mix(c, vec3(luma(c)), p4 / 250.0) * (1.0 - p4 / 400.0) + p4 / 500.0;
      float sl = sin(uv.y * res.y * 1.5708) * 0.5 + 0.5;
      c *= 1.0 - p1 / 100.0 * 0.35 * sl;
      c += (hash(uv * res + p5) - 0.5) * p2 / 100.0 * 0.35;
      c += band * 0.25;
      o.rgb = c;` },
  { id: "film-burn", name: "Film burn", category: "Film & analog", params: [
      r("amount", "Intensity", 0, 100, 60), col("color", "Colour", "#ff7a1a"), r("edge", "Edge", 0, 100, 70), r("scale", "Texture size", 1, 10, 3, 0.1), seed],
    glsl: `
      vec2 q = uv; q.x *= aspect;
      float n = fbm(q * p5 + p6);
      // 0 at the centre, 1 at the border.
      float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
      float mask = smoothstep(1.0 - p4 / 100.0 * 0.6, 1.0, edge + (n - 0.5) * 0.35);
      vec3 burn = mix(vec3(p1, p2, p3), vec3(1.0, 0.95, 0.8), smoothstep(0.6, 1.0, mask));
      o.rgb = 1.0 - (1.0 - src.rgb) * (1.0 - burn * mask * p0 / 100.0);` },

  // Glitch & digital
  { id: "rgb-split", name: "RGB split", category: "Glitch & digital", params: [
      r("amount", "Distance", 0, 6, 1, 0.05, "%"), r("angle", "Angle", 0, 360, 0, 1, "°"), sel("mode", "Channels", 0, [["Red / Blue", 0], ["Red / Cyan", 1], ["All three", 2]])],
    glsl: `
      vec2 dir = vec2(cos(radians(p1)), sin(radians(p1))) * p0 / 100.0 * S;
      if (p2 < 0.5) o.rgb = vec3(tex(uv + dir).r, src.g, tex(uv - dir).b);
      else if (p2 < 1.5) o.rgb = vec3(tex(uv + dir).r, tex(uv - dir).g, tex(uv - dir).b);
      else o.rgb = vec3(tex(uv + dir).r, tex(uv + rot(dir, 2.094)).g, tex(uv + rot(dir, 4.189)).b);` },
  { id: "glitch", name: "Glitch", category: "Glitch & digital", params: [
      r("amount", "Intensity", 0, 100, 50), r("block", "Block size", 0.5, 15, 4, 0.1, "%"), r("slices", "Slices", 0, 100, 40),
      r("shift", "Colour shift", 0, 3, 0.8, 0.05, "%"), seed],
    glsl: `
      float rows = 100.0 / p1;
      float row = floor(uv.y * rows);
      float on = step(1.0 - p2 / 100.0 * 0.6, hash(vec2(row, floor(p4))));
      float shift = (hash(vec2(row, p4 + 7.0)) - 0.5) * p0 / 100.0 * 0.25 * on;
      vec2 u2 = uv + vec2(shift, 0.0);
      vec2 cs = vec2(p3 / 100.0, 0.0) * S * on;
      vec3 c = vec3(tex(u2 + cs).r, tex(u2).g, tex(u2 - cs).b);
      vec2 blk = floor(uv * vec2(rows * aspect, rows));
      float corrupt = step(1.0 - p0 / 100.0 * 0.06, hash(blk + p4));
      c = mix(c, c.gbr * 1.2, corrupt);
      o.rgb = c;` },
  { id: "chromatic", name: "Chromatic aberration", category: "Glitch & digital", params: [
      r("amount", "Amount", 0, 100, 40), r("falloff", "Edge falloff", 0.5, 4, 2, 0.1)],
    glsl: `
      vec2 d = uv - 0.5;
      float k = pow(length(d) * 1.414, p1) * p0 / 100.0 * 0.03;
      o.rgb = vec3(tex(uv + d * k).r, src.g, tex(uv - d * k).b);` },
  { id: "pixelate", name: "Pixelate", category: "Glitch & digital", params: [
      r("size", "Pixel size", 0.3, 12, 2, 0.1, "%"), sel("shape", "Shape", 0, [["Square", 0], ["Round", 1], ["Diamond", 2]]), r("gap", "Gap", 0, 60, 0)],
    glsl: `
      vec2 cell = p0 / 100.0 * S;
      vec2 c = (floor(uv / cell) + 0.5) * cell;
      vec3 col = tex(c).rgb;
      vec2 f = (fract(uv / cell) - 0.5) * 2.0;
      float d = p1 < 0.5 ? max(abs(f.x), abs(f.y)) : p1 < 1.5 ? length(f) : abs(f.x) + abs(f.y);
      float inside = 1.0 - smoothstep(1.0 - p2 / 100.0 - 0.06, 1.0 - p2 / 100.0, d);
      o.rgb = mix(vec3(0.0), col, inside);` },
  { id: "crt", name: "CRT screen", category: "Glitch & digital", params: [
      r("lines", "Scanlines", 0, 100, 50), r("density", "Line count", 80, 900, 320), r("curve", "Curvature", 0, 100, 30),
      r("mask", "RGB mask", 0, 100, 40), r("vignette", "Vignette", 0, 100, 50)],
    glsl: `
      vec2 cc = uv * 2.0 - 1.0;
      cc *= 1.0 + p2 / 100.0 * 0.25 * dot(cc.yx, cc.yx);
      vec2 u2 = cc * 0.5 + 0.5;
      if (u2.x < 0.0 || u2.x > 1.0 || u2.y < 0.0 || u2.y > 1.0) {
        o.rgb = vec3(0.0);
      } else {
        vec3 c = tex(u2).rgb;
        float s = sin(u2.y * p1 * 3.14159) * 0.5 + 0.5;
        c *= 1.0 - p0 / 100.0 * 0.6 * (1.0 - s);
        float m = mod(floor(u2.x * res.x), 3.0);
        vec3 mk = m < 1.0 ? vec3(1.0, 0.65, 0.65) : m < 2.0 ? vec3(0.65, 1.0, 0.65) : vec3(0.65, 0.65, 1.0);
        c *= mix(vec3(1.0), mk, p3 / 100.0);
        c *= mix(1.0, smoothstep(1.5, 0.4, length(cc)), p4 / 100.0);
        o.rgb = c * (1.0 + p3 / 300.0);
      }` },
  { id: "digital-noise", name: "Digital noise", category: "Glitch & digital", params: [
      r("amount", "Amount", 0, 100, 40), r("size", "Block size", 1, 12, 1, 1, "px"), sel("color", "Colour", 1, [["Mono", 0], ["Colour", 1]]), seed],
    glsl: `
      vec2 b = floor(uv * res / p1) + p3 * 11.0;
      vec3 n = p2 > 0.5 ? vec3(hash(b), hash(b + 3.1), hash(b + 6.7)) - 0.5 : vec3(hash(b) - 0.5);
      o.rgb = src.rgb + n * p0 / 100.0 * 0.6;` },

  // Blur & focus
  { id: "lens-blur", name: "Lens blur", category: "Blur & focus", params: [
      r("radius", "Radius", 0, 8, 2, 0.1, "%"), r("bokeh", "Bokeh highlights", 0, 100, 40)],
    glsl: `
      vec3 acc = vec3(0.0); float tot = 0.0;
      for (int i = 0; i < 48; i++) {
        float fi = float(i); float a = fi * 2.39996; float rr = sqrt((fi + 0.5) / 48.0) * p0 / 100.0;
        vec3 c = tex(uv + vec2(cos(a), sin(a)) * rr * S).rgb;
        float w = 1.0 + pow(luma(c), 4.0) * p1 / 10.0;
        acc += c * w; tot += w;
      }
      o.rgb = acc / tot;` },
  { id: "tilt-shift", name: "Tilt shift", category: "Blur & focus", params: [
      r("focus", "Focus position", 0, 100, 50), r("width", "Focus band", 2, 80, 20), r("blur", "Blur", 0, 6, 2, 0.1, "%"),
      r("soft", "Transition", 1, 100, 40), r("angle", "Angle", -90, 90, 0, 1, "°"), r("pop", "Colour pop", 0, 100, 30)],
    glsl: `
      vec2 n = vec2(-sin(radians(p4)), cos(radians(p4)));
      float dist = abs(dot(uv - 0.5, n) - (p0 / 100.0 - 0.5));
      float m = smoothstep(p1 / 200.0, p1 / 200.0 + p3 / 250.0 + 0.001, dist);
      vec3 c = mix(src.rgb, discBlur(uv, p2 / 100.0 * m), step(0.001, m));
      o.rgb = mix(vec3(luma(c)), c, 1.0 + p5 / 100.0 * 0.6);` },
  { id: "zoom-blur", name: "Zoom blur", category: "Blur & focus", params: [
      r("amount", "Amount", 0, 100, 40), r("x", "Centre X", 0, 100, 50), r("y", "Centre Y", 0, 100, 50), r("clear", "Sharp centre", 0, 100, 20)],
    glsl: `
      vec2 ctr = vec2(p1, p2) / 100.0;
      vec2 d = uv - ctr; d.x *= aspect;
      float keep = smoothstep(p3 / 200.0, p3 / 200.0 + 0.2, length(d));
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 32; i++) { float t = float(i) / 31.0; acc += tex(mix(uv, ctr, t * p0 / 100.0 * 0.35 * keep)).rgb; }
      o.rgb = acc / 32.0;` },
  { id: "motion-blur", name: "Motion blur", category: "Blur & focus", params: [
      r("distance", "Distance", 0, 10, 2, 0.1, "%"), r("angle", "Angle", 0, 180, 0, 1, "°")],
    glsl: `
      vec2 dir = vec2(cos(radians(p1)), sin(radians(p1))) * p0 / 100.0 * S;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 32; i++) { float t = float(i) / 31.0 - 0.5; acc += tex(uv + dir * t).rgb; }
      o.rgb = acc / 32.0;` },
  { id: "spin-blur", name: "Spin blur", category: "Blur & focus", params: [
      r("angle", "Spin", 0, 40, 8, 0.5, "°"), r("x", "Centre X", 0, 100, 50), r("y", "Centre Y", 0, 100, 50)],
    glsl: `
      vec2 ctr = vec2(p1, p2) / 100.0;
      vec2 d = uv - ctr; d.x *= aspect;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 32; i++) {
        float t = (float(i) / 31.0 - 0.5) * radians(p0);
        vec2 q = rot(d, t); q.x /= aspect;
        acc += tex(ctr + q).rgb;
      }
      o.rgb = acc / 32.0;` },
  { id: "soft-glow", name: "Soft glow (Orton)", category: "Blur & focus", params: [
      r("amount", "Glow", 0, 100, 50), r("radius", "Softness", 0.2, 6, 1.5, 0.1, "%"), r("bright", "Brightness", 0, 100, 30), r("sat", "Saturation", 0, 100, 40)],
    glsl: `
      vec3 b = discBlur(uv, p1 / 100.0);
      b = mix(vec3(luma(b)), b, 1.0 + p3 / 100.0) * (1.0 + p2 / 200.0);
      vec3 sc = 1.0 - (1.0 - src.rgb) * (1.0 - b);
      o.rgb = mix(src.rgb, sc, p0 / 100.0);` },

  // Light & optical
  { id: "bloom", name: "Bloom", category: "Light & optical", params: [
      r("amount", "Intensity", 0, 100, 50), r("threshold", "Threshold", 0, 100, 65), r("radius", "Spread", 0.2, 8, 2, 0.1, "%"), col("tint", "Tint", "#ffffff")],
    glsl: `
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        float fi = float(i); float a = fi * 2.39996; float rr = sqrt((fi + 0.5) / 40.0) * p2 / 100.0;
        vec3 c = tex(uv + vec2(cos(a), sin(a)) * rr * S).rgb;
        acc += max(c - p1 / 100.0, 0.0);
      }
      o.rgb = src.rgb + acc / 40.0 * vec3(p3, p4, p5) * p0 / 100.0 * 3.0;` },
  { id: "god-rays", name: "Light rays", category: "Light & optical", params: [
      r("amount", "Intensity", 0, 100, 60), r("x", "Light X", 0, 100, 70), r("y", "Light Y", 0, 100, 15),
      r("length", "Length", 0, 100, 60), r("threshold", "Threshold", 0, 100, 55), col("tint", "Tint", "#fff2d0")],
    glsl: `
      vec2 ctr = vec2(p1, p2) / 100.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        float t = float(i) / 40.0;
        vec3 c = tex(mix(uv, ctr, t * p3 / 100.0)).rgb;
        acc += max(c - p4 / 100.0, 0.0) * (1.0 - t);
      }
      o.rgb = src.rgb + acc / 20.0 * vec3(p5, p6, p7) * p0 / 100.0 * 2.0;` },
  { id: "prism", name: "Prism", category: "Light & optical", params: [
      r("amount", "Split", 0, 4, 1, 0.05, "%"), r("angle", "Angle", 0, 360, 30, 1, "°"), r("rainbow", "Rainbow", 0, 100, 40), r("width", "Band width", 10, 300, 100)],
    glsl: `
      vec2 dir = vec2(cos(radians(p1)), sin(radians(p1)));
      vec2 k = dir * p0 / 100.0 * S;
      vec3 c = vec3(tex(uv + k).r, src.g, tex(uv - k).b);
      float t = dot(uv - 0.5, dir) * 100.0 / p3 + 0.5;
      vec3 rb = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
      o.rgb = mix(c, 1.0 - (1.0 - c) * (1.0 - rb * 0.6), p2 / 100.0);` },
  { id: "haze", name: "Haze / fog", category: "Light & optical", params: [
      r("amount", "Density", 0, 100, 45), col("color", "Colour", "#dfe6ee"), r("height", "From bottom", 0, 100, 60), r("scale", "Texture", 1, 10, 3, 0.1), seed],
    glsl: `
      vec2 q = uv; q.x *= aspect;
      float n = fbm(q * p5 + p6);
      float grad = mix(1.0, smoothstep(0.0, 1.0, uv.y), p4 / 100.0);
      float f = clamp((0.35 + n * 0.65) * grad * p0 / 100.0, 0.0, 1.0);
      o.rgb = mix(src.rgb, vec3(p1, p2, p3), f);` },

  // Print & graphic
  { id: "halftone", name: "Halftone", category: "Print & graphic", params: [
      r("size", "Dot size", 0.4, 6, 1.2, 0.05, "%"), r("angle", "Angle", 0, 90, 45, 1, "°"), sel("mode", "Style", 0, [["Ink on paper", 0], ["Colour dots", 1]]),
      r("contrast", "Contrast", 50, 250, 120), col("ink", "Ink", "#111111"), col("paper", "Paper", "#f5f0e6")],
    glsl: `
      float cellPx = p0 / 100.0 * max(res.x, res.y);
      vec2 pp = rot(uv * res, radians(p1)) / cellPx;
      vec2 f = fract(pp) - 0.5;
      vec2 cuv = rot((floor(pp) + 0.5) * cellPx, -radians(p1)) / res;
      vec3 cc = tex(cuv).rgb;
      float l = clamp((luma(cc) - 0.5) * p3 / 100.0 + 0.5, 0.0, 1.0);
      float rad = sqrt(1.0 - (p2 > 0.5 ? l * 0.75 : l)) * 0.62;
      float dotm = 1.0 - smoothstep(rad - 0.06, rad + 0.02, length(f));
      vec3 ink = p2 > 0.5 ? cc : vec3(p4, p5, p6);
      o.rgb = mix(vec3(p7, p8, p9), ink, dotm);` },
  { id: "risograph", name: "Risograph", category: "Print & graphic", params: [
      col("ink1", "Ink 1", "#1d4ed8"), col("ink2", "Ink 2", "#ff5c8a"), r("offset", "Misregistration", 0, 2, 0.4, 0.05, "%"),
      r("levels", "Ink levels", 2, 8, 4), r("grain", "Grain", 0, 100, 40)],
    glsl: `
      vec2 off = vec2(p6, p6 * 0.6) / 100.0 * S;
      float l1 = luma(src.rgb);
      float l2 = luma(tex(uv + off).rgb);
      float g = (hash(uv * res) - 0.5) * p8 / 100.0 * 0.5;
      float a1 = clamp(floor((1.0 - l1) * p7 + 0.5) / p7 + g, 0.0, 1.0);
      float a2 = clamp(floor((1.0 - l2) * p7 + 0.5) / p7 * 0.75 + g, 0.0, 1.0);
      vec3 c = vec3(0.97, 0.95, 0.91);
      c *= 1.0 - a1 * (1.0 - vec3(p0, p1, p2));
      c *= 1.0 - a2 * (1.0 - vec3(p3, p4, p5));
      o.rgb = c;` },
  { id: "dither", name: "Dither", category: "Print & graphic", params: [
      r("levels", "Colours per channel", 2, 8, 2), r("size", "Pixel size", 1, 8, 2, 1, "px"), sel("mode", "Colour", 0, [["Mono", 0], ["Colour", 1]]),
      col("dark", "Dark", "#14121f"), col("light", "Light", "#e8f0d8")],
    glsl: `
      vec2 pp = floor(uv * res / p1);
      vec3 c = tex((pp + 0.5) * p1 * px).rgb;
      vec2 a = pp;
      vec2 a2 = floor(a * 0.5);
      float b2a = fract(dot(a2, vec2(0.5, a2.y * 0.75)));
      float b2b = fract(dot(floor(a), vec2(0.5, floor(a.y) * 0.75)));
      float t = b2a * 0.25 + b2b - 0.5;
      if (p2 < 0.5) {
        float l = floor(luma(c) * (p0 - 1.0) + 0.5 + t) / (p0 - 1.0);
        o.rgb = mix(vec3(p3, p4, p5), vec3(p6, p7, p8), clamp(l, 0.0, 1.0));
      } else {
        o.rgb = floor(c * (p0 - 1.0) + 0.5 + t) / (p0 - 1.0);
      }` },
  { id: "posterize", name: "Posterize", category: "Print & graphic", params: [
      r("levels", "Levels", 2, 12, 4), r("sat", "Saturation", 0, 200, 120), r("smooth", "Smooth steps", 0, 100, 0)],
    glsl: `
      vec3 c = mix(vec3(luma(src.rgb)), src.rgb, p1 / 100.0);
      vec3 q = c * (p0 - 1.0);
      vec3 fl = floor(q);
      vec3 st = fl + smoothstep(0.5 - p2 / 200.0, 0.5 + p2 / 200.0 + 0.0001, q - fl);
      o.rgb = st / (p0 - 1.0);` },
  { id: "photocopy", name: "Photocopy", category: "Print & graphic", params: [
      r("threshold", "Threshold", 0, 100, 50), r("soft", "Softness", 0, 100, 25), r("noise", "Toner noise", 0, 100, 45), col("ink", "Toner", "#141414"), col("paper", "Paper", "#f4f1ea")],
    glsl: `
      float l = luma(src.rgb) + (vnoise(uv * res * 0.35) - 0.5) * p2 / 100.0 * 0.35 + (hash(uv * res) - 0.5) * p2 / 100.0 * 0.2;
      float v = smoothstep(p0 / 100.0 - p1 / 500.0 - 0.001, p0 / 100.0 + p1 / 500.0 + 0.001, l);
      o.rgb = mix(vec3(p3, p4, p5), vec3(p6, p7, p8), v);` },
  { id: "paper", name: "Paper texture", category: "Print & graphic", params: [
      r("amount", "Texture", 0, 100, 45), r("scale", "Grain scale", 1, 20, 6, 0.5), r("fibers", "Fibres", 0, 100, 40), col("tint", "Paper tint", "#f3ead8"), r("tintAmt", "Tint", 0, 100, 30)],
    glsl: `
      vec2 q = uv; q.x *= aspect;
      float n = fbm(q * p1 * 20.0);
      float fib = vnoise(vec2(q.x * p1 * 4.0, q.y * p1 * 60.0));
      float t = (n - 0.5) * 0.6 + (fib - 0.5) * p2 / 100.0 * 0.4;
      vec3 c = mix(src.rgb, src.rgb * vec3(p3, p4, p5), p6 / 100.0);
      o.rgb = c * (1.0 + t * p0 / 100.0);` },

  // Colour & tone
  { id: "solarize", name: "Solarize", category: "Colour & tone", params: [
      r("threshold", "Threshold", 0, 100, 50), r("amount", "Mix", 0, 100, 100), sel("mode", "Channels", 0, [["All", 0], ["Luminance", 1]])],
    glsl: `
      vec3 c = src.rgb;
      vec3 s = p2 < 0.5 ? mix(c, 1.0 - c, step(p0 / 100.0, c)) : (luma(c) > p0 / 100.0 ? 1.0 - c : c);
      o.rgb = mix(c, s, p1 / 100.0);` },
  { id: "thermal", name: "Thermal / infrared", category: "Colour & tone", params: [
      sel("mode", "Style", 0, [["Thermal", 0], ["Infrared", 1], ["Night vision", 2]]), r("amount", "Mix", 0, 100, 100), r("contrast", "Contrast", 50, 250, 120)],
    glsl: `
      float l = clamp((luma(src.rgb) - 0.5) * p2 / 100.0 + 0.5, 0.0, 1.0);
      vec3 c;
      if (p0 < 0.5) {
        c = l < 0.25 ? mix(vec3(0.0, 0.0, 0.2), vec3(0.4, 0.0, 0.7), l * 4.0)
          : l < 0.5 ? mix(vec3(0.4, 0.0, 0.7), vec3(0.95, 0.1, 0.2), (l - 0.25) * 4.0)
          : l < 0.75 ? mix(vec3(0.95, 0.1, 0.2), vec3(1.0, 0.75, 0.0), (l - 0.5) * 4.0)
          : mix(vec3(1.0, 0.75, 0.0), vec3(1.0, 1.0, 0.9), (l - 0.75) * 4.0);
      } else if (p0 < 1.5) {
        vec3 s = src.rgb;
        float foliage = clamp(s.g * 1.6 - s.r * 0.4 - s.b * 0.4, 0.0, 1.0);
        c = mix(vec3(l * 0.9), vec3(1.0, 0.92, 0.95), foliage);
        c = mix(c, vec3(c.r, c.g * 0.85, c.b * 1.1), 0.5);
      } else {
        c = vec3(0.1, 1.0, 0.25) * l * 1.2 + (hash(uv * res) - 0.5) * 0.08;
      }
      o.rgb = mix(src.rgb, c, p1 / 100.0);` },
  { id: "bleach", name: "Bleach bypass", category: "Colour & tone", params: [
      r("amount", "Amount", 0, 100, 70), r("contrast", "Contrast", 0, 100, 50)],
    glsl: `
      vec3 c = src.rgb;
      float l = luma(c);
      vec3 ov = l < 0.5 ? 2.0 * c * l : 1.0 - 2.0 * (1.0 - c) * (1.0 - l);
      ov = mix(ov, vec3(luma(ov)), 0.35);
      ov = (ov - 0.5) * (1.0 + p1 / 100.0 * 0.5) + 0.5;
      o.rgb = mix(c, ov, p0 / 100.0);` },
  { id: "color-isolate", name: "Colour isolation", category: "Colour & tone", params: [
      col("keep", "Keep colour", "#e63b2e"), r("range", "Range", 5, 120, 35), r("soft", "Softness", 0, 100, 40), r("bg", "Background saturation", 0, 100, 0)],
    glsl: `
      vec3 k = vec3(p0, p1, p2);
      vec3 a = normalize(src.rgb - luma(src.rgb) + 0.0001);
      vec3 b = normalize(k - luma(k) + 0.0001);
      float ang = degrees(acos(clamp(dot(a, b), -1.0, 1.0)));
      float chroma = length(src.rgb - luma(src.rgb));
      float keep = (1.0 - smoothstep(p3 * 0.5, p3 * 0.5 + p4 + 0.001, ang)) * smoothstep(0.02, 0.08, chroma);
      vec3 grey = mix(vec3(luma(src.rgb)), src.rgb, p5 / 100.0);
      o.rgb = mix(grey, src.rgb, keep);` },

  // Artistic
  { id: "sketch", name: "Pencil sketch", category: "Artistic", params: [
      r("strength", "Line strength", 0, 100, 60), r("width", "Line width", 0.5, 4, 1, 0.1, "px"), r("shade", "Shading", 0, 100, 30),
      sel("color", "Colour", 0, [["Graphite", 0], ["Coloured pencil", 1]]), r("paper", "Paper grain", 0, 100, 25)],
    glsl: `
      vec2 s = px * p1;
      float tl = luma(tex(uv + s * vec2(-1.0, -1.0)).rgb), tc = luma(tex(uv + s * vec2(0.0, -1.0)).rgb), tr = luma(tex(uv + s * vec2(1.0, -1.0)).rgb);
      float ml = luma(tex(uv + s * vec2(-1.0, 0.0)).rgb), mr = luma(tex(uv + s * vec2(1.0, 0.0)).rgb);
      float bl = luma(tex(uv + s * vec2(-1.0, 1.0)).rgb), bc = luma(tex(uv + s * vec2(0.0, 1.0)).rgb), br = luma(tex(uv + s * vec2(1.0, 1.0)).rgb);
      float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
      float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
      float e = length(vec2(gx, gy));
      float line = 1.0 - clamp(e * p0 / 100.0 * 3.0, 0.0, 1.0);
      vec3 base = mix(vec3(1.0), p3 > 0.5 ? src.rgb : vec3(luma(src.rgb)), p2 / 100.0);
      float grain = 1.0 - (hash(uv * res) * 0.5 + vnoise(uv * res * 0.3) * 0.5) * p4 / 100.0 * 0.25;
      o.rgb = base * line * grain;` },
  { id: "cartoon", name: "Cartoon", category: "Artistic", params: [
      r("levels", "Colour levels", 2, 10, 5), r("edges", "Outline strength", 0, 100, 60), r("width", "Outline width", 0.5, 4, 1.2, 0.1, "px"), r("sat", "Saturation", 0, 200, 130)],
    glsl: `
      vec2 s = px * p2;
      float tl = luma(tex(uv + s * vec2(-1.0, -1.0)).rgb), tr = luma(tex(uv + s * vec2(1.0, -1.0)).rgb);
      float bl = luma(tex(uv + s * vec2(-1.0, 1.0)).rgb), br = luma(tex(uv + s * vec2(1.0, 1.0)).rgb);
      float e = length(vec2(tr + br - tl - bl, bl + br - tl - tr));
      vec3 c = mix(vec3(luma(src.rgb)), src.rgb, p3 / 100.0);
      c = floor(c * (p0 - 1.0) + 0.5) / (p0 - 1.0);
      o.rgb = c * (1.0 - smoothstep(0.08, 0.25, e * p1 / 100.0 * 2.0));` },
  { id: "oil", name: "Oil paint", category: "Artistic", params: [
      r("brush", "Brush size", 0.5, 4, 1.5, 0.1, "px"), r("detail", "Texture", 0, 100, 40)],
    glsl: `
      vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
      vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
      for (int j = 0; j < 4; j++) {
        for (int i = 0; i < 4; i++) {
          vec2 o2 = vec2(float(i), float(j)) * px * p0;
          vec3 c0 = tex(uv + o2 * vec2(-1.0, -1.0)).rgb; m0 += c0; s0 += c0 * c0;
          vec3 c1 = tex(uv + o2 * vec2(1.0, -1.0)).rgb;  m1 += c1; s1 += c1 * c1;
          vec3 c2 = tex(uv + o2 * vec2(-1.0, 1.0)).rgb;  m2 += c2; s2 += c2 * c2;
          vec3 c3 = tex(uv + o2).rgb;                    m3 += c3; s3 += c3 * c3;
        }
      }
      m0 /= 16.0; m1 /= 16.0; m2 /= 16.0; m3 /= 16.0;
      float v0 = dot(s0 / 16.0 - m0 * m0, vec3(1.0)), v1 = dot(s1 / 16.0 - m1 * m1, vec3(1.0));
      float v2 = dot(s2 / 16.0 - m2 * m2, vec3(1.0)), v3 = dot(s3 / 16.0 - m3 * m3, vec3(1.0));
      vec3 c = m0; float v = v0;
      if (v1 < v) { c = m1; v = v1; }
      if (v2 < v) { c = m2; v = v2; }
      if (v3 < v) { c = m3; }
      float canvasTex = (vnoise(uv * res * 0.25) - 0.5) * p1 / 100.0 * 0.15;
      o.rgb = c + canvasTex;` },
  { id: "emboss", name: "Emboss", category: "Artistic", params: [
      r("strength", "Depth", 0, 100, 60), r("angle", "Light angle", 0, 360, 135, 1, "°"), r("mix", "Keep colour", 0, 100, 0)],
    glsl: `
      vec2 d = vec2(cos(radians(p1)), sin(radians(p1))) * px * 1.5;
      float v = 0.5 + (luma(tex(uv - d).rgb) - luma(tex(uv + d).rgb)) * p0 / 100.0 * 4.0;
      vec3 relief = vec3(v);
      o.rgb = mix(relief, src.rgb * (v + 0.5), p2 / 100.0);` },

  // Distortion
  { id: "bulge", name: "Bulge / pinch", category: "Distortion", params: [
      r("amount", "Amount", -90, 150, 60), r("radius", "Radius", 5, 100, 45), r("x", "Centre X", 0, 100, 50), r("y", "Centre Y", 0, 100, 50)],
    glsl: `
      vec2 c = vec2(p2, p3) / 100.0;
      vec2 d = uv - c; d.x *= aspect;
      float rr = length(d);
      float R = p1 / 100.0;
      if (rr < R) {
        float t = max(rr / R, 0.0001);
        d *= pow(t, p0 / 100.0);
        d.x /= aspect;
        o = tex(c + d);
      }` },
  { id: "twirl", name: "Twirl", category: "Distortion", params: [
      r("angle", "Angle", -720, 720, 180, 1, "°"), r("radius", "Radius", 5, 100, 50), r("x", "Centre X", 0, 100, 50), r("y", "Centre Y", 0, 100, 50)],
    glsl: `
      vec2 c = vec2(p2, p3) / 100.0;
      vec2 d = uv - c; d.x *= aspect;
      float R = p1 / 100.0;
      float t = max(0.0, 1.0 - length(d) / R);
      d = rot(d, radians(p0) * t * t);
      d.x /= aspect;
      o = tex(c + d);` },
  { id: "ripple", name: "Ripple / wave", category: "Distortion", params: [
      r("amp", "Amplitude", 0, 5, 1, 0.05, "%"), r("wave", "Wavelength", 1, 50, 8, 0.5, "%"), sel("dir", "Direction", 2, [["Horizontal", 0], ["Vertical", 1], ["Circular", 2]]),
      r("phase", "Phase", 0, 360, 0, 1, "°")],
    glsl: `
      float k = 6.28318 / (p1 / 100.0);
      vec2 q = uv / S;
      vec2 off;
      if (p2 < 0.5) off = vec2(0.0, sin(q.x * k + radians(p3)));
      else if (p2 < 1.5) off = vec2(sin(q.y * k + radians(p3)), 0.0);
      else { vec2 d = q - 0.5 / S; off = normalize(d + 0.0001) * sin(length(d) * k + radians(p3)); }
      o = tex(uv + off * p0 / 100.0 * S);` },
  { id: "kaleidoscope", name: "Kaleidoscope", category: "Distortion", params: [
      r("segments", "Segments", 2, 16, 6), r("rotate", "Rotation", 0, 360, 0, 1, "°"), r("zoom", "Zoom", 30, 200, 100)],
    glsl: `
      vec2 d = uv - 0.5; d.x *= aspect;
      float rr = length(d) * 100.0 / p2;
      float a = atan(d.y, d.x) + radians(p1);
      float seg = 6.28318 / floor(p0);
      a = mod(a, seg);
      a = abs(a - seg * 0.5);
      vec2 q = vec2(cos(a), sin(a)) * rr;
      q.x /= aspect;
      o = tex(q + 0.5);` },
  { id: "mirror", name: "Mirror", category: "Distortion", params: [
      sel("axis", "Mirror", 0, [["Left onto right", 0], ["Right onto left", 1], ["Top onto bottom", 2], ["Bottom onto top", 3], ["Four-way", 4]])],
    glsl: `
      vec2 q = uv;
      if (p0 < 0.5) q.x = q.x > 0.5 ? 1.0 - q.x : q.x;
      else if (p0 < 1.5) q.x = q.x < 0.5 ? 1.0 - q.x : q.x;
      else if (p0 < 2.5) q.y = q.y > 0.5 ? 1.0 - q.y : q.y;
      else if (p0 < 3.5) q.y = q.y < 0.5 ? 1.0 - q.y : q.y;
      else q = 0.5 - abs(q - 0.5);
      o = tex(q);` },
  { id: "glass", name: "Frosted glass", category: "Distortion", params: [
      r("amount", "Distortion", 0, 3, 0.6, 0.05, "%"), r("scale", "Texture size", 0.2, 5, 1, 0.1, "%"), r("frost", "Frost", 0, 100, 30)],
    glsl: `
      vec2 q = uv / S / (p1 / 100.0);
      vec2 off = vec2(vnoise(q) - 0.5, vnoise(q + 9.7) - 0.5) + (vec2(hash(uv * res), hash(uv * res + 3.3)) - 0.5) * 0.5;
      vec3 c = tex(uv + off * p0 / 100.0 * S * 2.0).rgb;
      o.rgb = mix(c, vec3(1.0), p2 / 100.0 * 0.35);` },
];

export const EFFECT_CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))];
const BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));
export const findEffect = (id: string) => BY_ID.get(id);

export function defaultValues(def: EffectDef): Record<string, number | string> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Values → the 12 shader slots, in param order (colours take three). */
export function packParams(def: EffectDef, values: Record<string, number | string>): number[] {
  const out: number[] = [];
  for (const p of def.params) {
    const v = values[p.key] ?? p.default;
    if (p.kind === "color") out.push(...hexToRgb(String(v)));
    else out.push(Number(v));
  }
  while (out.length < 12) out.push(0);
  return out.slice(0, 12);
}

// ── Fabric filter ──────────────────────────────────────────────────────

export class LumioEffect extends fabric.filters.BaseFilter<"LumioEffect", { effect: string; p: number[] }> {
  declare effect: string;
  declare p: number[];

  static type = "LumioEffect";
  static defaults: Record<string, unknown> = { effect: "grain", p: new Array(12).fill(0) };
  static uniformLocations = ["uP"];

  getCacheKey() {
    return `LumioEffect:${this.effect}`;
  }

  getFragmentSource() {
    const def = findEffect(this.effect);
    return program(def ? def.glsl : "");
  }

  sendUniformData(gl: WebGLRenderingContext, u: fabric.TWebGLUniformLocationMap) {
    gl.uniform1fv(u.uP, new Float32Array(this.p.length === 12 ? this.p : [...this.p, ...new Array(12).fill(0)].slice(0, 12)));
  }

  /** Without WebGL the picture is left as it is. */
  applyTo2d() {}

  isNeutralState() {
    return !findEffect(this.effect);
  }
}

fabric.classRegistry.setClass(LumioEffect);

/** How far the enabled effects reach past an element's edge (fraction of its long side). */
export function effectsSpread(effects: EffectState[] | undefined): number {
  let total = 0;
  for (const e of effects ?? []) {
    if (e.enabled === false) continue;
    const def = findEffect(e.id);
    if (def?.spread) total += def.spread({ ...defaultValues(def), ...e.values });
  }
  return total;
}

export function effectFilters(effects: EffectState[] | undefined): fabric.filters.BaseFilter<string>[] {
  return (effects ?? [])
    .filter((e) => e.enabled !== false && findEffect(e.id))
    .map((e) => new LumioEffect({ effect: e.id, p: packParams(findEffect(e.id)!, e.values) }));
}

/**
 * Previews an effect on a small copy of the picture, through the same WebGL
 * pipeline as the canvas, so the tile shows exactly what applying it does.
 */
export function renderEffectPreview(source: HTMLCanvasElement, def: EffectDef): string {
  const img = new fabric.FabricImage(source);
  img.filters = [new LumioEffect({ effect: def.id, p: packParams(def, defaultValues(def)) })];
  img.applyFilters();
  const el = img.getElement() as HTMLCanvasElement;
  const url = el.toDataURL("image/jpeg", 0.8);
  // Previews are one-offs: drop their GPU texture straight away.
  const backend = fabric.getFilterBackend() as { evictCachesForKey?: (k: string) => void };
  backend.evictCachesForKey?.(img.cacheKey);
  return url;
}
