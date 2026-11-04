import * as fabric from "fabric";

/*
 * Selective colour + split toning, which is what Canva's "Color Pop" looks do:
 * they move the COOL hues (blues, cyans) to a new hue while warm tones like
 * skin stay put, and tint the highlights and shadows with their own colours.
 * A colour matrix cannot treat hues differently, so this is a filter of its own
 * (WebGL shader + identical 2D fallback), and `popPixel` drives both the 2D
 * path and the gallery thumbnails so previews match the canvas.
 */

export interface PopProps {
  /** Degrees added to cool hues (centred on 215°, fading out ±70°). */
  coolShift: number;
  /** -1..1 saturation change for cool hues. */
  coolSat: number;
  /** -1..1 lightness change for cool hues. */
  coolLight: number;
  /** Highlight tint colour (0–1 RGB) and strength 0..1. */
  hiR: number; hiG: number; hiB: number; hiAmt: number;
  /** Shadow tint colour (0–1 RGB) and strength 0..1. */
  shR: number; shG: number; shB: number; shAmt: number;
  /** 0..1 blend with the unfiltered pixel (the look's intensity). */
  mix: number;
}

export const POP_DEFAULTS: PopProps = {
  coolShift: 0, coolSat: 0, coolLight: 0,
  hiR: 1, hiG: 1, hiB: 1, hiAmt: 0,
  shR: 0, shG: 0, shB: 0, shAmt: 0,
  mix: 1,
};

const COOL_CENTRE = 215;
const COOL_HALF_WIDTH = 70;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hh = (((h % 360) + 360) % 360) / 360;
  return [hue2rgb(p, q, hh + 1 / 3), hue2rgb(p, q, hh), hue2rgb(p, q, hh - 1 / 3)];
}

/** One pixel (0–1 RGB) through the pop look. */
export function popPixel(r: number, g: number, b: number, p: PopProps): [number, number, number] {
  let [h, s, l] = rgbToHsl(r, g, b);
  // How "cool" this pixel is: near 215°, and only if it has some colour.
  const dist = Math.abs(((h - COOL_CENTRE + 540) % 360) - 180);
  const w = (1 - smooth(COOL_HALF_WIDTH * 0.4, COOL_HALF_WIDTH, dist)) * smooth(0.06, 0.25, s);
  if (w > 0) {
    h += p.coolShift * w;
    s = Math.min(1, Math.max(0, s * (1 + p.coolSat * w)));
    l = Math.min(1, Math.max(0, l + p.coolLight * w * 0.5));
  }
  let [nr, ng, nb] = hslToRgb(h, s, l);
  const lum = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
  const hw = smooth(0.55, 0.95, lum) * p.hiAmt;
  nr += (p.hiR - nr) * hw; ng += (p.hiG - ng) * hw; nb += (p.hiB - nb) * hw;
  const sw = (1 - smooth(0.05, 0.45, lum)) * p.shAmt;
  nr += (p.shR - nr) * sw; ng += (p.shG - ng) * sw; nb += (p.shB - nb) * sw;
  return [r + (nr - r) * p.mix, g + (ng - g) * p.mix, b + (nb - b) * p.mix];
}

const fragmentSource = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uCoolShift;
  uniform float uCoolSat;
  uniform float uCoolLight;
  uniform vec4 uHi;
  uniform vec4 uSh;
  uniform float uMix;
  varying vec2 vTexCoord;

  vec3 rgb2hsl(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float l = (mx + mn) * 0.5;
    if (mx == mn) return vec3(0.0, 0.0, l);
    float d = mx - mn;
    float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    float h;
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    return vec3(h * 60.0, s, l);
  }
  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 0.5) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    return p;
  }
  vec3 hsl2rgb(vec3 hsl) {
    if (hsl.y == 0.0) return vec3(hsl.z);
    float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
    float p = 2.0 * hsl.z - q;
    float h = mod(hsl.x, 360.0) / 360.0;
    return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
  }

  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec3 hsl = rgb2hsl(color.rgb);
    float dist = abs(mod(hsl.x - ${COOL_CENTRE.toFixed(1)} + 540.0, 360.0) - 180.0);
    float w = (1.0 - smoothstep(${(COOL_HALF_WIDTH * 0.4).toFixed(1)}, ${COOL_HALF_WIDTH.toFixed(1)}, dist)) * smoothstep(0.06, 0.25, hsl.y);
    hsl.x += uCoolShift * w;
    hsl.y = clamp(hsl.y * (1.0 + uCoolSat * w), 0.0, 1.0);
    hsl.z = clamp(hsl.z + uCoolLight * w * 0.5, 0.0, 1.0);
    vec3 c = hsl2rgb(hsl);
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, uHi.rgb, smoothstep(0.55, 0.95, lum) * uHi.a);
    c = mix(c, uSh.rgb, (1.0 - smoothstep(0.05, 0.45, lum)) * uSh.a);
    gl_FragColor = vec4(mix(color.rgb, c, uMix), color.a);
  }
`;

export class LumioPop extends fabric.filters.BaseFilter<"LumioPop", PopProps> {
  declare coolShift: number;
  declare coolSat: number;
  declare coolLight: number;
  declare hiR: number; declare hiG: number; declare hiB: number; declare hiAmt: number;
  declare shR: number; declare shG: number; declare shB: number; declare shAmt: number;
  declare mix: number;

  static type = "LumioPop";
  static defaults: Record<string, unknown> = { ...POP_DEFAULTS };
  static uniformLocations = ["uCoolShift", "uCoolSat", "uCoolLight", "uHi", "uSh", "uMix"];

  getFragmentSource() {
    return fragmentSource;
  }

  applyTo2d({ imageData: { data } }: fabric.T2DPipelineState) {
    const p = this as unknown as PopProps;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = popPixel(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, p);
      data[i] = Math.min(255, Math.max(0, r * 255));
      data[i + 1] = Math.min(255, Math.max(0, g * 255));
      data[i + 2] = Math.min(255, Math.max(0, b * 255));
    }
  }

  sendUniformData(gl: WebGLRenderingContext, u: fabric.TWebGLUniformLocationMap) {
    gl.uniform1f(u.uCoolShift, this.coolShift);
    gl.uniform1f(u.uCoolSat, this.coolSat);
    gl.uniform1f(u.uCoolLight, this.coolLight);
    gl.uniform4f(u.uHi, this.hiR, this.hiG, this.hiB, this.hiAmt);
    gl.uniform4f(u.uSh, this.shR, this.shG, this.shB, this.shAmt);
    gl.uniform1f(u.uMix, this.mix);
  }

  isNeutralState() {
    return this.mix === 0 || (this.coolShift === 0 && this.coolSat === 0 && this.coolLight === 0 && this.hiAmt === 0 && this.shAmt === 0);
  }
}

fabric.classRegistry.setClass(LumioPop);

/** Builds pop props from friendlier inputs (hex tints). */
export function pop(opts: {
  shift?: number; sat?: number; light?: number;
  hi?: [string, number]; sh?: [string, number];
}): PopProps {
  const rgb = (hex: string) => {
    const n = parseInt(hex.replace("#", ""), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const [hiR, hiG, hiB] = opts.hi ? rgb(opts.hi[0]) : [1, 1, 1];
  const [shR, shG, shB] = opts.sh ? rgb(opts.sh[0]) : [0, 0, 0];
  return {
    coolShift: opts.shift ?? 0,
    coolSat: opts.sat ?? 0,
    coolLight: opts.light ?? 0,
    hiR, hiG, hiB, hiAmt: opts.hi?.[1] ?? 0,
    shR, shG, shB, shAmt: opts.sh?.[1] ?? 0,
    mix: 1,
  };
}
