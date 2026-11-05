import type { EffectState, MagicDef, ParamDef } from "./effects";
import { CUSTOM_ROW, RAMPS, ROWS } from "./glyph-atlas";

/*
 * Magic Effects: looks that turn a picture into something else entirely.
 * The catalogue follows ascii-magic.com's 10 style families (ASCII & Text,
 * Pixel & Blocks, Print & Paper, Geometric, Glass, Light & Color, Material,
 * Glitch, Blur, Distort), plus its one-click Recipes, which here are stacks of
 * effects.
 *
 * Everything runs through the same `LumioEffect` filter as the other effects,
 * so it stacks, saves with the design and exports the same way. Some entries
 * are variants (`alias`) of another effect with their own defaults. All of
 * them are still images: anything that would animate takes a Variation (seed)
 * instead. Floyd–Steinberg/Atkinson error diffusion cannot run in a single
 * GPU pass, so "Diffusion" dithering uses a blue-noise pattern that looks
 * close to it.
 */

const r = (key: string, label: string, min: number, max: number, def: number, step = 1, unit?: string): ParamDef =>
  ({ key, label, min, max, default: def, step, unit });
const col = (key: string, label: string, def: string): ParamDef => ({ key, label, kind: "color", default: def });
const sel = (key: string, label: string, def: number, options: [string, number][]): ParamDef =>
  ({ key, label, kind: "select", default: def, options: options.map(([l, v]) => ({ label: l, value: v })) });
const onOff = (key: string, label: string, def = 0) => sel(key, label, def, [["Off", 0], ["On", 1]]);
const seed = r("seed", "Variation", 0, 100, 7);
const contrast = (def = 120) => r("contrast", "Contrast", 50, 250, def);
const invert = onOff("invert", "Invert");
const ramps = RAMPS.map((ramp, i) => [ramp.name, i] as [string, number]);

// ── Dither palettes (generated into GLSL) ─────────────────────────────
// Index 0 = Ink & paper and 4 = Original colours are handled in the shader.
const PALETTES: [string, string[]][] = [
  ["Ink & paper", []],
  ["Game Boy", ["0f380f", "306230", "8bac0f", "9bbc0f"]],
  ["CGA", ["000000", "aa00aa", "55ffff", "ffffff"]],
  ["1-bit", ["000000", "ffffff"]],
  ["Original", []],
  ["C64", ["000000", "ffffff", "880000", "aaffee", "cc44cc", "00cc55", "0000aa", "eeee77", "dd8855", "664400", "ff7777", "333333", "777777", "aaff66", "0088ff", "bbbbbb"]],
  ["PICO-8", ["000000", "1d2b53", "7e2553", "008751", "ab5236", "5f574f", "c2c3c7", "fff1e8", "ff004d", "ffa300", "ffec27", "00e436", "29adff", "83769c", "ff77a8", "ffccaa"]],
  ["Sepia", ["2b1d0e", "6b4a2b", "a87d50", "dcc49a", "f4e9d0"]],
  ["Game Boy Pocket", ["000000", "555555", "aaaaaa", "ffffff"]],
  ["ZX Spectrum", ["000000", "0000d7", "d70000", "d700d7", "00d700", "00d7d7", "d7d700", "d7d7d7", "0000ff", "ff0000", "ff00ff", "00ff00", "00ffff", "ffff00", "ffffff"]],
  ["NES", ["000000", "7c7c7c", "bcbcbc", "fcfcfc", "0000fc", "0078f8", "3cbcfc", "a4e4fc", "940084", "d800cc", "f878f8", "a81000", "f83800", "fca044", "00a800", "b8f818"]],
  ["Amber monitor", ["1a0d00", "7a3d00", "ff9a00", "ffd28a"]],
  ["Green monitor", ["001a05", "006b1d", "1aff5a", "b8ffc8"]],
  ["Vaporwave", ["1a1033", "4b1d6b", "ff2e97", "ff9de2", "2de2e6", "f7f7ff"]],
  ["Warm vintage", ["2d2a24", "5b4a3a", "9a7b4f", "d9b779", "f0e3c0", "7d8a5a"]],
  ["Cyanotype", ["0b2447", "19376d", "576cbc", "a5d7e8", "f2f6ff"]],
  ["Apple II", ["040404", "6c2940", "403578", "d93cf0", "135740", "808080", "2697f0", "bfb4f8", "404b07", "d9680f", "eca8bf", "26c30f", "bfca87", "93d6bf", "ffffff"]],
];
const v3 = (hex: string) => {
  const n = parseInt(hex, 16);
  return `vec3(${(((n >> 16) & 255) / 255).toFixed(3)}, ${(((n >> 8) & 255) / 255).toFixed(3)}, ${((n & 255) / 255).toFixed(3)})`;
};
const PALETTE_GLSL = `
  vec3 palCol(float p, float i) {
    ${PALETTES.map(([, cs], k) => cs.length
      ? `if (p > ${k - 0.5} && p < ${k + 0.5}) { ${cs.map((c, j) => `if (i < ${j + 0.5}) return ${v3(c)};`).join(" ")} return ${v3(cs[cs.length - 1])}; }`
      : "").join("\n    ")}
    return vec3(i);
  }
  float palCount(float p) {
    ${PALETTES.map(([, cs], k) => (cs.length ? `if (p > ${k - 0.5} && p < ${k + 0.5}) return ${cs.length}.0;` : "")).join(" ")}
    return 2.0;
  }
  vec3 nearestPal(vec3 c, float p) {
    float n = palCount(p);
    vec3 best = vec3(0.0); float bd = 1e9;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= n) break;
      vec3 q = palCol(p, float(i));
      vec3 d = c - q;
      float dd = dot(d * d, vec3(0.3, 0.59, 0.11));
      if (dd < bd) { bd = dd; best = q; }
    }
    return best;
  }`;

const COMMON = `
  float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
  float ign(vec2 a) { return fract(52.9829189 * fract(dot(floor(a), vec2(0.06711056, 0.00583715)))); }
  float tone(float l, float c) { return clamp((l - 0.5) * c / 100.0 + 0.5, 0.0, 1.0); }
  // Glyph idx (0 = emptiest … 15 = fullest) of character set \`ramp\`, at cell position f (0..1).
  float glyph(float ramp, float idx, vec2 f) {
    f = clamp(f, 0.03, 0.97);
    return texture2D(uAtlas, vec2((idx + f.x) / 16.0, (ramp + f.y) / ${ROWS}.0)).r;
  }
  float sobel(vec2 p, vec2 s) {
    float tl = luma(tex(p + s * vec2(-1.0, -1.0)).rgb), tc = luma(tex(p + s * vec2(0.0, -1.0)).rgb), tr = luma(tex(p + s * vec2(1.0, -1.0)).rgb);
    float ml = luma(tex(p + s * vec2(-1.0, 0.0)).rgb), mr = luma(tex(p + s * vec2(1.0, 0.0)).rgb);
    float bl = luma(tex(p + s * vec2(-1.0, 1.0)).rgb), bc = luma(tex(p + s * vec2(0.0, 1.0)).rgb), br = luma(tex(p + s * vec2(1.0, 1.0)).rgb);
    return length(vec2(-tl - 2.0 * ml - bl + tr + 2.0 * mr + br, -tl - 2.0 * tc - tr + bl + 2.0 * bc + br));
  }
  vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.31)); }
  vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
  // Pointy-top hex grid: xy = position inside the hex, zw = hex centre.
  vec4 hexGrid(vec2 p) {
    vec2 rr = vec2(1.0, 1.7320508); vec2 h = rr * 0.5;
    vec2 a = mod(p, rr) - h; vec2 b = mod(p - h, rr) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec4(gv, p - gv);
  }
  float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
  // Voronoi in cell units: nearest point (absolute), distances to the nearest two.
  void voronoi(vec2 g, float jit, float sd, out vec2 best, out float d1, out float d2) {
    vec2 id = floor(g), f = fract(g);
    d1 = 8.0; d2 = 8.0; best = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 pt = nb + 0.5 + (hash2(id + nb + sd * 1.7) - 0.5) * jit;
        float d = length(pt - f);
        if (d < d1) { d2 = d1; d1 = d; best = id + pt; } else if (d < d2) { d2 = d; }
      }
    }
  }
  vec3 heat(float t) {
    t = clamp(t, 0.0, 1.0);
    return t < 0.25 ? mix(vec3(0.0, 0.0, 0.15), vec3(0.45, 0.0, 0.7), t * 4.0)
      : t < 0.5 ? mix(vec3(0.45, 0.0, 0.7), vec3(0.95, 0.1, 0.2), (t - 0.25) * 4.0)
      : t < 0.75 ? mix(vec3(0.95, 0.1, 0.2), vec3(1.0, 0.75, 0.0), (t - 0.5) * 4.0)
      : mix(vec3(1.0, 0.75, 0.0), vec3(1.0, 1.0, 0.9), (t - 0.75) * 4.0);
  }
`;

const ASCII_FNS = `
  // Backdrop blur by type: 1 Gaussian, 2 Lens, 3 Tilt-shift, 4 Directional, 5 Radial, 6 Zoom, 7 Glassy.
  vec3 blurKind(vec2 p, float kind, float amt, float focus) {
    float a = amt / 100.0;
    vec2 d = (p - 0.5) * vec2(aspect, 1.0);
    float keep = smoothstep(focus / 200.0, focus / 200.0 + 0.25, length(d));
    if (kind < 1.5) return discBlur(p, a * 0.04);
    if (kind < 2.5) {
      vec3 acc = vec3(0.0); float tot = 0.0;
      for (int i = 0; i < 40; i++) {
        float fi = float(i); float an = fi * 2.39996; float rr = sqrt((fi + 0.5) / 40.0) * a * 0.05;
        vec3 c = tex(p + vec2(cos(an), sin(an)) * rr * S).rgb; float w = 1.0 + pow(luma(c), 4.0) * 4.0;
        acc += c * w; tot += w;
      }
      return acc / tot;
    }
    if (kind < 3.5) return discBlur(p, a * 0.05 * smoothstep(focus / 400.0, focus / 400.0 + 0.2, abs(p.y - 0.5)));
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      float t = float(i) / 23.0 - 0.5;
      vec2 q = p;
      if (kind < 4.5) q = p + vec2(t * a * 0.08, 0.0) * S;
      else if (kind < 5.5) { vec2 dd = rot(d, t * a * 0.4 * keep); dd.x /= aspect; q = 0.5 + dd; }
      else if (kind < 6.5) q = mix(p, vec2(0.5), (t + 0.5) * a * 0.3 * keep);
      else q = p + (vec2(vnoise(p / S * 40.0 + t * 3.0), vnoise(p / S * 40.0 + 9.0 + t * 3.0)) - 0.5) * a * 0.04 * S;
      acc += tex(q).rgb;
    }
    return acc / 24.0;
  }
`;

// The full ASCII engine. 24 shader slots.
const sec = (section: string, p: ParamDef): ParamDef => ({ ...p, section });
const ASCII_PARAMS: ParamDef[] = [
  sec("Characters", r("cols", "Columns (font size)", 20, 300, 100)),
  sel("ramp", "Character set", 0, ramps),
  { key: "chars", label: "Custom characters", kind: "text", default: "" },
  sel("color", "Character colour", 1, [["Ink", 0], ["Original", 1]]),
  col("ink", "Ink", "#e8f5e0"),
  sel("blend", "Blend mode", 0, [["Normal", 0], ["Overlay", 1], ["Colour dodge", 2], ["Screen", 3], ["Lighter", 4]]),
  r("charOpacity", "Character opacity", 0, 100, 100),
  onOff("invert", "Invert mapping"),
  onOff("dotGrid", "Dot grid overlay"),
  onOff("random", "Randomise characters"),
  r("uniformity", "Uniformity", 0, 100, 100),
  sec("Intensity", r("coverage", "Coverage", 0, 100, 100)),
  r("brightness", "Brightness", -100, 100, 0),
  r("contrast", "Contrast", -100, 100, 20),
  sec("Backdrop", sel("backdrop", "Mode", 0, [["Blurred image", 0], ["Solid colour", 1], ["Original image", 2], ["None (transparent)", 3]])),
  col("paper", "Backdrop colour", "#000000"),
  r("softness", "Softness", 0, 100, 25),
  r("bdOpacity", "Opacity", 0, 100, 35),
  sec("Blur", sel("blur", "Type", 0, [["Off", 0], ["Gaussian", 1], ["Lens", 2], ["Tilt-shift", 3], ["Directional", 4], ["Radial", 5], ["Zoom", 6], ["Glassy", 7]])),
  r("blurAmount", "Amount", 0, 100, 35),
  r("focus", "Focus", 0, 100, 50),
];
// Slots: p0 cols, p1 ramp, p2 color, p3-5 ink, p6 blend, p7 charOpacity, p8 invert, p9 dotGrid, p10 random,
// p11 uniformity, p12 coverage, p13 brightness, p14 contrast, p15 backdrop, p16-18 paper, p19 softness,
// p20 bdOpacity, p21 blur, p22 blurAmount, p23 focus.
const ASCII_GLSL = `
  float cw = 1.0 / p0;
  vec2 cell = vec2(cw, cw * res.x / res.y / 0.75);
  vec2 id = floor(uv / cell);
  vec2 f = fract(uv / cell);
  vec4 cs = tex((id + 0.5) * cell);
  float l = clamp((luma(cs.rgb) - 0.5) * (1.0 + p14 / 50.0) + 0.5 + p13 / 100.0, 0.0, 1.0);
  if (p8 > 0.5) l = 1.0 - l;
  float rampSel = uCustom > 0.5 ? ${CUSTOM_ROW}.0 : p1;
  float idx = floor(l * 15.99);
  if (p10 > 0.5 && idx > 0.5) idx = floor(1.0 + hash(id + 3.7) * 14.99);
  float g = glyph(rampSel, idx, f) * step(hash(id + 11.3), p12 / 100.0 + 0.001);

  vec3 bd = vec3(0.0); float bdA = 1.0;
  if (p15 < 0.5) bd = p19 > 0.0 ? discBlur(uv, p19 / 100.0 * 0.05) : src.rgb;
  else if (p15 < 1.5) bd = vec3(p16, p17, p18);
  else if (p15 < 2.5) bd = src.rgb;
  else bdA = 0.0;
  if (p21 > 0.5 && (p15 < 0.5 || (p15 > 1.5 && p15 < 2.5))) bd = blurKind(uv, p21, p22, p23);
  if (p15 < 2.5 && (p15 < 0.5 || p15 > 1.5)) bd *= p20 / 100.0;

  vec3 cc = (p2 > 0.5 ? cs.rgb * 1.15 : vec3(p3, p4, p5)) * mix(max(l, 0.15), 1.0, p11 / 100.0);
  vec3 bl = p6 < 0.5 ? cc
    : p6 < 1.5 ? mix(2.0 * bd * cc, 1.0 - 2.0 * (1.0 - bd) * (1.0 - cc), step(0.5, bd))
    : p6 < 2.5 ? bd / max(1.0 - cc, 0.05)
    : p6 < 3.5 ? 1.0 - (1.0 - bd) * (1.0 - cc)
    : bd + cc;
  float m = g * p7 / 100.0;
  o.rgb = mix(bd, bl, m);
  if (p9 > 0.5) {
    float dg = 1.0 - smoothstep(0.05, 0.09, length((f - 0.5) * vec2(0.75, 1.0)));
    o.rgb = mix(o.rgb, cc * 0.5, dg * 0.6 * (1.0 - m));
    m = max(m, dg * 0.6 * (1.0 - bdA));
  }
  o.a = src.a * mix(bdA, 1.0, m);
  o.rgb = bdA > 0.5 ? o.rgb : (m > 0.0 ? bl : vec3(0.0));`;

const ramp = (name: string) => RAMPS.findIndex((x) => x.name === name);

const defs: MagicDef[] = [
  // ══ ASCII & Text ═══════════════════════════════════════════════════
  { id: "ascii", name: "Characters (ASCII)", category: "ASCII & Text", atlas: true, params: ASCII_PARAMS, fns: ASCII_FNS,
    desc: "Classic ASCII art: printable characters mapped to brightness.",
    preview: { cols: 30 },
    presets: [
      { name: "Colour photo", values: { ramp: 0, color: 1, backdrop: 0, bdOpacity: 35, blend: 0, invert: 0 } },
      { name: "Terminal", values: { ramp: 0, color: 0, ink: "#39ff6a", backdrop: 1, paper: "#030a05", invert: 0 } },
      { name: "Typewriter", values: { ramp: 1, color: 0, ink: "#1c1a17", backdrop: 1, paper: "#f3eee2", invert: 1 } },
      { name: "Amber", values: { ramp: 0, color: 0, ink: "#ffb000", backdrop: 1, paper: "#120800", invert: 0 } },
      { name: "Glow dodge", values: { ramp: 9, color: 1, blend: 2, backdrop: 0, bdOpacity: 60, softness: 40 } },
      { name: "Zoom dream", values: { color: 1, backdrop: 0, bdOpacity: 70, blur: 6, blurAmount: 35, focus: 50 } },
      { name: "Transparent", values: { color: 1, backdrop: 3 } },
      { name: "Blueprint", values: { ramp: 6, color: 0, ink: "#e6f0ff", backdrop: 1, paper: "#1d3f8a", invert: 0 } },
    ],
    glsl: ASCII_GLSL },
  { id: "block-chars", name: "Block characters", category: "ASCII & Text", alias: "ascii", desc: "Half-, quarter- and full-block glyphs, dense terminal pixel art.",
    overrides: { ramp: ramp("Blocks"), color: 1, backdrop: 1, cols: 90, uniformity: 80 }, preview: { cols: 30 } },
  { id: "dots", name: "Dots", category: "ASCII & Text", alias: "shape-halftone", desc: "Filled circles that scale with brightness, a halftone-print look.",
    overrides: { shape: 0, color: 1, paper: "#000000", invert: 1, size: 1.2 }, preview: { size: 4 } },
  { id: "ascii-scramble", name: "Scrambled ASCII", category: "ASCII & Text", alias: "ascii", desc: "Animated ASCII as a still frame: random characters, tone kept.",
    overrides: { ramp: ramp("Mixed"), random: 1, color: 1, backdrop: 1 }, preview: { cols: 30 } },
  { id: "mixed-glyphs", name: "Mixed glyphs", category: "ASCII & Text", alias: "ascii", desc: "A composite ramp mixing letters, digits and blocks for rich texture.",
    overrides: { ramp: ramp("Mixed"), color: 1, backdrop: 0, bdOpacity: 20, cols: 120 }, preview: { cols: 30 } },
  { id: "ascii-studio", name: "ASCII studio", category: "ASCII & Text", alias: "ascii", desc: "Palette shapes and glyphs on black for fine, poster-ready detail.",
    overrides: { ramp: ramp("Symbols"), color: 1, backdrop: 1, cols: 130, contrast: 40 }, preview: { cols: 32 } },
  { id: "braille", name: "Braille", category: "ASCII & Text", alias: "ascii", desc: "8-dot braille cells, the densest monochrome text art.",
    overrides: { ramp: ramp("Braille"), color: 0, ink: "#ffffff", backdrop: 1, cols: 150 }, preview: { cols: 40 } },
  { id: "matrix", name: "Matrix code", category: "ASCII & Text", atlas: true, desc: "Falling green code over your photo, frozen in time.", params: [
      r("cols", "Columns", 20, 200, 70), r("trail", "Trail length", 5, 100, 45), r("photo", "Picture showing", 0, 100, 70),
      col("color", "Code colour", "#39ff6a"), col("paper", "Background", "#010402"), seed],
    preview: { cols: 24 },
    presets: [
      { name: "Classic", values: { color: "#39ff6a", paper: "#010402" } },
      { name: "Ice", values: { color: "#7fdcff", paper: "#01050a" } },
      { name: "Blood", values: { color: "#ff3344", paper: "#080101" } },
      { name: "Gold", values: { color: "#ffcc4d", paper: "#070500" } },
    ],
    glsl: `
      float cw = 1.0 / p0;
      vec2 cell = vec2(cw, cw * res.x / res.y / 0.75);
      vec2 id = floor(uv / cell);
      vec2 f = fract(uv / cell);
      float rows = 1.0 / cell.y;
      float len = max(p1 / 100.0 * rows, 2.0);
      float h1 = hash(vec2(id.x, p9 + 1.0));
      float d = h1 * (rows + len) - id.y;
      float fade = (d >= 0.0 && d < len) ? 1.0 - d / len : 0.0;
      float d2 = fract(h1 * 3.7 + 0.31) * (rows + len) - id.y;
      fade = max(fade, (d2 >= 0.0 && d2 < len) ? (1.0 - d2 / len) * 0.6 : 0.0);
      float l = luma(tex((id + 0.5) * cell).rgb);
      float v = clamp(mix(fade, l * (0.3 + fade), p2 / 100.0) * 1.3, 0.0, 1.0);
      float g = glyph(4.0, floor(1.0 + hash(id + p9 * 0.37) * 14.99), vec2(1.0 - f.x, f.y));
      vec3 c = mix(vec3(p3, p4, p5), vec3(0.9, 1.0, 0.92), (d >= 0.0 && d < 1.0) ? 0.75 : 0.0);
      o.rgb = mix(vec3(p6, p7, p8), c, g * v);` },

  // ══ Pixel & Blocks ═════════════════════════════════════════════════
  { id: "pixel-art", name: "Pixel art", category: "Pixel & Blocks", alias: "pixel-dither", desc: "A square pixel grid with a quantised palette: 8-bit to indie pixel art.",
    overrides: { pattern: 8, palette: 6, size: 1 }, preview: { size: 2.5 },
    presets: [
      { name: "PICO-8", values: { palette: 6 } }, { name: "NES", values: { palette: 10 } }, { name: "C64", values: { palette: 5 } },
      { name: "Game Boy", values: { palette: 1 } }, { name: "16-bit colour", values: { palette: 4, levels: 5 } },
    ] },
  { id: "photo-mosaic", name: "Photo mosaic", category: "Pixel & Blocks", desc: "Each cell becomes a coloured tile sampled from the photo.", params: [
      r("size", "Tile size", 0.5, 8, 2.2, 0.05, "%"), sel("shape", "Tile shape", 0, [["Square", 0], ["Wide", 1], ["Tall", 2]]),
      r("gap", "Grout", 0, 40, 12), col("grout", "Grout colour", "#111111"), r("gloss", "Gloss", 0, 100, 50), r("round", "Rounding", 0, 50, 20)],
    preview: { size: 5 },
    glsl: `
      float cpx = p0 / 100.0 * max(res.x, res.y);
      vec2 csz = cpx * (p1 < 0.5 ? vec2(1.0) : p1 < 1.5 ? vec2(2.0, 1.0) : vec2(1.0, 2.0));
      vec2 q = uv * res / csz;
      float sh = (p1 > 0.5 && p1 < 1.5) ? step(1.0, mod(floor(q.y), 2.0)) * 0.5 : (p1 > 1.5 ? step(1.0, mod(floor(q.x), 2.0)) * 0.5 : 0.0);
      if (p1 > 0.5 && p1 < 1.5) q.x += sh; else if (p1 > 1.5) q.y += sh;
      vec2 id = floor(q); vec2 f = fract(q);
      vec2 cen = id + 0.5; if (p1 > 0.5 && p1 < 1.5) cen.x -= sh; else if (p1 > 1.5) cen.y -= sh;
      vec3 c = tex(cen * csz / res).rgb;
      vec2 lp = (f - 0.5) * csz;
      float gap = p2 / 100.0 * cpx * 0.5; float rr = p7 / 100.0 * cpx * 0.5;
      vec2 hb = csz * 0.5 - gap - rr;
      float sd = length(max(abs(lp) - hb, 0.0)) - rr;
      float inside = 1.0 - smoothstep(-1.0, 1.0, sd);
      float shade = 1.0 - 0.25 * smoothstep(-cpx * 0.15, 0.0, sd);
      float hl = pow(max(0.0, 1.0 - length(f - vec2(0.3, 0.25)) * 1.6), 3.0) * p6 / 100.0;
      o.rgb = mix(vec3(p3, p4, p5), c * shade + hl * 0.5, inside);` },
  { id: "lego", name: "LEGO bricks", category: "Pixel & Blocks", desc: "Posterised studded tiles with raised-dot highlights.", params: [
      r("size", "Brick size", 0.8, 8, 2.4, 0.05, "%"), r("levels", "Colour levels", 2, 12, 6), r("stud", "Stud height", 0, 100, 70), r("sat", "Saturation", 0, 200, 130)],
    preview: { size: 6 },
    glsl: `
      float cpx = p0 / 100.0 * max(res.x, res.y);
      vec2 q = uv * res / cpx; vec2 id = floor(q); vec2 lp = fract(q) - 0.5;
      vec3 c = tex((id + 0.5) * cpx * px).rgb;
      c = mix(vec3(luma(c)), c, p3 / 100.0);
      c = clamp(floor(c * (p1 - 1.0) + 0.5) / (p1 - 1.0), 0.0, 1.0);
      float h = p2 / 100.0;
      vec3 colr = c * (1.0 + (smoothstep(0.43, 0.5, -lp.x) + smoothstep(0.43, 0.5, -lp.y)) * 0.15 - (smoothstep(0.43, 0.5, lp.x) + smoothstep(0.43, 0.5, lp.y)) * 0.3);
      float rr = length(lp);
      float stud = 1.0 - smoothstep(0.28, 0.31, rr);
      float shadow = (1.0 - smoothstep(0.26, 0.36, length(lp - vec2(0.06)))) * (1.0 - stud);
      colr *= 1.0 - shadow * 0.4 * h;
      float lit = dot(normalize(lp + 0.0001), vec2(-0.7071, -0.7071));
      colr = mix(colr, c * (1.0 + lit * 0.3 * h * smoothstep(0.15, 0.3, rr)), stud);
      colr += stud * (1.0 - smoothstep(0.0, 0.12, length(lp - vec2(-0.1, -0.1)))) * 0.25 * h;
      o.rgb = colr;` },
  { id: "voxel", name: "Voxel cubes", category: "Pixel & Blocks", desc: "Isometric cubes with per-face shading and an outline.", params: [
      r("size", "Cube size", 1, 10, 3, 0.1, "%"), r("outline", "Outline", 0, 100, 30), r("shading", "Shading", 0, 100, 60), col("line", "Outline colour", "#000000")],
    preview: { size: 7 },
    glsl: `
      vec2 pp = uv / S / (p0 / 100.0);
      vec4 hx = hexGrid(pp);
      vec2 gv = hx.xy;
      vec3 c = tex(hx.zw * (p0 / 100.0) * S).rgb;
      float a = atan(gv.y, gv.x);
      float k = p2 / 100.0;
      float face = (a > -2.618 && a < -0.5236) ? 1.0 + 0.15 * k : (a >= -0.5236 && a < 1.5708) ? 1.0 - 0.45 * k : 1.0 - 0.2 * k;
      vec3 colr = c * face;
      float w = p1 / 100.0 * 0.05 + 0.002;
      float line = 1.0 - smoothstep(w, w + 0.01, 0.5 - hexDist(gv));
      vec2 d1 = vec2(-0.866, -0.5), d2 = vec2(0.866, -0.5), d3 = vec2(0.0, 1.0);
      float l1 = dot(gv, d1) > 0.0 ? abs(gv.x * d1.y - gv.y * d1.x) : 1.0;
      float l2 = dot(gv, d2) > 0.0 ? abs(gv.x * d2.y - gv.y * d2.x) : 1.0;
      float l3 = dot(gv, d3) > 0.0 ? abs(gv.x) : 1.0;
      line = max(line, 1.0 - smoothstep(w * 0.6, w * 0.6 + 0.01, min(l1, min(l2, l3))));
      o.rgb = mix(colr, vec3(p3, p4, p5), line * step(0.001, p1));` },
  { id: "hex-mosaic", name: "Hex mosaic", category: "Pixel & Blocks", desc: "A honeycomb of hexagonal tiles, each the colour of the area it covers.", params: [
      r("size", "Tile size", 0.8, 8, 2.5, 0.05, "%"), r("gap", "Gap", 0, 30, 8), col("grout", "Gap colour", "#101010"), r("bevel", "Bevel", 0, 100, 30)],
    preview: { size: 6 },
    glsl: `
      vec2 pp = uv / S / (p0 / 100.0);
      vec4 hx = hexGrid(pp);
      vec2 cu = hx.zw * (p0 / 100.0) * S;
      vec2 o2 = vec2(0.25, 0.0) * (p0 / 100.0) * S;
      vec3 c = (tex(cu).rgb * 2.0 + tex(cu + o2).rgb + tex(cu - o2).rgb + tex(cu + o2.yx).rgb + tex(cu - o2.yx).rgb) / 6.0;
      float hd = hexDist(hx.xy);
      float edge = 0.5 - p1 / 100.0 * 0.5;
      float inside = 1.0 - smoothstep(edge - 0.01, edge, hd);
      c *= 1.0 - smoothstep(edge - 0.12, edge, hd) * p5 / 100.0 * 0.4;
      c += (1.0 - smoothstep(0.0, 0.3, length(hx.xy - vec2(-0.12, -0.15)))) * p5 / 100.0 * 0.12;
      o.rgb = mix(vec3(p2, p3, p4), c, inside);` },
  { id: "led", name: "LED matrix", category: "Pixel & Blocks", desc: "A glowing LED sign: round, square, SMD, RGB or marquee bulbs.", params: [
      r("size", "LED size", 0.3, 4, 0.9, 0.05, "%"), r("gap", "Gap", 0, 70, 30), r("glow", "Glow", 0, 100, 40),
      sel("shape", "Bulb", 0, [["Round", 0], ["Square", 1], ["SMD", 2], ["RGB", 3], ["Marquee", 4]]), col("bg", "Background", "#050505")],
    preview: { size: 2.4 },
    glsl: `
      float cpx = p0 / 100.0 * max(res.x, res.y);
      vec2 q = uv * res / cpx;
      vec2 f = (fract(q) - 0.5) * 2.0;
      vec3 c = tex((floor(q) + 0.5) * cpx * px).rgb;
      float rr = 1.0 - p1 / 100.0;
      float aa = 2.0 / cpx;
      float d;
      if (p3 < 0.5 || p3 > 3.5) d = length(f);
      else if (p3 < 1.5) d = max(abs(f.x), abs(f.y));
      else if (p3 < 2.5) d = length(max(abs(f) - rr * 0.6, 0.0)) + rr * 0.4;
      else d = 0.0;
      vec3 lit;
      float led;
      if (p3 > 2.5 && p3 < 3.5) {
        float sub = floor(fract(q.x) * 3.0);
        vec2 sf = vec2(fract(fract(q.x) * 3.0) - 0.5, fract(q.y) - 0.5) * vec2(2.0, 2.0);
        float sd = length(max(abs(sf) - vec2(0.35, 0.75) * rr, 0.0));
        led = 1.0 - smoothstep(0.08, 0.08 + aa * 3.0, sd);
        lit = (sub < 0.5 ? vec3(c.r, 0.0, 0.0) : sub < 1.5 ? vec3(0.0, c.g, 0.0) : vec3(0.0, 0.0, c.b)) * 2.2;
        d = length(f);
      } else {
        led = 1.0 - smoothstep(rr - aa, rr + aa, d);
        lit = c * 1.25;
        if (p3 > 3.5) { lit = mix(lit, vec3(1.0, 0.8, 0.5) * luma(c) * 1.5, 0.6); led *= 0.75 + 0.25 * smoothstep(rr * 0.5, rr * 0.8, d) + 0.25 * (1.0 - smoothstep(0.0, rr * 0.4, d)); }
      }
      float halo = exp(-d * d * 1.5) * p2 / 100.0;
      o.rgb = vec3(p4, p5, p6) + lit * led + c * halo * 0.7;` },
  { id: "cross-stitch", name: "Cross stitch", category: "Pixel & Blocks", desc: "Embroidered X stitches on woven fabric.", params: [
      r("size", "Stitch size", 0.5, 5, 1.3, 0.05, "%"), r("levels", "Thread colours", 2, 12, 6), col("fabric", "Fabric", "#efe6d2"),
      r("thick", "Thread thickness", 20, 100, 65)],
    preview: { size: 8 },
    glsl: `
      float cpx = p0 / 100.0 * max(res.x, res.y);
      vec2 q = uv * res / cpx;
      vec2 f = (fract(q) - 0.5) * 2.0;
      vec3 c = tex((floor(q) + 0.5) * cpx * px).rgb;
      c = floor(c * (p1 - 1.0) + 0.5) / (p1 - 1.0);
      float th = p5 / 100.0 * 0.45;
      float aa = 2.0 / cpx;
      float inside = step(max(abs(f.x), abs(f.y)), 0.92);
      float s1 = (1.0 - smoothstep(th - aa, th + aa, abs(f.x - f.y) * 0.7071)) * inside;
      float s2 = (1.0 - smoothstep(th - aa, th + aa, abs(f.x + f.y) * 0.7071)) * inside;
      vec3 fab = vec3(p2, p3, p4) * (0.93 + 0.07 * sin(q.x * 25.13) * sin(q.y * 25.13));
      fab *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.25, length(1.0 - abs(f))));
      vec3 colr = mix(fab, c * (0.78 + 0.12 * sin((f.x + f.y) * 9.0)), s1);
      colr = mix(colr, c * (0.92 + 0.12 * sin((f.x - f.y) * 9.0)), s2);
      o.rgb = colr;` },

  // ══ Print & Paper ══════════════════════════════════════════════════
  { id: "pixel-dither", name: "Dither", category: "Print & Paper", desc: "Bayer, blue-noise, halftone, line and diffusion dithers across 17 retro palettes.", params: [
      r("size", "Pixel size", 0.1, 3, 0.45, 0.05, "%"),
      sel("pattern", "Pattern", 1, [["Bayer 2×2", 0], ["Bayer 4×4", 1], ["Bayer 8×8", 2], ["White noise", 3], ["Blue noise", 4], ["Halftone", 5], ["Lines", 6], ["Diffusion", 7], ["None", 8]]),
      sel("palette", "Palette", 0, PALETTES.map(([n], i) => [n, i] as [string, number])),
      r("levels", "Levels", 2, 6, 2), contrast(110), col("ink", "Ink", "#1a1a2e"), col("paper", "Paper", "#f4efe4"),
      r("strength", "Dither strength", 0, 100, 100)],
    preview: { size: 1.2 },
    presets: [
      { name: "Game Boy", values: { palette: 1, pattern: 1, size: 0.6 } },
      { name: "Mac 1-bit", values: { palette: 3, pattern: 7, size: 0.3 } },
      { name: "CGA", values: { palette: 2, pattern: 1, size: 0.5 } },
      { name: "C64", values: { palette: 5, pattern: 1, size: 0.6 } },
      { name: "PICO-8", values: { palette: 6, pattern: 2, size: 0.5 } },
      { name: "Sepia", values: { palette: 7, pattern: 7, size: 0.3 } },
      { name: "Newsprint", values: { palette: 0, pattern: 5, ink: "#222222", paper: "#efe7d6", size: 0.25 } },
      { name: "Lines", values: { palette: 14, pattern: 6, size: 0.35 } },
    ],
    fns: PALETTE_GLSL,
    glsl: `
      float cpx = max(p0 / 100.0 * max(res.x, res.y), 1.0);
      vec2 pp = floor(uv * res / cpx);
      vec3 c = tex((pp + 0.5) * cpx * px).rgb;
      float t = p1 < 0.5 ? bayer2(pp) : p1 < 1.5 ? bayer4(pp) : p1 < 2.5 ? bayer8(pp) : p1 < 3.5 ? hash(pp)
        : p1 < 4.5 ? ign(pp) : p1 < 5.5 ? length(fract(pp / 4.0 + 0.125) - 0.5) * 1.41 : p1 < 6.5 ? fract(pp.y / 3.0 + 0.17)
        : p1 < 7.5 ? fract(ign(pp) + hash(pp) * 0.25) : 0.5;
      t = (t - 0.5) * p11 / 100.0;
      float l = tone(luma(c), p4);
      if (p2 < 0.5) {
        float n = p3 - 1.0;
        o.rgb = mix(vec3(p5, p6, p7), vec3(p8, p9, p10), clamp(floor(l * n + 0.5 + t) / n, 0.0, 1.0));
      } else if (p2 > 3.5 && p2 < 4.5) {
        float n = p3 - 1.0;
        vec3 cc = (c - 0.5) * p4 / 100.0 + 0.5;
        o.rgb = clamp(floor(cc * n + 0.5 + t) / n, 0.0, 1.0);
      } else {
        vec3 cc = clamp((c - 0.5) * p4 / 100.0 + 0.5, 0.0, 1.0);
        float spread = 1.6 / max(palCount(p2), 2.0) + 0.12;
        o.rgb = nearestPal(cc + t * spread, p2);
      }` },
  { id: "cmyk-halftone", name: "CMYK drops", category: "Print & Paper", desc: "A real CMYK print: cyan, magenta, yellow and black dots over paper.", params: [
      r("size", "Dot size", 0.3, 5, 1, 0.05, "%"), r("angle", "Screen angle", 0, 90, 0, 1, "°"),
      sel("shape", "Dot shape", 0, [["Round", 0], ["Square", 1], ["Lines", 2]]),
      col("paper", "Paper", "#fbf8f1"), r("misreg", "Misregistration", 0, 1, 0.12, 0.01, "%")],
    preview: { size: 2.5 },
    fns: `
      vec4 cmyk(vec3 c) { float k = 1.0 - max(max(c.r, c.g), c.b); float d = max(1.0 - k, 0.0001); return vec4((1.0 - c.r - k) / d, (1.0 - c.g - k) / d, (1.0 - c.b - k) / d, k); }
      float screen(vec2 pos, float ang, float cellPx, float which, float shape) {
        vec2 q = rot(pos, ang) / cellPx;
        vec2 f = fract(q) - 0.5;
        vec4 k = cmyk(tex(rot((floor(q) + 0.5) * cellPx, -ang) / res).rgb);
        float v = which < 0.5 ? k.x : which < 1.5 ? k.y : which < 2.5 ? k.z : k.w;
        float aa = 1.2 / cellPx;
        if (shape < 0.5) { float rr = sqrt(v) * 0.68; return 1.0 - smoothstep(rr - aa, rr + aa, length(f)); }
        if (shape < 1.5) { float rr = sqrt(v) * 0.5; return 1.0 - smoothstep(rr - aa, rr + aa, max(abs(f.x), abs(f.y))); }
        float rr = v * 0.5; return 1.0 - smoothstep(rr - aa, rr + aa, abs(f.y));
      }`,
    glsl: `
      float cellPx = p0 / 100.0 * max(res.x, res.y);
      vec2 pos = uv * res;
      vec2 mis = vec2(p6, -p6 * 0.7) / 100.0 * max(res.x, res.y);
      float a = radians(p1);
      float cy = screen(pos + mis, a + 0.2618, cellPx, 0.0, p2);
      float mg = screen(pos - mis, a + 1.309, cellPx, 1.0, p2);
      float ye = screen(pos, a, cellPx, 2.0, p2);
      float bk = screen(pos, a + 0.7854, cellPx, 3.0, p2);
      vec3 colr = vec3(p3, p4, p5);
      colr *= 1.0 - cy * vec3(0.9, 0.25, 0.05);
      colr *= 1.0 - mg * vec3(0.1, 0.85, 0.2);
      colr *= 1.0 - ye * vec3(0.0, 0.05, 0.9);
      colr *= 1.0 - bk * 0.92;
      o.rgb = colr;` },
  { id: "comic", name: "Comic", category: "Print & Paper", desc: "Bold comic-book ink: flat fills, dot shading and heavy outlines.", params: [
      r("levels", "Colour levels", 2, 8, 4), r("outline", "Outline", 0, 100, 70), r("width", "Outline width", 0.05, 0.6, 0.15, 0.01, "%"),
      r("dot", "Dot size", 0.3, 3, 0.8, 0.05, "%"), r("dots", "Dot shading", 0, 100, 60), r("sat", "Saturation", 0, 200, 140)],
    preview: { width: 0.4, dot: 2 },
    glsl: `
      vec3 c = discBlur(uv, 0.003);
      c = mix(vec3(luma(c)), c, p5 / 100.0);
      vec3 q = clamp(floor(c * (p0 - 1.0) + 0.5) / (p0 - 1.0), 0.0, 1.0);
      float l = luma(src.rgb);
      float cpx = p3 / 100.0 * max(res.x, res.y);
      vec2 f = fract(rot(uv * res, 0.785) / cpx) - 0.5;
      float dr = sqrt(clamp((0.65 - l) * 1.6, 0.0, 1.0)) * 0.5;
      q *= 1.0 - (1.0 - smoothstep(dr - 0.08, dr + 0.02, length(f))) * p4 / 100.0 * 0.55;
      float e = smoothstep(0.25, 0.5, sobel(uv, vec2(p2 / 100.0) * S) * p1 / 100.0 * 2.0);
      o.rgb = mix(q, vec3(0.05), e);` },
  { id: "crosshatch", name: "Crosshatch", category: "Print & Paper", desc: "Engraver's crosshatching: layered line shading that deepens with tone.", params: [
      r("density", "Line density", 40, 300, 120), r("layers", "Layers", 1, 5, 4), r("angle", "Angle", 0, 180, 45, 1, "°"),
      r("width", "Line weight", 5, 80, 40), col("ink", "Ink", "#1b1b22"), col("paper", "Paper", "#f5f1e8"), contrast()],
    preview: { density: 50 },
    presets: [
      { name: "Pen & ink", values: { ink: "#1b1b22", paper: "#f5f1e8", layers: 4 } },
      { name: "Red biro", values: { ink: "#b3261e", paper: "#fbf7ef", layers: 3 } },
      { name: "Chalkboard", values: { ink: "#f0f0ea", paper: "#22302a", layers: 4 } },
    ],
    glsl: `
      float l = tone(luma(src.rgb), p10);
      float dark = 1.0 - l;
      vec2 q = uv / S * p0 + (vnoise(uv / S * 12.0) - 0.5) * 0.35;
      float aa = p0 / max(res.x, res.y) * 2.0;
      float ink = 0.0;
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        if (fi >= p1) break;
        float thr = (fi + 0.5) / p1 * 0.9;
        if (dark > thr) {
          float ang = radians(p2) + fi * 3.14159 / p1;
          float fy = abs(fract(rot(q, ang).y + fi * 0.37) - 0.5) * 2.0;
          float w = p3 / 100.0 * clamp((dark - thr) * 4.0, 0.35, 1.0);
          ink = max(ink, 1.0 - smoothstep(w - aa, w + aa, fy));
        }
      }
      o.rgb = mix(vec3(p7, p8, p9), vec3(p4, p5, p6), ink);` },
  { id: "cyanotype", name: "Cyanotype", category: "Print & Paper", desc: "Blueprint print: white linework on Prussian blue.", params: [
      r("lines", "Linework", 0, 100, 70), r("width", "Line width", 0.05, 0.6, 0.12, 0.01, "%"), r("tone", "Tone", 0, 100, 60),
      col("ground", "Ground", "#1b3d6e"), r("grain", "Paper grain", 0, 100, 40)],
    preview: { width: 0.35 },
    glsl: `
      float l = luma(src.rgb);
      vec3 g = vec3(p3, p4, p5);
      vec3 colr = mix(g * 0.6, mix(g, vec3(0.92, 0.95, 1.0), 0.75), smoothstep(0.2, 0.95, l) * p2 / 100.0);
      float e = clamp(sobel(uv, vec2(p1 / 100.0) * S) * p0 / 100.0 * 2.5, 0.0, 1.0);
      colr = mix(colr, vec3(0.95, 0.97, 1.0), e);
      colr *= 1.0 - (fbm(uv / S * 90.0) - 0.5) * p6 / 100.0 * 0.25;
      o.rgb = colr;` },
  { id: "engraving", name: "Engraving", category: "Print & Paper", desc: "Line engraving: flowing lines carve the form like an old banknote.", params: [
      r("lines", "Line count", 20, 300, 110), r("angle", "Angle", 0, 180, 20, 1, "°"), r("follow", "Follow the form", 0, 100, 50),
      r("width", "Line weight", 20, 100, 75), col("ink", "Ink", "#1a1612"), col("paper", "Paper", "#f4ecdc"), contrast(130)],
    preview: { lines: 45 },
    presets: [
      { name: "Banknote", values: { ink: "#1f3b2c", paper: "#e9efe2", follow: 70 } },
      { name: "Etching", values: { ink: "#1a1612", paper: "#f4ecdc", follow: 40, angle: 20 } },
      { name: "Blueprint", values: { ink: "#eaf2ff", paper: "#183a7a", follow: 55 } },
      { name: "Wave lines", values: { follow: 100, angle: 0, lines: 70 } },
    ],
    glsl: `
      float l = tone(luma(discBlur(uv, 0.004)), p10);
      vec2 q = rot(uv / S, radians(p1)) * p0;
      float fy = abs(fract(q.y + l * p2 / 100.0 * 6.0) - 0.5) * 2.0;
      float w = (1.0 - l) * p3 / 100.0;
      float aa = p0 / max(res.x, res.y) * 2.0;
      float m = 1.0 - smoothstep(w - aa, w + aa, fy);
      o.rgb = mix(vec3(p7, p8, p9), vec3(p4, p5, p6), m);` },
  { id: "am-halftone", name: "Halftone", category: "Print & Paper", alias: "halftone", desc: "Newsprint halftone: ink dots that grow and shrink with tone.",
    overrides: { size: 0.9 }, preview: { size: 2.5 } },
  { id: "mezzotint", name: "Mezzotint", category: "Print & Paper", desc: "Old-master mezzotint: dense random dots build deep, velvety tone.", params: [
      r("grain", "Grain size", 0.5, 4, 1.2, 0.1), contrast(130), col("ink", "Ink", "#1a1410"), col("paper", "Paper", "#efe6d6"), seed],
    glsl: `
      float gpx = p0 * max(1.0, max(res.x, res.y) / 1000.0);
      vec2 g = floor(uv * res / gpx);
      float n = hash(g + p8) * 0.6 + vnoise(uv * res / gpx * 0.35 + p8) * 0.4;
      float l = tone(luma(discBlur(uv, 0.002)), p1);
      float ink = 1.0 - smoothstep(n - 0.04, n + 0.04, l);
      o.rgb = mix(vec3(p5, p6, p7), vec3(p2, p3, p4), ink);` },
  { id: "pointillize", name: "Pointillize", category: "Print & Paper", desc: "Pointillism: the image rebuilt from small coloured dots.", params: [
      r("cells", "Dots across", 20, 250, 80), r("size", "Dot size", 40, 140, 85), col("paper", "Canvas", "#f4efe6"), r("sat", "Saturation", 0, 200, 135), seed],
    preview: { cells: 35 },
    glsl: `
      vec2 g = uv / S * p0; vec2 id = floor(g), f = fract(g);
      float best = 9.0; vec3 bc = vec3(p2, p3, p4);
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 nb = vec2(float(i), float(j));
          vec2 pt = nb + hash2(id + nb + p6);
          float rr = p1 / 100.0 * (0.62 + 0.3 * hash(id + nb + 4.1));
          float d = length(f - pt) / rr;
          if (d < 1.0 && d < best) {
            best = d;
            vec3 c = tex((id + pt) / p0 * S).rgb;
            bc = mix(vec3(luma(c)), c, p5 / 100.0) * (0.92 + 0.16 * hash(id + nb + 9.3));
          }
        }
      }
      float aa = p0 / max(res.x, res.y) * 3.0;
      o.rgb = mix(vec3(p2, p3, p4), bc, 1.0 - smoothstep(1.0 - aa, 1.0, best));` },
  { id: "am-posterize", name: "Posterize", category: "Print & Paper", alias: "posterize", desc: "Tone crushed to a few flat bands, a bold screen-print look.",
    overrides: { levels: 4, sat: 140 } },
  { id: "am-risograph", name: "Risograph", category: "Print & Paper", alias: "risograph", desc: "Riso print: grainy, slightly misregistered spot-colour layers." },
  { id: "am-sketch", name: "Sketch", category: "Print & Paper", alias: "sketch", desc: "A pencil sketch traced from the image edges." },
  { id: "stippling", name: "Stippling", category: "Print & Paper", desc: "Stipple shading: tone built entirely from packed dots.", params: [
      r("density", "Dot density", 60, 400, 200), r("size", "Dot size", 20, 100, 55), contrast(130), col("ink", "Ink", "#141414"), col("paper", "Paper", "#f7f4ee")],
    preview: { density: 70 },
    glsl: `
      vec2 g = uv / S * p0; vec2 id = floor(g), f = fract(g);
      float aa = p0 / max(res.x, res.y) * 1.5;
      float ink = 0.0;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 nb = vec2(float(i), float(j));
          vec2 pt = nb + hash2(id + nb);
          float dark = 1.0 - tone(luma(tex((id + pt) / p0 * S).rgb), p2);
          if (hash(id + nb + 5.1) < dark * dark * 1.3) {
            float rr = p1 / 100.0 * 0.5;
            ink = max(ink, 1.0 - smoothstep(rr - aa, rr + aa, length(f - pt)));
          }
        }
      }
      o.rgb = mix(vec3(p6, p7, p8), vec3(p3, p4, p5), ink);` },
  { id: "warhol", name: "Warhol", category: "Print & Paper", desc: "Pop-art repeat in shifted high-contrast colourways.", params: [
      sel("grid", "Grid", 0, [["2 × 2", 0], ["3 × 3", 1]]), r("hue", "Colourway", 0, 100, 0), contrast(140), r("soft", "Band softness", 0, 100, 10)],
    glsl: `
      float n = p0 < 0.5 ? 2.0 : 3.0;
      vec2 q = uv * n; vec2 id = floor(q); vec2 lu = fract(q);
      float l = tone(luma(tex(lu).rgb), p2);
      float h = fract((id.x + id.y * n) * 0.37 + p1 / 100.0);
      vec3 c1 = hsv2rgb(vec3(h, 0.85, 1.0)), c2 = hsv2rgb(vec3(fract(h + 0.38), 0.9, 0.9)), c3 = hsv2rgb(vec3(fract(h + 0.62), 0.85, 0.3));
      float s = p3 / 100.0 * 0.15 + 0.005;
      vec3 c = mix(c3, c2, smoothstep(0.33 - s, 0.33 + s, l));
      o.rgb = mix(c, c1, smoothstep(0.62 - s, 0.62 + s, l));` },
  { id: "woodblock", name: "Woodblock", category: "Print & Paper", desc: "Japanese woodblock: flat colour planes with a carved, inked feel.", params: [
      r("levels", "Colour levels", 2, 8, 4), r("outline", "Ink outline", 0, 100, 70), r("grain", "Wood grain", 0, 100, 40), col("paper", "Paper", "#efe3c8"),
      r("width", "Line width", 0.05, 0.6, 0.18, 0.01, "%")],
    preview: { width: 0.45 },
    glsl: `
      vec3 c = discBlur(uv, 0.006);
      c = clamp(floor(c * (p0 - 1.0) + 0.5) / (p0 - 1.0), 0.0, 1.0);
      c = mix(c, c * vec3(p3, p4, p5), 0.45) + vec3(p3, p4, p5) * 0.08;
      vec2 q = uv / S;
      float grain = sin(q.y * 180.0 + fbm(q * vec2(3.0, 18.0)) * 14.0) * 0.5 + 0.5;
      c *= 1.0 - grain * p2 / 100.0 * 0.18;
      float e = smoothstep(0.2, 0.45, sobel(uv, vec2(p6 / 100.0) * S) * p1 / 100.0 * 2.0);
      o.rgb = mix(c, vec3(0.1, 0.08, 0.07), e);` },
  { id: "shape-halftone", name: "Shape halftone", category: "Print & Paper", desc: "Halftone built from circles, squares, diamonds, crosses or rings.", params: [
      r("size", "Cell size", 0.5, 6, 1.6, 0.05, "%"),
      sel("shape", "Shape", 0, [["Circle", 0], ["Square", 1], ["Diamond", 2], ["Cross", 3], ["Ring", 4]]),
      sel("color", "Colour", 0, [["Ink", 0], ["Original", 1]]),
      col("ink", "Ink", "#121212"), col("paper", "Paper", "#f6f1e7"), contrast(), invert],
    preview: { size: 4 },
    presets: [
      { name: "Newspaper", values: { shape: 0, color: 0, ink: "#121212", paper: "#f6f1e7", invert: 0 } },
      { name: "Pop dots", values: { shape: 0, color: 1, paper: "#fff8e7", invert: 0 } },
      { name: "Glow rings", values: { shape: 4, color: 1, paper: "#000000", invert: 1 } },
      { name: "Stitch cross", values: { shape: 3, color: 0, ink: "#c2185b", paper: "#fdeef4", invert: 0 } },
    ],
    glsl: `
      float cpx = p0 / 100.0 * max(res.x, res.y);
      vec2 q = uv * res / cpx;
      vec2 f = (fract(q) - 0.5) * 2.0;
      vec3 cc = tex((floor(q) + 0.5) * cpx * px).rgb;
      float l = tone(luma(cc), p9);
      float s = sqrt(p10 > 0.5 ? l : 1.0 - l);
      float aa = 2.0 / cpx;
      float m;
      if (p1 < 0.5) m = 1.0 - smoothstep(s * 1.1 - aa, s * 1.1 + aa, length(f));
      else if (p1 < 1.5) m = 1.0 - smoothstep(s - aa, s + aa, max(abs(f.x), abs(f.y)));
      else if (p1 < 2.5) m = 1.0 - smoothstep(s * 1.3 - aa, s * 1.3 + aa, abs(f.x) + abs(f.y));
      else if (p1 < 3.5) m = (1.0 - smoothstep(s * 0.35 - aa, s * 0.35 + aa, min(abs(f.x), abs(f.y)))) * (1.0 - smoothstep(s - aa, s + aa, max(abs(f.x), abs(f.y))));
      else { float rr = length(f); m = (1.0 - smoothstep(s - aa, s + aa, rr)) * smoothstep(s * 0.55 - aa, s * 0.55 + aa, rr); }
      o.rgb = mix(vec3(p6, p7, p8), p2 > 0.5 ? cc : vec3(p3, p4, p5), m);` },

  // ══ Geometric ══════════════════════════════════════════════════════
  { id: "cross-glyphs", name: "Cross glyphs", category: "Geometric", alias: "ascii", desc: "Plus and × glyphs form a hatched grid texture.",
    overrides: { ramp: ramp("Cross"), color: 1, backdrop: 1, cols: 90 }, preview: { cols: 28 } },
  { id: "diagonal-strokes", name: "Diagonal strokes", category: "Geometric", alias: "ascii", desc: "Slashes form a directional weave, a brushed, sketched feel.",
    overrides: { ramp: ramp("Diagonal"), color: 1, backdrop: 1, cols: 90 }, preview: { cols: 28 } },
  { id: "diamond-glyphs", name: "Diamond glyphs", category: "Geometric", alias: "shape-halftone", desc: "Jewel-like diamonds sized by brightness.",
    overrides: { shape: 2, color: 1, paper: "#0a0a0a", invert: 1, size: 1.3 }, preview: { size: 4 } },
  { id: "vertical-lines", name: "Lines", category: "Geometric", alias: "ascii", desc: "Vertical strokes that read like rain or barcode static.",
    overrides: { ramp: ramp("Lines"), color: 1, backdrop: 1, cols: 110 }, preview: { cols: 32 } },
  { id: "droste", name: "Droste", category: "Geometric", desc: "The Droste effect: the image spirals recursively into itself.", params: [
      r("ratio", "Zoom ratio", 1.5, 8, 3, 0.1), r("twist", "Spiral", 0, 100, 100), r("x", "Centre X", 0, 100, 50), r("y", "Centre Y", 0, 100, 50)],
    glsl: `
      vec2 c = vec2(p2, p3) / 100.0;
      vec2 z = uv - c; z.x *= aspect; z /= 0.5;
      float lr = log(p0);
      vec2 w = vec2(log(length(z) + 1e-5), atan(z.y, z.x));
      float a = atan(lr / 6.28318) * p1 / 100.0;
      float ca = cos(a), sa = sin(a);
      w = vec2(w.x * ca - w.y * sa, w.x * sa + w.y * ca) / ca;
      w.x = mod(w.x, lr) - lr;
      vec2 z2 = exp(w.x) * vec2(cos(w.y), sin(w.y)) * 0.5;
      z2.x /= aspect;
      o = tex(c + z2);` },
  { id: "flow-field", name: "Flow field", category: "Geometric", desc: "Streaks follow the image's contours in flowing lines.", params: [
      r("density", "Line density", 50, 400, 180), r("length", "Stroke length", 2, 40, 14), sel("color", "Colour", 1, [["Ink", 0], ["Original", 1]]),
      col("ink", "Ink", "#141414"), col("paper", "Paper", "#f4f0e8")],
    preview: { density: 90 },
    glsl: `
      float cellPx = max(res.x, res.y) / p0;
      float stepPx = p1 * max(1.0, max(res.x, res.y) / 1000.0) / 8.0;
      vec2 pos = uv; float acc = 0.0;
      for (int k = 0; k < 2; k++) {
        pos = uv;
        float dirSign = k == 0 ? 1.0 : -1.0;
        for (int i = 0; i < 12; i++) {
          vec2 e = px * 2.0;
          vec2 gr = vec2(luma(tex(pos + vec2(e.x, 0.0)).rgb) - luma(tex(pos - vec2(e.x, 0.0)).rgb),
                         luma(tex(pos + vec2(0.0, e.y)).rgb) - luma(tex(pos - vec2(0.0, e.y)).rgb));
          float ang = fbm(pos / S * 3.0) * 6.28318;
          vec2 t = mix(vec2(cos(ang), sin(ang)), normalize(vec2(-gr.y, gr.x) + 1e-5), smoothstep(0.0, 0.03, length(gr)));
          pos += normalize(t) * px * stepPx * dirSign;
          acc += hash(floor(pos * res / cellPx));
        }
      }
      float v = smoothstep(0.38, 0.62, acc / 24.0);
      float l = luma(src.rgb);
      float ink = v * smoothstep(0.95, 0.15, l);
      o.rgb = mix(vec3(p6, p7, p8), p2 > 0.5 ? src.rgb * 0.9 : vec3(p3, p4, p5), ink);` },
  { id: "forms", name: "Forms", category: "Geometric", desc: "Bauhaus form stamps placed and scaled by tone.", params: [
      r("size", "Cell size", 1, 10, 4, 0.1, "%"), sel("palette", "Colour", 1, [["Original", 0], ["Bauhaus", 1]]), col("paper", "Paper", "#f1ece1"), contrast(), seed],
    preview: { size: 9 },
    glsl: `
      float cs = p0 / 100.0;
      vec2 q = uv / S / cs; vec2 id = floor(q);
      vec2 f = (fract(q) - 0.5) * 2.0;
      float k = floor(hash(id + p6) * 5.0);
      float turns = floor(hash(id + p6 + 2.0) * 4.0);
      f = rot(f, turns * 1.5708);
      vec3 c = tex((id + 0.5) * cs * S).rgb;
      float l = tone(luma(c), p5);
      float s = 0.35 + sqrt(1.0 - l) * 0.62;
      float d;
      if (k < 0.5) d = length(f) - s;
      else if (k < 1.5) d = max(abs(f.x), abs(f.y)) - s * 0.85;
      else if (k < 2.5) { float yy = -f.y; d = max(abs(f.x) * 0.866 + yy * 0.5, -yy) - s * 0.5; }
      else if (k < 3.5) d = max(length(f) - s, -f.y);
      else d = max(length(f + 0.9) - s * 1.7, max(abs(f.x), abs(f.y)) - 0.9);
      float aa = 3.0 / (cs * max(res.x, res.y));
      vec3 ink = c;
      if (p1 > 0.5) {
        ink = l < 0.25 ? vec3(0.08) : (c.r > c.b && c.r > c.g * 1.1) ? vec3(0.86, 0.15, 0.12) : (c.b > c.r) ? vec3(0.1, 0.27, 0.65) : vec3(0.97, 0.78, 0.1);
      }
      o.rgb = mix(vec3(p2, p3, p4), ink, 1.0 - smoothstep(-aa, aa, d));` },
  { id: "iso-extrude", name: "Iso extrude", category: "Geometric", desc: "Pixels extruded into bars: a city-block relief map.", params: [
      r("size", "Block size", 0.5, 6, 2, 0.05, "%"), r("height", "Height", 0, 100, 50), col("bg", "Background", "#0d0d12"), r("light", "Top light", 0, 100, 40)],
    preview: { size: 5 },
    glsl: `
      float cs = p0 / 100.0;
      vec2 q = uv / S / cs;
      float H = p1 / 100.0 * 6.0;
      vec3 colr = vec3(p2, p3, p4);
      for (int k = 0; k < 8; k++) {
        float fk = float(k);
        if (fk > H + 1.0) break;
        vec2 cid = vec2(floor(q.x), floor(q.y) + fk);
        vec3 c = tex((cid + 0.5) * cs * S).rgb;
        float h = luma(c) * H;
        float yTop = cid.y - h;
        float fx = fract(q.x);
        float edge = smoothstep(0.0, 0.06, fx) * smoothstep(0.0, 0.06, 1.0 - fx);
        if (q.y >= yTop && q.y < yTop + 1.0) colr = c * (1.0 + p5 / 200.0) * (0.75 + 0.25 * edge);
        else if (q.y >= yTop + 1.0 && q.y < cid.y + 1.0) colr = c * (0.45 + 0.2 * (q.y - yTop - 1.0) / max(h, 0.001)) * (0.8 + 0.2 * edge);
      }
      o.rgb = colr;` },
  { id: "lattice", name: "Lattice", category: "Geometric", desc: "A woven lattice warped and shaded by the photo.", params: [
      r("strips", "Strips", 10, 120, 40), r("gap", "Gap", 0, 50, 18), col("bg", "Background", "#111111"), r("shade", "Shading", 0, 100, 60)],
    preview: { strips: 16 },
    glsl: `
      vec3 c = tex(uv).rgb; float l = luma(c);
      vec2 q = uv / S * p0 + vec2(0.0, (l - 0.5) * 0.6);
      vec2 id = floor(q); vec2 f = fract(q);
      float g = p1 / 100.0 * 0.5 + (1.0 - l) * 0.12;
      float inH = step(g, f.y) * step(f.y, 1.0 - g);
      float inV = step(g, f.x) * step(f.x, 1.0 - g);
      float over = mod(id.x + id.y, 2.0);
      float shH = 1.0 - p5 / 100.0 * 0.4 * (1.0 - sin(f.y * 3.14159));
      float shV = 1.0 - p5 / 100.0 * 0.4 * (1.0 - sin(f.x * 3.14159));
      vec3 colr = vec3(p2, p3, p4);
      if (inH > 0.5 && inV > 0.5) colr = over > 0.5 ? c * shH : c * shV;
      else if (inH > 0.5) colr = c * shH * (over > 0.5 ? 1.0 : 0.75);
      else if (inV > 0.5) colr = c * shV * (over > 0.5 ? 0.75 : 1.0);
      o.rgb = colr;` },
  { id: "low-poly", name: "Low poly", category: "Geometric", desc: "The image faceted into flat-shaded triangles.", params: [
      r("cells", "Cells", 5, 80, 24), r("jitter", "Irregularity", 0, 100, 70), r("edges", "Edge lines", 0, 100, 0), seed],
    preview: { cells: 12 },
    fns: `
      float triSide(vec2 p, vec2 a, vec2 b) { return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y); }
      bool inTri(vec2 p, vec2 a, vec2 b, vec2 c) { float d1 = triSide(p, a, b), d2 = triSide(p, b, c), d3 = triSide(p, c, a); return !((d1 < 0.0 || d2 < 0.0 || d3 < 0.0) && (d1 > 0.0 || d2 > 0.0 || d3 > 0.0)); }`,
    glsl: `
      vec2 g = uv / S * p0; vec2 id0 = floor(g);
      float jt = p1 / 100.0 * 0.4;
      vec3 colr = src.rgb; bool found = false; float edge = 1.0;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          if (found) break;
          vec2 id = id0 + vec2(float(i), float(j));
          vec2 a = id + (hash2(id + p3) - 0.5) * jt * 2.0;
          vec2 b = id + vec2(1.0, 0.0) + (hash2(id + vec2(1.0, 0.0) + p3) - 0.5) * jt * 2.0;
          vec2 c = id + vec2(0.0, 1.0) + (hash2(id + vec2(0.0, 1.0) + p3) - 0.5) * jt * 2.0;
          vec2 d = id + vec2(1.0, 1.0) + (hash2(id + vec2(1.0, 1.0) + p3) - 0.5) * jt * 2.0;
          bool flip = hash(id + p3 + 0.5) > 0.5;
          vec2 t1a = a, t1b = b, t1c = flip ? c : d;
          vec2 t2a = flip ? b : a, t2b = d, t2c = c;
          if (inTri(g, t1a, t1b, t1c)) { colr = tex((t1a + t1b + t1c) / 3.0 / p0 * S).rgb * (0.94 + 0.12 * hash(id + 1.1)); found = true;
            edge = min(min(abs(triSide(g, t1a, t1b)) / length(t1a - t1b), abs(triSide(g, t1b, t1c)) / length(t1b - t1c)), abs(triSide(g, t1c, t1a)) / length(t1c - t1a)); }
          else if (inTri(g, t2a, t2b, t2c)) { colr = tex((t2a + t2b + t2c) / 3.0 / p0 * S).rgb * (0.94 + 0.12 * hash(id + 2.3)); found = true;
            edge = min(min(abs(triSide(g, t2a, t2b)) / length(t2a - t2b), abs(triSide(g, t2b, t2c)) / length(t2b - t2c)), abs(triSide(g, t2c, t2a)) / length(t2c - t2a)); }
        }
      }
      float aa = p0 / max(res.x, res.y) * 1.5;
      o.rgb = mix(colr, colr * 0.6 + 0.4, (1.0 - smoothstep(aa, aa * 2.0, edge)) * p2 / 100.0);` },
  { id: "neon-grid", name: "Neon grid", category: "Geometric", desc: "A glowing neon wireframe grid deformed by the image.", params: [
      r("density", "Grid lines", 10, 120, 40), r("warp", "Warp", 0, 100, 50), col("color", "Line colour", "#00f0ff"), col("bg", "Background", "#05010f"),
      r("glow", "Glow", 0, 100, 60), r("photo", "Picture showing", 0, 100, 15), onOff("rainbow", "Rainbow")],
    preview: { density: 18 },
    glsl: `
      float l = luma(discBlur(uv, 0.006));
      vec2 q = uv / S * p0;
      float yy = q.y - l * p1 / 100.0 * 4.0;
      float xx = q.x + (l - 0.5) * p1 / 100.0 * 1.2;
      float dy = min(fract(yy), 1.0 - fract(yy)), dx = min(fract(xx), 1.0 - fract(xx));
      float d = min(dx, dy);
      float px1 = p0 / max(res.x, res.y);
      float core = 1.0 - smoothstep(px1 * 0.6, px1 * 1.6, d);
      float glow = exp(-d * d / (0.0015 + 0.01 * p8 / 100.0)) * p8 / 100.0;
      vec3 lc = p10 > 0.5 ? 0.5 + 0.5 * cos(6.28318 * (uv.y * 0.9 + uv.x * 0.3 + vec3(0.0, 0.33, 0.67))) : vec3(p2, p3, p4);
      o.rgb = vec3(p5, p6, p7) + src.rgb * p9 / 100.0 + lc * (core + glow * 0.6);` },
  { id: "schematic", name: "Schematic", category: "Geometric", desc: "A technical schematic: nodes and connectors drawn over the subject.", params: [
      r("grid", "Grid", 10, 80, 30), r("edges", "Line strength", 0, 100, 70), col("bg", "Paper", "#0b2a5b"), col("ink", "Ink", "#dbe8ff"), r("nodes", "Nodes", 0, 100, 60)],
    preview: { grid: 14 },
    glsl: `
      vec3 bg = vec3(p2, p3, p4), ink = vec3(p5, p6, p7);
      vec2 g = uv / S * p0;
      vec2 fg = fract(g);
      float px1 = p0 / max(res.x, res.y);
      float minor = 1.0 - smoothstep(0.0, px1 * 1.2, min(min(fg.x, 1.0 - fg.x), min(fg.y, 1.0 - fg.y)));
      vec2 g5 = g / 5.0; vec2 f5 = fract(g5);
      float major = 1.0 - smoothstep(0.0, px1 * 0.5, min(min(f5.x, 1.0 - f5.x), min(f5.y, 1.0 - f5.y)));
      vec3 colr = bg * (1.0 + luma(src.rgb) * 0.25) + ink * (minor * 0.08 + major * 0.15);
      float e = smoothstep(0.15, 0.4, sobel(uv, vec2(max(0.0012, 1.5 / max(res.x, res.y))) * S) * p1 / 100.0 * 2.0);
      colr = mix(colr, ink, e * 0.9);
      vec2 id = floor(g);
      float ec = sobel((id + 0.5) / p0 * S, vec2(0.003) * S);
      if (ec > 0.35 && hash(id + 3.3) < p8 / 100.0) {
        float ring = 1.0 - smoothstep(0.03, 0.07, abs(length(fg - 0.5) - 0.16));
        float dotc = 1.0 - smoothstep(0.05, 0.08, length(fg - 0.5));
        float tick = (1.0 - smoothstep(0.0, 0.03, abs(fg.y - 0.5))) * step(0.66, fg.x);
        colr = mix(colr, ink, max(max(ring, dotc), tick));
      }
      o.rgb = colr;` },
  { id: "specimen", name: "Specimen", category: "Geometric", desc: "A specimen sheet of boxed swatches sampled from the image.", params: [
      r("cells", "Swatches across", 4, 40, 12), r("gap", "Gap", 0, 40, 12), col("paper", "Paper", "#f3f0ea"), col("line", "Line", "#1a1a1a"), onOff("labels", "Labels", 1)],
    preview: { cells: 6 },
    glsl: `
      vec2 q = uv / S * p0; vec2 id = floor(q); vec2 f = fract(q);
      vec2 cu = (id + 0.5) / p0 * S;
      vec2 o2 = vec2(0.25 / p0) * S;
      vec3 c = (tex(cu).rgb + tex(cu + o2).rgb + tex(cu - o2).rgb + tex(cu + vec2(o2.x, -o2.y)).rgb + tex(cu - vec2(o2.x, -o2.y)).rgb) / 5.0;
      float g = p1 / 100.0 * 0.3 + 0.02;
      float bottom = p8 > 0.5 ? 0.22 : g;
      vec3 colr = vec3(p2, p3, p4);
      float px1 = p0 / max(res.x, res.y);
      bool inBox = f.x > g && f.x < 1.0 - g && f.y > g && f.y < 1.0 - bottom;
      bool inFrame = f.x > g - px1 * 2.0 && f.x < 1.0 - g + px1 * 2.0 && f.y > g - px1 * 2.0 && f.y < 1.0 - bottom + px1 * 2.0;
      if (inFrame) colr = vec3(p5, p6, p7);
      if (inBox) colr = c;
      if (p8 > 0.5 && f.x > g && f.x < 1.0 - g && f.y > 1.0 - bottom + 0.03 && f.y < 1.0 - 0.04) {
        float row = floor((f.y - (1.0 - bottom + 0.03)) / 0.05);
        float lenr = 0.35 + hash(id + row) * 0.5;
        float bar = step(f.x, g + lenr * (1.0 - 2.0 * g)) * step(0.4, fract((f.y - (1.0 - bottom + 0.03)) / 0.05));
        colr = mix(colr, vec3(p5, p6, p7), bar * (row < 0.5 ? 0.9 : 0.45));
      }
      o.rgb = colr;` },
  { id: "contour", name: "Topography", category: "Geometric", desc: "Contour lines like a topographic map, traced from tone.", params: [
      r("levels", "Levels", 3, 30, 10), r("width", "Line width", 0.5, 4, 1.2, 0.1), r("smooth", "Smoothing", 0, 3, 0.6, 0.05, "%"),
      sel("mode", "Style", 0, [["Lines", 0], ["Topographic bands", 1], ["Over photo", 2]]),
      col("ink", "Ink", "#1b1b1b"), col("paper", "Paper", "#f3efe4")],
    preview: { smooth: 2, levels: 7 },
    presets: [
      { name: "Topo map", values: { mode: 1, ink: "#2f4a2a", paper: "#efe8d0", levels: 12 } },
      { name: "Fine lines", values: { mode: 0, ink: "#1b1b1b", paper: "#f3efe4", levels: 18, width: 0.8 } },
      { name: "Gold lines", values: { mode: 2, ink: "#ffd166", levels: 10 } },
    ],
    glsl: `
      float r0 = p2 / 100.0;
      vec2 dx = vec2(px.x * 1.5, 0.0), dy = vec2(0.0, px.y * 1.5);
      float l = luma(r0 > 0.0 ? discBlur(uv, r0) : src.rgb);
      float lx = luma(r0 > 0.0 ? discBlur(uv + dx, r0) : tex(uv + dx).rgb);
      float ly = luma(r0 > 0.0 ? discBlur(uv + dy, r0) : tex(uv + dy).rgb);
      float grad = length(vec2(lx - l, ly - l)) / 1.5 * p0 + 0.0001;
      float v = l * p0;
      float fv = fract(v);
      float dpx = min(fv, 1.0 - fv) / grad;
      float wpx = p1 * max(1.0, max(res.x, res.y) / 1000.0);
      float line = 1.0 - smoothstep(wpx * 0.5, wpx * 0.5 + 1.0, dpx);
      vec3 ink = vec3(p4, p5, p6), paper = vec3(p7, p8, p9);
      vec3 base = p3 < 0.5 ? paper : p3 < 1.5 ? mix(ink, paper, 0.35 + 0.65 * (floor(v) + 0.5) / p0) : src.rgb;
      o.rgb = mix(base, p3 > 0.5 && p3 < 1.5 ? ink * 0.7 : ink, line);` },
  { id: "truchet", name: "Truchet", category: "Geometric", desc: "Truchet tiles: curved arcs woven into a flowing pattern.", params: [
      r("tiles", "Tiles across", 10, 120, 40), r("weight", "Line weight", 10, 100, 60), sel("color", "Colour", 0, [["Ink", 0], ["Original", 1]]),
      col("ink", "Ink", "#161616"), col("paper", "Paper", "#f5f1e6"), seed],
    preview: { tiles: 16 },
    glsl: `
      vec2 q = uv / S * p0; vec2 id = floor(q); vec2 f = fract(q);
      if (hash(id + 1.3 + p9) > 0.5) f.x = 1.0 - f.x;
      float d = min(abs(length(f) - 0.5), abs(length(f - 1.0) - 0.5));
      vec3 c = tex((id + 0.5) / p0 * S).rgb;
      float dark = 1.0 - tone(luma(c), 120.0);
      float w = (0.04 + dark * 0.42) * p1 / 100.0;
      float aa = p0 / max(res.x, res.y) * 1.5;
      float m = 1.0 - smoothstep(w - aa, w + aa, d);
      o.rgb = mix(vec3(p6, p7, p8), p2 > 0.5 ? c : vec3(p3, p4, p5), m);` },

  // ══ Glass ══════════════════════════════════════════════════════════
  { id: "fluted-glass", name: "Fluted glass", category: "Glass", desc: "Reeded glass slices and offsets the image like a shower screen.", params: [
      r("reeds", "Reeds", 5, 120, 30), r("refraction", "Refraction", 0, 100, 50), r("shading", "Shading", 0, 100, 40), r("blur", "Blur", 0, 100, 20),
      r("angle", "Angle", 0, 180, 0, 1, "°")],
    glsl: `
      vec2 dir = vec2(cos(radians(p4)), sin(radians(p4)));
      float t = dot(uv / S, dir) * p0;
      float k = fract(t) - 0.5;
      vec2 off = dir * (-k * p1 / 100.0 * 3.0 / p0) * S;
      vec3 c = p3 > 0.0 ? discBlur(uv + off, p3 / 100.0 * 0.006) : tex(uv + off).rgb;
      c *= 1.0 - p2 / 100.0 * 0.35 * k * k * 4.0;
      c += p2 / 100.0 * 0.25 * pow(max(0.0, 1.0 - abs(k + 0.25) * 6.0), 3.0);
      o.rgb = c;` },
  { id: "am-frosted", name: "Frosted glass", category: "Glass", alias: "glass", desc: "Softened and scattered as if behind textured panes.",
    overrides: { amount: 1.2, frost: 25 } },
  { id: "glass-orb", name: "Glass orb", category: "Glass", desc: "The scene refracted through a crystal ball.", params: [
      r("radius", "Orb size", 10, 60, 35), r("x", "Centre X", 0, 100, 50), r("y", "Centre Y", 0, 100, 50), r("refraction", "Magnify", 0, 100, 60),
      r("bgBlur", "Background blur", 0, 100, 40), r("dim", "Background dim", 0, 100, 30)],
    glsl: `
      vec2 c = vec2(p1, p2) / 100.0;
      vec2 d = uv - c; d.x *= aspect;
      float R = p0 / 100.0;
      float rr = length(d) / R;
      if (rr < 1.0) {
        float z = sqrt(1.0 - rr * rr);
        vec2 n = d / R;
        vec2 s = c - vec2(d.x / aspect, d.y) * (1.6 - z) * mix(0.9, 0.45, p3 / 100.0);
        vec3 colr = tex(s).rgb * (0.82 + 0.18 * z);
        colr += pow(1.0 - z, 3.0) * 0.35;
        colr += (1.0 - smoothstep(0.0, 0.22, length(n - vec2(-0.38, -0.42)))) * 0.6;
        colr *= 1.0 - smoothstep(0.92, 1.0, rr) * 0.3;
        o.rgb = colr;
      } else {
        vec3 bg = p4 > 0.0 ? discBlur(uv, p4 / 100.0 * 0.03) : src.rgb;
        vec2 sd = d - vec2(0.0, R * 0.9);
        float shadow = exp(-dot(sd * vec2(1.0, 3.0), sd * vec2(1.0, 3.0)) / (R * R * 0.4)) * 0.4;
        o.rgb = bg * (1.0 - p5 / 100.0) * (1.0 - shadow);
      }` },
  { id: "shatter", name: "Shatter", category: "Glass", desc: "Shattered glass: the image cracked into displaced shards.", params: [
      r("shards", "Shards", 4, 60, 18), r("displace", "Displacement", 0, 100, 40), r("cracks", "Cracks", 0, 100, 60), seed],
    glsl: `
      vec2 best; float d1; float d2;
      voronoi(uv / S * p0, 1.0, p3, best, d1, d2);
      vec2 off = (hash2(floor(best * 7.31) + p3) - 0.5) * p1 / 100.0 * 0.05 * S;
      vec3 c = tex(uv + off).rgb * (0.9 + 0.2 * hash(floor(best * 3.7)));
      float aa = p0 / max(res.x, res.y) * 1.5;
      float crack = 1.0 - smoothstep(aa * 0.5, aa * 2.0, d2 - d1);
      c = mix(c, vec3(0.95), crack * p2 / 100.0 * 0.8);
      c = mix(c, c * 0.6, (1.0 - smoothstep(aa * 2.0, aa * 5.0, d2 - d1)) * p2 / 100.0 * 0.4);
      o.rgb = c;` },
  { id: "voronoi", name: "Tinted glass", category: "Glass", desc: "Tinted panes leaded into a stained-glass window.", params: [
      r("cells", "Cells", 5, 80, 24), r("border", "Lead width", 0, 30, 6), col("lead", "Lead colour", "#141414"),
      r("jitter", "Irregularity", 0, 100, 90), seed],
    glsl: `
      vec2 best; float d1; float d2;
      voronoi(uv / S * p0, p5 / 100.0, p6, best, d1, d2);
      vec3 c = tex(best / p0 * S).rgb;
      float aa = p0 / max(res.x, res.y) * 1.5;
      float m = smoothstep(p1 / 100.0 - aa, p1 / 100.0 + aa, d2 - d1);
      o.rgb = mix(vec3(p2, p3, p4), c * (1.05 + (0.35 - d1) * 0.3), m);` },
  { id: "vitrine", name: "Vitrine", category: "Glass", desc: "Pressed glass: refractive pyramid facets over the photo.", params: [
      r("cells", "Facets across", 5, 60, 18), r("refraction", "Refraction", 0, 100, 50), r("shading", "Shading", 0, 100, 50),
      sel("shape", "Shape", 0, [["Square", 0], ["Diamond", 1]])],
    glsl: `
      float ang = p3 > 0.5 ? 0.7854 : 0.0;
      vec2 q = rot(uv / S, ang) * p0;
      vec2 f = fract(q) - 0.5;
      vec2 n = abs(f.x) > abs(f.y) ? vec2(sign(f.x), 0.0) : vec2(0.0, sign(f.y));
      vec2 nn = rot(n, -ang);
      vec3 c = tex(uv + nn * p1 / 100.0 * 0.5 / p0 * S).rgb;
      c *= 1.0 + dot(nn, vec2(-0.6, -0.8)) * 0.25 * p2 / 100.0;
      float px1 = p0 / max(res.x, res.y);
      float ridge = 1.0 - smoothstep(0.0, px1 * 2.0, abs(abs(f.x) - abs(f.y)));
      c += ridge * 0.12 * p2 / 100.0;
      o.rgb = c;` },

  // ══ Light & Color ══════════════════════════════════════════════════
  { id: "disco", name: "Disco ball", category: "Light & Color", desc: "Your image wrapped onto a mirror ball with glints.", params: [
      r("tiles", "Tiles", 10, 60, 28), r("size", "Ball size", 30, 100, 80), r("sparkle", "Sparkle", 0, 100, 60), col("bg", "Background", "#07060c")],
    glsl: `
      vec2 d = uv - 0.5; d.x *= aspect;
      float R = p1 / 200.0;
      float rr = length(d) / R;
      vec3 colr = vec3(p3, p4, p5);
      if (rr < 1.0) {
        vec3 n = vec3(d / R, sqrt(1.0 - rr * rr));
        vec2 sph = vec2(atan(n.x, n.z) / 3.14159 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.14159 + 0.5);
        vec2 t = sph * p0; vec2 tid = floor(t); vec2 tf = fract(t);
        float gap = step(0.08, tf.x) * step(0.08, tf.y) * step(tf.x, 0.92) * step(tf.y, 0.92);
        vec3 c = tex((tid + 0.5) / p0).rgb;
        float glint = pow(hash(tid + 7.0), 18.0) * p2 / 100.0 * 3.0;
        float spec = pow(max(dot(n, normalize(vec3(-0.4, -0.5, 0.8))), 0.0), 30.0);
        colr = mix(vec3(0.05), c * (0.55 + 0.45 * n.z) * (0.8 + 0.4 * hash(tid)) + glint + spec, gap);
      } else {
        vec2 cell = floor(uv * res / 7.0);
        float sp = step(0.988, hash(cell)) * p2 / 100.0;
        colr += sp * tex(hash2(cell)).rgb * 1.5 + exp(-(rr - 1.0) * 6.0) * 0.12;
      }
      o.rgb = colr;` },
  { id: "am-aberration", name: "Aberration", category: "Light & Color", alias: "chromatic", desc: "Colour channels split with a lens-fringe bulge.", overrides: { amount: 70 } },
  { id: "anaglyph", name: "Anaglyph 3D", category: "Light & Color", desc: "Red/cyan offset channels for a retro stereoscopic pop.", params: [
      r("offset", "Offset", 0, 3, 0.8, 0.05, "%"), sel("mode", "Mode", 0, [["Colour", 0], ["Grey", 1]]), r("depth", "Depth from brightness", 0, 100, 50)],
    glsl: `
      float l = luma(src.rgb);
      vec2 off = vec2(p0 / 100.0 * mix(1.0, l * 1.6, p2 / 100.0), 0.0) * S;
      vec3 a = tex(uv + off).rgb, b = tex(uv - off).rgb;
      if (p1 > 0.5) { a = vec3(luma(a)); b = vec3(luma(b)); }
      o.rgb = vec3(a.r, b.g, b.b);` },
  { id: "dreamdust", name: "Dreamdust", category: "Light & Color", desc: "A soft dust of glowing particles drifting over the image.", params: [
      r("density", "Density", 0, 100, 50), r("size", "Particle size", 0.1, 1.5, 0.4, 0.05, "%"), r("glow", "Glow", 0, 100, 50),
      col("color", "Colour", "#fff2d6"), seed, r("dream", "Dreamy haze", 0, 100, 30)],
    glsl: `
      vec3 base = mix(src.rgb, 1.0 - (1.0 - src.rgb) * (1.0 - discBlur(uv, 0.02)), p7 / 100.0 * 0.6);
      float sc = p1 / 100.0 * 4.0;
      vec2 g = uv / S / sc; vec2 id = floor(g), f = fract(g);
      float acc = 0.0;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 nb = vec2(float(i), float(j));
          if (hash(id + nb + 3.0 + p6) < p0 / 100.0 * 0.4) {
            vec2 pt = nb + hash2(id + nb + p6);
            float d = length(f - pt) / 0.25;
            float w = 0.4 + luma(tex((id + pt) * sc * S).rgb);
            acc += (exp(-d * d * 6.0) + exp(-d * d * 0.8) * p2 / 100.0 * 0.25) * w * (0.5 + hash(id + nb + 8.0));
          }
        }
      }
      o.rgb = base + vec3(p3, p4, p5) * acc;` },
  { id: "duotone", name: "Duotone", category: "Light & Color", alias: "gradient-map", desc: "Shadows and highlights mapped to a colour pair.",
    overrides: { palette: 6, c1: "#1b1464", c2: "#ff7eb6" },
    presets: [
      { name: "Berry", values: { c1: "#1b1464", c2: "#ff7eb6" } }, { name: "Lagoon", values: { c1: "#0b3d3a", c2: "#9ff2d8" } },
      { name: "Ember", values: { c1: "#2a0a00", c2: "#ffb347" } }, { name: "Spotify", values: { c1: "#1e3264", c2: "#1ed760" } },
    ] },
  { id: "neon-edges", name: "Edge glow", category: "Light & Color", desc: "Edges traced in glowing neon over a dark ground.", params: [
      r("width", "Line width", 0.05, 1, 0.15, 0.01, "%"), r("threshold", "Threshold", 0, 100, 20),
      sel("mode", "Style", 0, [["Neon", 0], ["Ink on paper", 1], ["Over photo", 2]]),
      col("ink", "Line colour", "#ff3df2"), col("paper", "Background", "#05040b"), r("glow", "Glow", 0, 100, 60),
      sel("rainbow", "Colour", 0, [["Solid", 0], ["Rainbow", 1]])],
    preview: { width: 0.5 },
    presets: [
      { name: "Neon pink", values: { mode: 0, ink: "#ff3df2", paper: "#05040b", glow: 60, rainbow: 0 } },
      { name: "Cyber blue", values: { mode: 0, ink: "#57d8ff", paper: "#04121f", glow: 70, rainbow: 0 } },
      { name: "Rainbow", values: { mode: 0, paper: "#000000", glow: 60, rainbow: 1 } },
      { name: "Ink sketch", values: { mode: 1, ink: "#151515", paper: "#f5f1e8", glow: 0, rainbow: 0 } },
      { name: "Glow outline", values: { mode: 2, ink: "#ffffff", glow: 70, rainbow: 0 } },
    ],
    glsl: `
      vec2 s = vec2(p0 / 100.0) * S;
      float t = p1 / 100.0;
      float e = smoothstep(t, t + 0.15, sobel(uv, s));
      float g = 0.0;
      if (p9 > 0.0) {
        for (int i = 0; i < 12; i++) {
          float fi = float(i); float a = fi * 2.39996; float rr = sqrt((fi + 0.5) / 12.0) * p0 / 100.0 * 8.0;
          g += smoothstep(t, t + 0.15, sobel(uv + vec2(cos(a), sin(a)) * rr * S, s));
        }
        g = g / 12.0 * p9 / 100.0 * 1.5;
      }
      vec3 ink = vec3(p3, p4, p5);
      if (p10 > 0.5) ink = 0.5 + 0.5 * cos(6.28318 * (uv.x * 0.8 + uv.y * 0.4 + vec3(0.0, 0.33, 0.67)));
      if (p2 < 0.5) o.rgb = vec3(p6, p7, p8) + ink * (e + g);
      else if (p2 < 1.5) o.rgb = mix(vec3(p6, p7, p8), ink, clamp(e + g * 0.5, 0.0, 1.0));
      else o.rgb = mix(src.rgb * 0.35, ink + src.rgb * 0.3, clamp(e + g, 0.0, 1.0));` },
  { id: "gradient-map", name: "Gradient map", category: "Light & Color", desc: "Tone remapped to a colour gradient, from duotone to rainbow.", params: [
      sel("palette", "Palette", 0, [["Thermal", 0], ["Sunset", 1], ["Ocean", 2], ["Acid", 3], ["Noir", 4], ["Vaporwave", 5], ["Custom", 6]]),
      r("cycles", "Cycles", 1, 5, 1, 0.1), r("steps", "Steps (0 = smooth)", 0, 16, 0), contrast(110), r("mix", "Mix", 0, 100, 100),
      col("c1", "Custom shadows", "#160f3b"), col("c2", "Custom highlights", "#ffd166")],
    presets: [
      { name: "Thermal", values: { palette: 0, cycles: 1, steps: 0 } },
      { name: "Heat steps", values: { palette: 0, cycles: 1, steps: 7 } },
      { name: "Psychedelic", values: { palette: 3, cycles: 3, steps: 0 } },
      { name: "Vaporwave", values: { palette: 5, cycles: 1, steps: 0 } },
      { name: "Noir", values: { palette: 4, cycles: 1, steps: 0, contrast: 150 } },
    ],
    fns: `
      vec3 grad4(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
        return t < 0.333 ? mix(a, b, t * 3.0) : t < 0.666 ? mix(b, c, (t - 0.333) * 3.0) : mix(c, d, (t - 0.666) * 3.0);
      }
      vec3 palette(float k, float t, vec3 c1, vec3 c2) {
        if (k < 0.5) return grad4(vec3(0.0, 0.0, 0.15), vec3(0.55, 0.0, 0.75), vec3(1.0, 0.25, 0.1), vec3(1.0, 0.95, 0.6), t);
        if (k < 1.5) return grad4(vec3(0.12, 0.05, 0.25), vec3(0.75, 0.15, 0.4), vec3(1.0, 0.5, 0.25), vec3(1.0, 0.88, 0.6), t);
        if (k < 2.5) return grad4(vec3(0.0, 0.05, 0.15), vec3(0.0, 0.3, 0.5), vec3(0.1, 0.7, 0.75), vec3(0.85, 1.0, 0.95), t);
        if (k < 3.5) return grad4(vec3(0.05, 0.0, 0.2), vec3(0.0, 0.9, 0.4), vec3(0.95, 1.0, 0.0), vec3(1.0, 0.2, 0.8), t);
        if (k < 4.5) return grad4(vec3(0.0), vec3(0.15, 0.14, 0.16), vec3(0.6, 0.58, 0.55), vec3(1.0, 0.98, 0.94), t);
        if (k < 5.5) return grad4(vec3(0.1, 0.0, 0.3), vec3(0.95, 0.2, 0.75), vec3(0.3, 0.85, 1.0), vec3(1.0, 0.95, 1.0), t);
        return mix(c1, c2, t);
      }`,
    glsl: `
      float l = tone(luma(src.rgb), p3);
      float t = p1 > 1.0 ? fract(l * p1 * 0.9999) : l;
      if (p2 >= 2.0) t = floor(t * p2) / (p2 - 1.0);
      o.rgb = mix(src.rgb, palette(p0, clamp(t, 0.0, 1.0), vec3(p5, p6, p7), vec3(p8, p9, p10)), p4 / 100.0);` },
  { id: "am-kaleidoscope", name: "Kaleidoscope", category: "Light & Color", alias: "kaleidoscope", desc: "The image mirrored into radial petals." },
  { id: "light-wind", name: "Light wind", category: "Light & Color", desc: "Streaks of light swept across the frame like a long exposure.", params: [
      r("length", "Streak length", 0, 50, 20, 1, "%"), r("threshold", "Threshold", 0, 100, 55), r("amount", "Intensity", 0, 100, 60),
      r("angle", "Direction", 0, 360, 0, 1, "°"), col("tint", "Tint", "#ffffff")],
    glsl: `
      vec2 dir = vec2(cos(radians(p3)), sin(radians(p3))) * p0 / 100.0 * S / 32.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 32; i++) {
        float t = float(i);
        vec3 c = tex(uv - dir * t).rgb;
        acc += max(c - p1 / 100.0, 0.0) * (1.0 - t / 32.0);
      }
      o.rgb = src.rgb + acc / 10.0 * vec3(p4, p5, p6) * p2 / 100.0 * 2.0;` },
  { id: "am-prism", name: "Prism", category: "Light & Color", alias: "prism", desc: "Prismatic dispersion: light split into rainbow fringes.", overrides: { amount: 1.5, rainbow: 60 } },
  { id: "warpbloom", name: "Warpbloom", category: "Light & Color", desc: "A warped bloom: light smeared and blossomed from the highlights.", params: [
      r("amount", "Intensity", 0, 100, 60), r("threshold", "Threshold", 0, 100, 55), r("spread", "Spread", 0.5, 8, 3, 0.1, "%"), r("warp", "Warp", 0, 100, 60),
      seed, col("tint", "Tint", "#ffe7f3")],
    glsl: `
      vec2 w = (vec2(fbm(uv / S * 3.0 + p4), fbm(uv / S * 3.0 + p4 + 7.0)) - 0.5) * p3 / 100.0 * 0.12 * S;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        float fi = float(i); float a = fi * 2.39996; float rr = sqrt((fi + 0.5) / 40.0) * p2 / 100.0;
        acc += max(tex(uv + w + vec2(cos(a), sin(a)) * rr * S).rgb - p1 / 100.0, 0.0);
      }
      o.rgb = src.rgb + acc / 40.0 * vec3(p5, p6, p7) * p0 / 100.0 * 3.5;` },
  { id: "vignette", name: "Vignette", category: "Light & Color", desc: "Darkened corners. A finishing touch used by many recipes.", params: [
      r("amount", "Amount", 0, 100, 50), r("size", "Size", 0, 100, 50), r("soft", "Softness", 0, 100, 50), col("color", "Colour", "#000000")],
    glsl: `
      vec2 d = (uv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0) * 2.0;
      float rr = length(d);
      float inner = mix(0.2, 1.1, p1 / 100.0);
      float v = smoothstep(inner, inner + 0.1 + p2 / 100.0 * 0.9, rr);
      o.rgb = mix(src.rgb, vec3(p3, p4, p5), v * p0 / 100.0);` },

  // ══ Material ═══════════════════════════════════════════════════════
  { id: "chrome", name: "Chrome", category: "Material", desc: "Liquid chrome: the image cast in polished metal.", params: [
      r("bump", "Relief", 0, 100, 60), r("smooth", "Smoothness", 0, 100, 50), col("tint", "Tint", "#dfe7f2"), r("bands", "Reflections", 1, 6, 2, 0.1)],
    glsl: `
      float rad = 0.006 + p1 / 100.0 * 0.012;
      float st = rad * 0.5;
      float l = luma(discBlur(uv, rad));
      float lx = luma(discBlur(uv + vec2(st, 0.0) * S, rad));
      float ly = luma(discBlur(uv + vec2(0.0, st) * S, rad));
      vec3 n = normalize(vec3(-vec2(lx - l, ly - l) / st * 0.02 * p0 / 100.0 * 3.0, 1.0));
      float t = fract(l * p5 * 0.5 + n.y * 0.6 + n.x * 0.2);
      vec3 env = t < 0.3 ? mix(vec3(0.08, 0.09, 0.11), vec3(0.95), t / 0.3) : t < 0.5 ? mix(vec3(0.95), vec3(0.15, 0.16, 0.2), (t - 0.3) / 0.2) : t < 0.65 ? mix(vec3(0.15, 0.16, 0.2), vec3(0.7, 0.74, 0.8), (t - 0.5) / 0.15) : mix(vec3(0.7, 0.74, 0.8), vec3(1.0), (t - 0.65) / 0.35);
      float spec = pow(max(dot(n, normalize(vec3(-0.4, -0.6, 0.7))), 0.0), 40.0);
      o.rgb = env * vec3(p2, p3, p4) + spec;` },
  { id: "crystallize", name: "Crystallize", category: "Material", alias: "voronoi", desc: "The photo faceted into crystal cells.",
    overrides: { border: 0, jitter: 100, cells: 40 } },
  { id: "am-emboss", name: "Emboss", category: "Material", alias: "emboss", desc: "Embossed relief: the image pressed into raised metal.", overrides: { mix: 40 } },
  { id: "marble", name: "Marble", category: "Material", desc: "Tone veined into swirling polished marble.", params: [
      r("veins", "Veins", 1, 20, 6), r("turb", "Turbulence", 0, 100, 60), col("stone", "Stone", "#e9e4dc"), col("vein", "Vein", "#3a3530"), r("photo", "Picture showing", 0, 100, 60), seed],
    glsl: `
      vec2 q = uv / S;
      float l = luma(src.rgb);
      float v = abs(sin((q.x + q.y) * p0 * 3.0 + fbm(q * 4.0 + p9) * p1 / 10.0 + l * 4.0));
      float vein = pow(1.0 - v, 6.0) + pow(1.0 - v, 30.0) * 0.6;
      vec3 stone = mix(vec3(p2, p3, p4) * mix(1.0, 0.4 + l, p8 / 100.0), vec3(p2, p3, p4), 0.3);
      o.rgb = mix(stone, vec3(p5, p6, p7), clamp(vein, 0.0, 1.0)) + pow(max(1.0 - length(uv - vec2(0.3, 0.2)) * 1.5, 0.0), 4.0) * 0.12;` },
  { id: "molten-metal", name: "Molten metal", category: "Material", desc: "The subject poured in glowing liquid alloy.", params: [
      r("heat", "Heat", 0, 100, 70), r("bump", "Relief", 0, 100, 50), r("glow", "Glow", 0, 100, 50)],
    glsl: `
      float l = luma(discBlur(uv, 0.008));
      float lx = luma(discBlur(uv + vec2(0.004, 0.0) * S, 0.008)), ly = luma(discBlur(uv + vec2(0.0, 0.004) * S, 0.008));
      vec3 n = normalize(vec3(-vec2(lx - l, ly - l) / 0.004 * 0.02 * p1 / 100.0 * 3.0, 1.0));
      float t = clamp(l * (0.6 + p0 / 100.0 * 0.6), 0.0, 1.0);
      vec3 hot = t < 0.3 ? mix(vec3(0.02, 0.0, 0.0), vec3(0.45, 0.03, 0.0), t / 0.3) : t < 0.6 ? mix(vec3(0.45, 0.03, 0.0), vec3(1.0, 0.35, 0.0), (t - 0.3) / 0.3) : t < 0.85 ? mix(vec3(1.0, 0.35, 0.0), vec3(1.0, 0.8, 0.2), (t - 0.6) / 0.25) : mix(vec3(1.0, 0.8, 0.2), vec3(1.0, 1.0, 0.85), (t - 0.85) / 0.15);
      float spec = pow(max(dot(n, normalize(vec3(-0.4, -0.6, 0.7))), 0.0), 30.0);
      vec3 glow = max(discBlur(uv, 0.02) - 0.55, 0.0) * vec3(1.0, 0.45, 0.1) * p2 / 100.0 * 2.0;
      o.rgb = hot * (0.75 + 0.25 * n.z) + spec * vec3(1.0, 0.85, 0.6) + glow;` },
  { id: "am-oil", name: "Oil paint", category: "Material", alias: "oil", desc: "Thick directional brush strokes.", overrides: { brush: 2.2 } },
  { id: "thin-film", name: "Thin-film", category: "Material", desc: "An oil-slick rainbow sheen over the form.", params: [
      r("strength", "Strength", 0, 100, 60), r("bands", "Bands", 1, 10, 3, 0.1), r("swirl", "Swirl", 0, 100, 40), seed],
    glsl: `
      float l = luma(src.rgb);
      float th = l * p1 + fbm(uv / S * 4.0 + p3) * p2 / 100.0 * 2.0;
      vec3 irid = 0.5 + 0.5 * cos(6.28318 * (th + vec3(0.0, 0.33, 0.67)));
      vec3 sc = 1.0 - (1.0 - src.rgb) * (1.0 - irid * 0.8);
      o.rgb = mix(src.rgb, mix(sc, irid * (0.4 + l), 0.35), p0 / 100.0);` },
  { id: "watercolor", name: "Watercolour", category: "Material", desc: "Soft pigment washes bleeding into the paper.", params: [
      r("wash", "Wash softness", 0, 100, 60), r("edges", "Edge darkening", 0, 100, 50), r("gran", "Granulation", 0, 100, 40), col("paper", "Paper", "#f7f3ea"),
      r("levels", "Pigment levels", 3, 12, 6)],
    glsl: `
      vec2 w = (vec2(fbm(uv / S * 8.0), fbm(uv / S * 8.0 + 5.0)) - 0.5) * 0.015 * S;
      vec3 c = discBlur(uv + w, p0 / 100.0 * 0.012 + 0.001);
      c = mix(c, floor(c * p6) / p6 + 0.5 / p6, 0.5);
      c = 1.0 - (1.0 - c) * 0.85;
      c *= vec3(p3, p4, p5) / max(max(p3, p4), p5);
      vec3 c2 = discBlur(uv + w, p0 / 100.0 * 0.03 + 0.004);
      c *= 1.0 - clamp(luma(c2) - luma(c), 0.0, 1.0) * p1 / 100.0 * 3.0;
      c *= 1.0 - (fbm(uv / S * 120.0) - 0.5) * p2 / 100.0 * 0.3;
      o.rgb = c * (0.97 + 0.03 * vnoise(uv * res * 0.5));` },
  { id: "waves", name: "Waves", category: "Material", desc: "The surface rippled into flowing liquid waves.", params: [
      r("amp", "Amplitude", 0, 5, 1.2, 0.05, "%"), r("wave", "Wavelength", 1, 30, 6, 0.5, "%"), r("angle", "Angle", 0, 180, 20, 1, "°"),
      r("shading", "Shading", 0, 100, 50), r("phase", "Phase", 0, 100, 0)],
    glsl: `
      vec2 q = uv / S; vec2 dir = vec2(cos(radians(p2)), sin(radians(p2)));
      float k = 6.28318 / (p1 / 100.0);
      float ph = dot(q, dir) * k + sin(dot(q, rot(dir, 1.2)) * k * 0.5) * 1.5 + p4 * 0.0628;
      vec2 off = dir * cos(ph) * p0 / 100.0 * S;
      float h = sin(ph);
      o.rgb = tex(uv + off).rgb * (1.0 + h * p3 / 100.0 * 0.25) + pow(max(h, 0.0), 12.0) * p3 / 100.0 * 0.3;` },

  // ══ Glitch ═════════════════════════════════════════════════════════
  { id: "am-glitch", name: "Glitch", category: "Glitch", alias: "glitch", desc: "Slice displacement, RGB split and corrupted blocks." },
  { id: "beacon", name: "Beacon", category: "Glitch", alias: "god-rays", desc: "Directional beacon glow streaming from the bright points.",
    overrides: { x: 50, y: 40, length: 80, threshold: 45, amount: 70 } },
  { id: "am-crt", name: "CRT screen", category: "Glitch", alias: "crt", desc: "Curved glass, scanlines and phosphor glow." },
  { id: "datamosh", name: "Datamosh", category: "Glitch", desc: "Compression artefacts smear and bloom across the frame.", params: [
      r("block", "Block size", 1, 10, 3, 0.1, "%"), r("amount", "Amount", 0, 100, 60), r("smear", "Smear", 0, 100, 50), seed],
    glsl: `
      float bs = p0 / 100.0;
      vec2 g = uv / S / bs; vec2 id = floor(g);
      float pick = step(1.0 - p1 / 100.0 * 0.7, hash(id + p3));
      vec2 mv = (hash2(id + p3 + 3.1) - 0.5) * 6.0 * bs * S * pick;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 12; i++) acc += tex(uv - mv * float(i) / 11.0 * p2 / 100.0).rgb;
      vec3 c = mix(src.rgb, acc / 12.0, pick);
      c = mix(c, tex((id + 0.5) * bs * S + mv).rgb, pick * 0.5);
      c = mix(c, floor(c * 8.0 + 0.5) / 8.0, pick);
      o.rgb = c;` },
  { id: "digital-distortion", name: "Digital distortion", category: "Glitch", alias: "glitch", desc: "A heavier glitch stack: slices, RGB split and scan damage.",
    overrides: { amount: 85, slices: 70, shift: 1.6 } },
  { id: "forensics", name: "Forensics", category: "Glitch", desc: "An error-level look: heat over the tampered-looking image.", params: [
      r("sens", "Sensitivity", 0, 100, 60), r("photo", "Picture showing", 0, 100, 35), onOff("grid", "Block grid", 1)],
    glsl: `
      vec3 b = discBlur(uv, 0.002);
      float diff = clamp(length(src.rgb - b) * p0 / 100.0 * 8.0, 0.0, 1.0);
      vec3 colr = vec3(luma(src.rgb)) * p1 / 100.0 + heat(diff) * diff;
      if (p2 > 0.5) { vec2 bp = fract(uv * res / 8.0); colr += (step(bp.x, 0.08) + step(bp.y, 0.08)) * 0.04; }
      o.rgb = colr;` },
  { id: "lofi", name: "Lofi", category: "Glitch", alias: "vhs", desc: "Lo-fi tape: muted colour, grain and a soft wobble.",
    overrides: { shift: 0.3, lines: 20, noise: 25, wobble: 40, fade: 55 } },
  { id: "pixel-sort", name: "Pixel sort", category: "Glitch", desc: "Rows of pixels dragged into glitched streaks.", params: [
      r("length", "Streak length", 1, 50, 18, 1, "%"), r("low", "Lower threshold", 0, 100, 25), r("high", "Upper threshold", 0, 100, 90),
      r("angle", "Direction", 0, 360, 90, 1, "°"), sel("mode", "Sort by", 0, [["Brightest", 0], ["Darkest", 1]])],
    glsl: `
      vec2 dir = vec2(cos(radians(p3)), sin(radians(p3))) * p0 / 100.0 * S / 48.0;
      float lo = p1 / 100.0, hi = p2 / 100.0;
      float l0 = luma(src.rgb);
      if (l0 >= lo && l0 <= hi) {
        vec3 best = src.rgb; float bl = l0;
        for (int i = 1; i < 48; i++) {
          vec3 c = tex(uv - dir * float(i)).rgb;
          float l = luma(c);
          if (l < lo || l > hi) break;
          if (p4 < 0.5 ? l > bl : l < bl) { best = mix(best, c, 1.0 - float(i) / 48.0); bl = luma(best); }
        }
        o.rgb = best;
      }` },
  { id: "am-rgb-split", name: "RGB split", category: "Glitch", alias: "rgb-split", desc: "Colour channels torn apart horizontally.", overrides: { amount: 1.5 } },
  { id: "scanline", name: "Scanline", category: "Glitch", desc: "Broadcast scanlines and interlacing over the picture.", params: [
      r("lines", "Line count", 100, 1200, 480), r("dark", "Darkness", 0, 100, 50), r("shift", "Interlace shift", 0, 1, 0.15, 0.01, "%"), r("glow", "Glow", 0, 100, 30)],
    preview: { lines: 140 },
    glsl: `
      float row = floor(uv.y * p0);
      float odd = mod(row, 2.0);
      vec3 c = tex(uv + vec2(odd * p2 / 100.0 * S.x, 0.0)).rgb;
      float s = 0.5 + 0.5 * cos(fract(uv.y * p0) * 6.28318);
      c *= 1.0 - p1 / 100.0 * 0.6 * (1.0 - s);
      c += discBlur(uv, 0.004) * p3 / 100.0 * 0.25;
      o.rgb = c;` },
  { id: "am-thermal", name: "Thermal", category: "Glitch", alias: "thermal", desc: "Thermal camera: tone mapped to a heat palette." },

  // ══ Blur ═══════════════════════════════════════════════════════════
  { id: "am-gaussian", name: "Gaussian blur", category: "Blur", alias: "layer-blur", desc: "A soft, clean, dreamy defocus.", overrides: { radius: 2 } },
  { id: "am-motion", name: "Motion blur", category: "Blur", alias: "motion-blur", desc: "The subject streaked with speed.", overrides: { distance: 4 } },
  { id: "am-radial", name: "Radial blur", category: "Blur", alias: "zoom-blur", desc: "Motion zoomed out from the centre.", overrides: { amount: 50 } },
  { id: "am-tilt", name: "Tilt-shift", category: "Blur", alias: "tilt-shift", desc: "A sharp band with soft blur above and below: a miniature look." },

  // ══ Distort ════════════════════════════════════════════════════════
  { id: "am-pinch", name: "Pinch", category: "Distort", alias: "bulge", desc: "The centre pulled inward.", overrides: { amount: -60 } },
  { id: "polar", name: "Polar", category: "Distort", desc: "The image wrapped around a circular pole.", params: [
      sel("mode", "Mode", 0, [["Wrap", 0], ["Unwrap", 1]]), r("rotate", "Rotate", 0, 360, 0, 1, "°"), r("zoom", "Zoom", 50, 200, 100)],
    glsl: `
      if (p0 < 0.5) {
        vec2 d = uv - 0.5; d.x *= aspect;
        float rr = length(d) * 2.0 * 100.0 / p2;
        float a = atan(d.y, d.x) + radians(p1);
        o = tex(vec2(fract(a / 6.28318 + 0.5), 1.0 - clamp(rr, 0.0, 1.0)));
      } else {
        float a = uv.x * 6.28318 - radians(p1);
        float rr = (1.0 - uv.y) * 0.5 * p2 / 100.0;
        o = tex(0.5 + vec2(cos(a) / aspect, sin(a)) * rr);
      }` },
  { id: "am-ripple", name: "Ripple", category: "Distort", alias: "ripple", desc: "Concentric ripples, like a stone dropped in water.", overrides: { dir: 2, amp: 1.2 } },
  { id: "shear", name: "Shear", category: "Distort", desc: "The image slanted along one axis.", params: [
      r("amount", "Amount", -100, 100, 30), sel("axis", "Axis", 0, [["Horizontal", 0], ["Vertical", 1]]), sel("wrap", "Edges", 0, [["Wrap", 0], ["Stretch", 1]])],
    glsl: `
      vec2 q = uv;
      if (p1 < 0.5) q.x += (uv.y - 0.5) * p0 / 100.0; else q.y += (uv.x - 0.5) * p0 / 100.0;
      if (p2 < 0.5) q = fract(q);
      o = tex(q);` },
  { id: "smudge", name: "Smudge", category: "Distort", desc: "A finger smear dragged across the image.", params: [
      r("strength", "Strength", 0, 100, 50), r("angle", "Direction", 0, 360, 20, 1, "°"), r("width", "Stroke width", 5, 100, 40), seed],
    glsl: `
      float a = radians(p1);
      vec2 dir = vec2(cos(a), sin(a));
      float band = fbm(rot(uv / S, -a) * vec2(0.6, 50.0 / p2) + p3);
      float m = smoothstep(0.45, 0.7, band);
      vec3 acc = vec3(0.0); float tot = 0.0;
      for (int i = 0; i < 24; i++) {
        float t = float(i) / 23.0; float w = 1.0 - t * 0.7;
        acc += tex(uv - dir * t * p0 / 100.0 * 0.15 * m * S).rgb * w; tot += w;
      }
      o.rgb = acc / tot;` },
  { id: "am-spherize", name: "Spherize", category: "Distort", alias: "bulge", desc: "The image bulged out onto a sphere.", overrides: { amount: 90, radius: 50 } },
  { id: "am-twirl", name: "Twirl", category: "Distort", alias: "twirl", desc: "The centre spun into a spiral vortex." },
  { id: "zigzag", name: "ZigZag", category: "Distort", desc: "A zig-zag wave rippling across the image.", params: [
      r("amp", "Amplitude", 0, 5, 1, 0.05, "%"), r("wave", "Wavelength", 1, 30, 6, 0.5, "%"), sel("dir", "Direction", 0, [["Horizontal", 0], ["Vertical", 1], ["Circular", 2]])],
    glsl: `
      vec2 q = uv / S;
      float lam = p1 / 100.0;
      vec2 off;
      if (p2 < 0.5) off = vec2(0.0, abs(fract(q.x / lam) - 0.5) * 4.0 - 1.0);
      else if (p2 < 1.5) off = vec2(abs(fract(q.y / lam) - 0.5) * 4.0 - 1.0, 0.0);
      else { vec2 d = q - 0.5 / S; off = normalize(d + 1e-4) * (abs(fract(length(d) / lam) - 0.5) * 4.0 - 1.0); }
      o = tex(uv + off * p0 / 100.0 * S);` },
];

export const MAGIC_EFFECTS: MagicDef[] = defs.map((d) =>
  d.alias ? d : { ...d, fns: COMMON + (d.fns ?? "") },
);

// ══ Recipes: one-click stacks ═══════════════════════════════════════════
export interface Recipe {
  id: string;
  name: string;
  desc: string;
  stack: EffectState[];
}

const fx = (id: string, values: Record<string, number | string> = {}): EffectState => ({ id, values });

export const RECIPES: Recipe[] = [
  { id: "matrix", name: "Matrix", desc: "Green 01 code, CRT scanlines, phosphor bloom and vignette.",
    stack: [fx("ascii", { ramp: ramp("Binary"), color: 0, ink: "#39ff6a", backdrop: 1, paper: "#010702", cols: 110 }), fx("crt", { curve: 10, mask: 20 }), fx("bloom", { amount: 45, threshold: 40 }), fx("vignette", { amount: 60 })] },
  { id: "noir", name: "Noir", desc: "High-contrast black & white characters, grain, dust and a heavy vignette.",
    stack: [fx("ascii", { color: 0, ink: "#f2f2f2", backdrop: 1, paper: "#000000", contrast: 70 }), fx("grain", { amount: 40 }), fx("dust", { dust: 50, scratches: 30 }), fx("vignette", { amount: 80, size: 35 })] },
  { id: "vaporwave", name: "Vaporwave", desc: "Mosaic tiles, magenta cast, chromatic drift, scanlines and bloom.",
    stack: [fx("photo-mosaic", { size: 1.6 }), fx("gradient-map", { palette: 5, mix: 45 }), fx("chromatic", { amount: 50 }), fx("scanline", { dark: 35 }), fx("bloom", { amount: 40 })] },
  { id: "bonsai", name: "Bonsai", desc: "Horizontal-line dither in a warm vintage palette.",
    stack: [fx("pixel-dither", { pattern: 6, palette: 14, size: 0.35 })] },
  { id: "memento", name: "Memento", desc: "Commodore-64 palette dither, chunky retro pixels.",
    stack: [fx("pixel-dither", { pattern: 1, palette: 5, size: 0.8 })] },
  { id: "cumulus", name: "Cumulus", desc: "Bayer 8×8 dither in the PICO-8 palette.",
    stack: [fx("pixel-dither", { pattern: 2, palette: 6, size: 0.5 })] },
  { id: "daybreak", name: "Daybreak", desc: "Diffusion dither in CGA colours with bloom.",
    stack: [fx("pixel-dither", { pattern: 7, palette: 2, size: 0.4 }), fx("bloom", { amount: 55, threshold: 50 })] },
  { id: "blueprint", name: "Blueprint", desc: "Inverted edge-traced characters in technical blue.",
    stack: [fx("neon-edges", { mode: 0, ink: "#ffffff", paper: "#000000", glow: 0 }), fx("ascii", { color: 0, ink: "#e6f0ff", backdrop: 1, paper: "#1d3f8a", cols: 120 })] },
  { id: "retro-crt", name: "Retro CRT", desc: "Green phosphor characters with scanlines, curvature and vignette.",
    stack: [fx("ascii", { color: 0, ink: "#5cff8a", backdrop: 1, paper: "#020a04", cols: 90 }), fx("crt", { curve: 45, lines: 60 }), fx("vignette", { amount: 55 })] },
  { id: "newsprint", name: "Newsprint", desc: "Tiny high-contrast characters. Inky black & white print.",
    stack: [fx("ascii", { ramp: 1, color: 0, ink: "#141414", backdrop: 1, paper: "#f2ede2", invert: 1, cols: 170, contrast: 60 })] },
  { id: "pixel-pop", name: "Pixel Pop", desc: "Pixel art with a light post-pixelate. Bold and blocky.",
    stack: [fx("pixel-art", { size: 1.6, palette: 4, levels: 4 }), fx("posterize", { levels: 6, sat: 150 })] },
  { id: "mosaic", name: "Mosaic", desc: "Glossy mosaic tiles.",
    stack: [fx("photo-mosaic", { size: 2, gloss: 80, round: 30 })] },
  { id: "inferno", name: "Inferno", desc: "Dots with a fiery red cast, vignette and bloom.",
    stack: [fx("dots"), fx("gradient-map", { palette: 0, mix: 70 }), fx("vignette", { amount: 60 }), fx("bloom", { amount: 50, threshold: 45 })] },
  { id: "acid", name: "Acid", desc: "Acid-green characters with scanlines and a chromatic shift.",
    stack: [fx("ascii", { color: 0, ink: "#b6ff00", blend: 1, backdrop: 2, bdOpacity: 60 }), fx("scanline", { dark: 40 }), fx("rgb-split", { amount: 0.8 })] },
  { id: "golden-hour", name: "Golden Hour", desc: "Diamond grid with a soft gold tint over a greyscale base.",
    stack: [fx("diamond-glyphs"), fx("gradient-map", { palette: 6, c1: "#1a1206", c2: "#ffd27a", mix: 65 }), fx("bloom", { amount: 35 })] },
  { id: "botanica", name: "Botanica", desc: "Halftone dither with a gold soft-light wash.",
    stack: [fx("pixel-dither", { pattern: 5, palette: 4, levels: 3, size: 0.3 }), fx("gradient-map", { palette: 6, c1: "#2b1d0a", c2: "#f5d48a", mix: 40 })] },
  { id: "dream", name: "Dream", desc: "Soft pink characters with a gentle bloom. Hazy and warm.",
    stack: [fx("ascii", { color: 0, ink: "#ffc2dd", backdrop: 0, bdOpacity: 45, softness: 50 }), fx("bloom", { amount: 55, threshold: 45, tint: "#ffd6e8" })] },
  { id: "blue-hour", name: "Blue Hour", desc: "Cross-character grid, blue cast, heavy scanlines and bloom.",
    stack: [fx("cross-glyphs"), fx("gradient-map", { palette: 2, mix: 60 }), fx("scanline", { dark: 70 }), fx("bloom", { amount: 45 })] },
  { id: "lost-signal", name: "Lost Signal", desc: "Big amber characters, CRT curve, chromatic and radial blur.",
    stack: [fx("ascii", { color: 0, ink: "#ffb347", backdrop: 1, paper: "#140a00", cols: 50 }), fx("crt", { curve: 50 }), fx("chromatic", { amount: 60 }), fx("zoom-blur", { amount: 15, clear: 40 })] },
  { id: "sepia", name: "Sepia", desc: "Sepia diffusion dither, film grain, dust and a soft vignette.",
    stack: [fx("pixel-dither", { pattern: 7, palette: 7, size: 0.3 }), fx("grain", { amount: 30 }), fx("dust", { dust: 40, scratches: 25 }), fx("vignette", { amount: 45 })] },
];
