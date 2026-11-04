import * as fabric from "fabric";

/*
 * The non-linear part of Canva-style "Adjust": highlights, shadows, whites,
 * blacks, vibrance, invert, clarity and vignette. These depend on a pixel's
 * brightness (or position), so they cannot be a colour matrix. Implemented as
 * one Fabric filter with both a WebGL shader and a 2D fallback, and registered
 * so it saves and loads with the design.
 *
 * All amounts are -1..1 (invert is 0 or 1).
 */

export interface ToneProps {
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
  invert: number;
  clarity: number;
  vignette: number;
}

const defaults: ToneProps = {
  highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, invert: 0, clarity: 0, vignette: 0,
};

const fragmentSource = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uHighlights;
  uniform float uShadows;
  uniform float uWhites;
  uniform float uBlacks;
  uniform float uVibrance;
  uniform float uInvert;
  uniform float uClarity;
  uniform float uVignette;
  varying vec2 vTexCoord;

  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec3 c = color.rgb;
    if (uInvert > 0.5) c = 1.0 - c;

    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float d = uShadows * 0.35 * (1.0 - l) * (1.0 - l)
            + uHighlights * 0.35 * l * l
            + uWhites * 0.25 * smoothstep(0.5, 1.0, l)
            + uBlacks * 0.25 * (1.0 - smoothstep(0.0, 0.5, l));
    c += d;

    float m = 4.0 * l * (1.0 - l);
    c = 0.5 + (c - 0.5) * (1.0 + uClarity * 0.6 * m);

    float mx = max(c.r, max(c.g, c.b));
    float avg = (c.r + c.g + c.b) / 3.0;
    float amt = abs(mx - avg) * 2.0 * -uVibrance;
    c += (mx - c) * amt * step(c, vec3(mx - 0.0001));

    vec2 p = vTexCoord - 0.5;
    float k = smoothstep(0.25, 0.75, length(p) * 1.4142);
    if (uVignette > 0.0) c *= 1.0 - uVignette * 0.85 * k;
    else c += (1.0 - c) * -uVignette * 0.85 * k;

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), color.a);
  }
`;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class LumioTone extends fabric.filters.BaseFilter<"LumioTone", ToneProps> {
  declare highlights: number;
  declare shadows: number;
  declare whites: number;
  declare blacks: number;
  declare vibrance: number;
  declare invert: number;
  declare clarity: number;
  declare vignette: number;

  static type = "LumioTone";
  static defaults: Record<string, unknown> = { ...defaults };
  static uniformLocations = ["uHighlights", "uShadows", "uWhites", "uBlacks", "uVibrance", "uInvert", "uClarity", "uVignette"];

  getFragmentSource() {
    return fragmentSource;
  }

  applyTo2d({ imageData: { data, width, height } }: fabric.T2DPipelineState) {
    const { highlights, shadows, whites, blacks, vibrance, invert, clarity, vignette } = this;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      if (invert > 0.5) { r = 1 - r; g = 1 - g; b = 1 - b; }
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const d = shadows * 0.35 * (1 - l) ** 2 + highlights * 0.35 * l * l
        + whites * 0.25 * smooth(0.5, 1, l) + blacks * 0.25 * (1 - smooth(0, 0.5, l));
      r += d; g += d; b += d;
      const m = 4 * l * (1 - l);
      const k1 = 1 + clarity * 0.6 * m;
      r = 0.5 + (r - 0.5) * k1; g = 0.5 + (g - 0.5) * k1; b = 0.5 + (b - 0.5) * k1;
      if (vibrance) {
        const mx = Math.max(r, g, b);
        const amt = Math.abs(mx - (r + g + b) / 3) * 2 * -vibrance;
        if (r < mx) r += (mx - r) * amt;
        if (g < mx) g += (mx - g) * amt;
        if (b < mx) b += (mx - b) * amt;
      }
      if (vignette) {
        const px = (i / 4) % width, py = Math.floor(i / 4 / width);
        const dist = Math.hypot(px / width - 0.5, py / height - 0.5) * Math.SQRT2;
        const k = smooth(0.25, 0.75, dist);
        if (vignette > 0) { const f = 1 - vignette * 0.85 * k; r *= f; g *= f; b *= f; }
        else { const f = -vignette * 0.85 * k; r += (1 - r) * f; g += (1 - g) * f; b += (1 - b) * f; }
      }
      data[i] = Math.min(255, Math.max(0, r * 255));
      data[i + 1] = Math.min(255, Math.max(0, g * 255));
      data[i + 2] = Math.min(255, Math.max(0, b * 255));
    }
  }

  sendUniformData(gl: WebGLRenderingContext, u: fabric.TWebGLUniformLocationMap) {
    gl.uniform1f(u.uHighlights, this.highlights);
    gl.uniform1f(u.uShadows, this.shadows);
    gl.uniform1f(u.uWhites, this.whites);
    gl.uniform1f(u.uBlacks, this.blacks);
    gl.uniform1f(u.uVibrance, this.vibrance);
    gl.uniform1f(u.uInvert, this.invert);
    gl.uniform1f(u.uClarity, this.clarity);
    gl.uniform1f(u.uVignette, this.vignette);
  }

  isNeutralState() {
    return (Object.keys(defaults) as (keyof ToneProps)[]).every((k) => this[k] === 0);
  }
}

fabric.classRegistry.setClass(LumioTone);
