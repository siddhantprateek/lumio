import * as fabric from "fabric";
import { LumioTone } from "./tone-filter";
import { LumioPop, pop, popPixel, type PopProps } from "./pop-filter";
import { effectFilters, type EffectState } from "./effects";

/*
 * Image looks, Canva-style. Every look is a single 4×5 colour matrix
 * (RGBA rows, 5th column = offset in 0–1), because:
 *  - intensity is then just a blend between the identity and the look's
 *    matrix, which equals blending the original and filtered pixels;
 *  - looks and adjustments compose by matrix multiplication into ONE
 *    Fabric ColorMatrix filter, so the image is filtered in a single pass
 *    (and Fabric saves and restores it with the design).
 */

export type Matrix = number[]; // length 20

export const IDENTITY: Matrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/** a ∘ b: apply b first, then a. */
export function compose(a: Matrix, b: Matrix): Matrix {
  const out = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? a[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += a[r * 5 + k] * b[k * 5 + c];
      out[r * 5 + c] = v;
    }
  }
  return out;
}

const chain = (...ms: Matrix[]) => ms.reduceRight((acc, m) => compose(m, acc), IDENTITY);

export function lerp(a: Matrix, b: Matrix, t: number): Matrix {
  return a.map((v, i) => v + (b[i] - v) * t);
}

// ── Building blocks ────────────────────────────────────────────────────

const LR = 0.2126, LG = 0.7152, LB = 0.0722;

export function saturation(s: number): Matrix {
  const r = (1 - s) * LR, g = (1 - s) * LG, b = (1 - s) * LB;
  return [
    r + s, g, b, 0, 0,
    r, g + s, b, 0, 0,
    r, g, b + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}
export const brightness = (b: number): Matrix => [1, 0, 0, 0, b, 0, 1, 0, 0, b, 0, 0, 1, 0, b, 0, 0, 0, 1, 0];
export function contrast(c: number): Matrix {
  const o = 0.5 * (1 - c);
  return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0];
}
/** Per-channel gain and lift (offset), the basis of warm / cool / tinted looks. */
export const channels = (r: number, g: number, b: number, lr = 0, lg = 0, lb = 0): Matrix =>
  [r, 0, 0, 0, lr, 0, g, 0, 0, lg, 0, 0, b, 0, lb, 0, 0, 0, 1, 0];
/** Lifts the blacks and lowers the whites: a matte, washed-out look. */
export const fade = (f: number): Matrix => {
  const k = 1 - f;
  return [k, 0, 0, 0, f * 0.6, 0, k, 0, 0, f * 0.6, 0, 0, k, 0, f * 0.6, 0, 0, 0, 1, 0];
};
export function hue(deg: number): Matrix {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return [
    LR + cos * (1 - LR) - sin * LR, LG - cos * LG - sin * LG, LB - cos * LB + sin * (1 - LB), 0, 0,
    LR - cos * LR + sin * 0.143, LG + cos * (1 - LG) + sin * 0.14, LB - cos * LB - sin * 0.283, 0, 0,
    LR - cos * LR - sin * (1 - LR), LG - cos * LG + sin * LG, LB + cos * (1 - LB) + sin * LB, 0, 0,
    0, 0, 0, 1, 0,
  ];
}
export const SEPIA: Matrix = [
  0.393, 0.769, 0.189, 0, 0,
  0.349, 0.686, 0.168, 0, 0,
  0.272, 0.534, 0.131, 0, 0,
  0, 0, 0, 1, 0,
];

const hex = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Maps luminance onto a gradient from `dark` to `light`. */
export function duotone(dark: string, light: string): Matrix {
  const [dr, dg, db] = hex(dark);
  const [lr, lg, lb] = hex(light);
  const row = (d: number, l: number) => [(l - d) * LR, (l - d) * LG, (l - d) * LB, 0, d];
  return [...row(dr, lr), ...row(dg, lg), ...row(db, lb), 0, 0, 0, 1, 0];
}

// ── Presets ────────────────────────────────────────────────────────────

export interface Look {
  id: string;
  name: string;
  matrix: Matrix;
  /** Selective colour / split toning, applied after the matrix (Color Pop looks). */
  pop?: PopProps;
}
export interface LookCategory {
  name: string;
  looks: Look[];
}

/** "X-Pro +" → "x-pro-plus", so "+" and "-" variants never share an id. */
const slug = (name: string) =>
  name.toLowerCase().replace(/\+/g, " plus").replace(/\s-\s*$/, " minus").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const look = (name: string, ...ms: Matrix[]): Look => ({
  id: slug(name),
  name,
  matrix: chain(...ms),
});
const popLook = (name: string, p: PopProps, ...ms: Matrix[]): Look => ({ ...look(name, ...ms), pop: p });
const duo = (name: string, dark: string, light: string): Look => ({
  id: `duo-${slug(name)}`,
  name,
  matrix: duotone(dark, light),
});

export const CUSTOM_DUOTONE_ID = "duo-custom";

export const LOOK_CATEGORIES: LookCategory[] = [
  { name: "Natural", looks: [
    look("Fresco", contrast(1.08), saturation(1.1), brightness(0.02)),
    look("Belvedere", contrast(1.12), saturation(1.05), channels(1.02, 1, 0.98)),
    look("Flint", contrast(1.05), saturation(0.85), brightness(0.03)),
    look("Luna", contrast(1.15), saturation(1.2), channels(0.97, 1, 1.05)),
    look("Aero", saturation(0.9), channels(0.95, 1.02, 1.06), brightness(0.04)),
    look("Myst", fade(0.12), saturation(0.85), channels(0.98, 1, 1.03)),
  ]},
  { name: "Warm", looks: [
    look("Bali", channels(1.08, 1.02, 0.92), saturation(1.05), fade(0.05)),
    look("Capri", channels(1.1, 1, 0.9), contrast(1.1), saturation(1.15)),
    look("Latte", channels(1.06, 1.01, 0.9), fade(0.15), saturation(0.8)),
    look("Bronz", channels(1.12, 1, 0.82), contrast(1.05), saturation(0.95)),
    look("Sandi", channels(1.06, 1.03, 0.92, 0.02, 0.01, 0), fade(0.08), saturation(0.9)),
    look("Sangri", channels(1.12, 0.96, 0.94), saturation(1.15), contrast(1.08)),
  ]},
  { name: "Cool", looks: [
    look("Scandi", channels(0.95, 1, 1.05), saturation(0.75), brightness(0.03)),
    look("Nordic", channels(0.92, 0.99, 1.08), fade(0.08), saturation(0.85)),
    look("Astro", channels(0.9, 0.98, 1.12), contrast(1.1)),
    look("Arctic", channels(0.92, 1.02, 1.1), brightness(0.05), saturation(0.9)),
    look("Polar", channels(0.94, 1, 1.08), contrast(1.05), saturation(1.05)),
    look("Tundra", channels(0.9, 1.02, 1.04), saturation(0.7), fade(0.06)),
  ]},
  { name: "Vivid", looks: [
    look("Punch", saturation(1.45), contrast(1.15)),
    look("Zest", saturation(1.35), channels(1.04, 1.04, 0.96), contrast(1.08)),
    look("Glow", saturation(1.25), brightness(0.06), contrast(1.05)),
    look("Neon", saturation(1.6), contrast(1.2), hue(-8)),
    look("Bloom", saturation(1.3), channels(1.05, 1, 1.05), brightness(0.04)),
    look("Juice", saturation(1.5), channels(1.06, 1, 0.94)),
  ]},
  { name: "Soft", looks: [
    look("Aura", fade(0.12), saturation(0.9), channels(1.02, 1, 1.04)),
    look("Hazel", fade(0.18), saturation(0.75), channels(1.03, 1.01, 0.96)),
    look("Whimsi", fade(0.1), saturation(1.05), channels(1.02, 0.99, 1.05)),
    look("Rose", fade(0.1), channels(1.06, 0.98, 1.0), saturation(0.95)),
    look("Oceanic", fade(0.1), channels(0.95, 1.01, 1.06), saturation(0.9)),
    look("Nimbus", fade(0.2), saturation(0.8), brightness(0.03)),
  ]},
  { name: "Vintage", looks: [
    look("Vinto", lerp(IDENTITY, SEPIA, 0.35), fade(0.1), contrast(1.05)),
    look("Fade", fade(0.22), saturation(0.85)),
    look("Antiq", lerp(IDENTITY, SEPIA, 0.6), fade(0.12)),
    look("Nostalg", channels(1.06, 1.0, 0.88), fade(0.15), saturation(0.85)),
    look("Dream", fade(0.14), channels(1.02, 1.02, 1.08), saturation(0.9), brightness(0.03)),
    look("Retro", channels(1.05, 0.98, 0.85), contrast(1.1), saturation(1.1), fade(0.08)),
  ]},
  { name: "Mono", looks: [
    look("Classic", saturation(0)),
    look("Ink", saturation(0), contrast(1.35)),
    look("Noir", saturation(0), contrast(1.5), brightness(-0.06)),
    look("Film", saturation(0), fade(0.12), contrast(1.05)),
    look("Newspaper", saturation(0), contrast(1.2), fade(0.08), channels(1, 0.99, 0.95)),
    look("Slate", saturation(0), channels(0.96, 0.99, 1.04), fade(0.06)),
  ]},
  // Matched against Canva's Color Pop tiles: cool hues move, warm tones stay,
  // highlights and shadows take a tint.
  { name: "Color Pop", looks: [
    popLook("Outrun", pop({ shift: 52, sat: 0.9, light: -0.1, hi: ["#ffb347", 0.7], sh: ["#2a0057", 0.35] }), contrast(1.1)),
    popLook("Heatwave", pop({ shift: -22, sat: 0.7, light: 0.22, hi: ["#f2823a", 0.8] }), contrast(1.05)),
    popLook("Amethyst", pop({ shift: 40, sat: 0.35, light: 0.25, hi: ["#ece6ff", 0.55] })),
    popLook("Minty", pop({ shift: 32, sat: -0.65, light: 0.18, hi: ["#a8ebc0", 0.75] })),
    popLook("Hibiscus", pop({ shift: -38, sat: 0.35, light: 0.02, hi: ["#effff8", 0.4] }), contrast(1.1)),
    popLook("Poster", pop({ shift: -6, sat: 0.9, light: -0.08, hi: ["#f2f7ff", 0.25] }), contrast(1.3), saturation(1.25)),
    popLook("X-Pro -", pop({ shift: -28, sat: 0.3, light: 0.06, sh: ["#0c3b2c", 0.45] }), contrast(1.15)),
    popLook("X-Pro +", pop({ shift: -4, sat: 0.4, light: -0.2, hi: ["#f6f0a0", 0.7] }), contrast(1.2)),
  ]},
  { name: "Duotone", looks: [
    { id: CUSTOM_DUOTONE_ID, name: "Custom", matrix: duotone("#1e1b4b", "#f9a8d4") },
    duo("Cherry", "#3b0a1a", "#f87171"),
    duo("Fuchsia", "#3b0a3a", "#f0abfc"),
    duo("Pop", "#4c0f7a", "#f472b6"),
    duo("Violet", "#2e1065", "#c4b5fd"),
    duo("Sea Blue", "#0c1f4a", "#7dd3fc"),
    duo("Sea Green", "#052e2b", "#6ee7b7"),
    duo("Mustard", "#3a2a05", "#fcd34d"),
    duo("Amber", "#4a1d04", "#fdba74"),
    duo("Pomelo", "#5a1a0a", "#fde68a"),
    duo("Blush", "#5b1030", "#fbcfe8"),
    duo("Peppermint", "#1e293b", "#99f6e4"),
    duo("Mystic", "#3b0764", "#e9d5ff"),
    duo("Pastel", "#6b7280", "#fbcfe8"),
    duo("Coral", "#4c1d1d", "#fda4af"),
    duo("Lavender", "#312e81", "#ddd6fe"),
    duo("Dusk", "#1e1b4b", "#fda4af"),
    duo("Dawn", "#7c2d12", "#fef3c7"),
    duo("Myrtle", "#14532d", "#bbf7d0"),
    duo("Mint Choc", "#3f2a1d", "#a7f3d0"),
    duo("Sepia", "#3b2a1a", "#f5e6c8"),
    duo("Mono", "#111827", "#e5e7eb"),
  ]},
];

const ALL_LOOKS = new Map(LOOK_CATEGORIES.flatMap((c) => c.looks).map((l) => [l.id, l]));
export const findLook = (id: string | undefined) => (id ? ALL_LOOKS.get(id) : undefined);

// ── State saved on the image ───────────────────────────────────────────

export interface LookState {
  id: string;
  /** 0–100 */
  intensity: number;
  /** Custom duotone colours. */
  dark?: string;
  light?: string;
}

/** Canva's Adjust sliders. Everything is -100..100 except invert. */
export interface Adjustments {
  temperature: number;
  tint: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  invert: boolean;
  vibrance: number;
  saturation: number;
  sharpness: number;
  clarity: number;
  vignette: number;
  blur: number; // 0..100
}

export const NO_ADJUSTMENTS: Adjustments = {
  temperature: 0, tint: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  invert: false, vibrance: 0, saturation: 0, sharpness: 0, clarity: 0, vignette: 0, blur: 0,
};

export interface ShadowStyle {
  kind: "none" | "glow" | "drop";
}

type Edited = fabric.FabricImage & { lumioLook?: LookState; lumioAdjust?: Adjustments; lumioEffects?: EffectState[] };

export const lookOf = (img: fabric.FabricImage) => (img as Edited).lumioLook;
export const adjustOf = (img: fabric.FabricImage) => ({ ...NO_ADJUSTMENTS, ...(img as Edited).lumioAdjust });
export const effectsOf = (img: fabric.FabricImage): EffectState[] => (img as Edited).lumioEffects ?? [];

/** The pop part of the active look at its intensity, if the look has one. */
export function lookPop(state: LookState | undefined): PopProps | undefined {
  const p = state ? findLook(state.id)?.pop : undefined;
  return p ? { ...p, mix: Math.max(0, Math.min(100, state!.intensity)) / 100 } : undefined;
}

export function lookMatrix(state: LookState | undefined): Matrix {
  if (!state) return IDENTITY;
  const base = state.id === CUSTOM_DUOTONE_ID
    ? duotone(state.dark ?? "#1e1b4b", state.light ?? "#f9a8d4")
    : findLook(state.id)?.matrix;
  return base ? lerp(IDENTITY, base, Math.max(0, Math.min(100, state.intensity)) / 100) : IDENTITY;
}

/** The linear adjustments, as one matrix: white balance, saturation, contrast, brightness. */
export function adjustMatrix(a: Adjustments): Matrix {
  return chain(
    a.temperature || a.tint
      ? channels(1 + a.temperature / 350, 1 - a.tint / 400, 1 - a.temperature / 350, a.temperature / 2000, -a.tint / 2500, -a.temperature / 2000)
      : IDENTITY,
    a.saturation ? saturation(1 + a.saturation / 100) : IDENTITY,
    a.contrast ? contrast(1 + a.contrast / 100) : IDENTITY,
    a.brightness ? brightness(a.brightness / 250) : IDENTITY,
  );
}

const isIdentity = (m: Matrix) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-6);

/**
 * Fabric filters for a look plus adjustments, in Canva's order: the look,
 * then white balance / light / colour, then tone curves and vignette, then
 * texture (sharpen or soften).
 */
export function buildFilters(state: LookState | undefined, adjust: Adjustments, effects: EffectState[] = []): fabric.filters.BaseFilter<string>[] {
  const a = { ...NO_ADJUSTMENTS, ...adjust };
  const filters: fabric.filters.BaseFilter<string>[] = [];
  const popProps = lookPop(state);
  if (popProps) {
    // Look matrix → selective colour → adjustments, as separate passes.
    const lm = lookMatrix(state);
    if (!isIdentity(lm)) filters.push(new fabric.filters.ColorMatrix({ matrix: lm, colorsOnly: true }));
    filters.push(new LumioPop(popProps));
    const am = adjustMatrix(a);
    if (!isIdentity(am)) filters.push(new fabric.filters.ColorMatrix({ matrix: am, colorsOnly: true }));
  } else {
    const matrix = compose(adjustMatrix(a), lookMatrix(state));
    if (!isIdentity(matrix)) filters.push(new fabric.filters.ColorMatrix({ matrix, colorsOnly: true }));
  }
  const tone = new LumioTone({
    highlights: a.highlights / 100,
    shadows: a.shadows / 100,
    whites: a.whites / 100,
    blacks: a.blacks / 100,
    vibrance: a.vibrance / 100,
    invert: a.invert ? 1 : 0,
    clarity: a.clarity / 100,
    vignette: a.vignette / 100,
  });
  if (!tone.isNeutralState()) filters.push(tone);
  if (a.sharpness > 0) {
    const k = a.sharpness / 100;
    filters.push(new fabric.filters.Convolute({ matrix: [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0] }));
  }
  const soften = Math.max(a.blur, a.sharpness < 0 ? -a.sharpness / 2 : 0);
  if (soften > 0) filters.push(new fabric.filters.Blur({ blur: soften / 200 }));
  // Effects last, in the order they were added (grain on top of the grade, etc.).
  filters.push(...effectFilters(effects));
  return filters;
}

/**
 * Auto-adjust: reads the picture's levels and colour cast from a small copy
 * and returns settings that stretch the tones, centre the exposure and
 * neutralise the cast, with a little extra vibrance.
 */
export function autoAdjust(img: fabric.FabricImage): Adjustments {
  const src = thumbnailSource(img, 96);
  if (!src) return NO_ADJUSTMENTS;
  const lum: number[] = [];
  let sr = 0, sg = 0, sb = 0, n = 0;
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue; // ignore transparent pixels (cut-outs)
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    sr += r; sg += g; sb += b; n++;
  }
  if (!n) return NO_ADJUSTMENTS;
  lum.sort((x, y) => x - y);
  const p = (q: number) => lum[Math.min(lum.length - 1, Math.floor(q * lum.length))];
  const lo = p(0.02), hi = p(0.98), mid = p(0.5);
  const clamp = (v: number, a = -100, b = 100) => Math.round(Math.max(a, Math.min(b, v)));
  const spread = Math.max(0.05, hi - lo);
  const avgR = sr / n, avgG = sg / n, avgB = sb / n;
  return {
    ...NO_ADJUSTMENTS,
    contrast: clamp((1 / spread - 1) * 40, -20, 40),
    brightness: clamp((0.5 - mid) * 120, -40, 40),
    blacks: clamp(-lo * 120, -40, 0),
    whites: clamp((1 - hi) * 120, 0, 40),
    temperature: clamp((avgB - avgR) * 150, -35, 35),
    tint: clamp((avgG - (avgR + avgB) / 2) * 150, -30, 30),
    vibrance: 15,
  };
}

/** Applies a look / adjustments to an image (and its linked cut-out, if any). */
export function applyEdits(
  img: fabric.FabricImage,
  state: LookState | undefined,
  adjust: Adjustments,
  also?: fabric.FabricImage,
  effects: EffectState[] = effectsOf(img),
) {
  const edited = img as Edited;
  edited.lumioLook = state;
  edited.lumioAdjust = adjust;
  edited.lumioEffects = effects;
  for (const target of also ? [img, also] : [img]) {
    target.filters = buildFilters(state, adjust, effects);
    target.applyFilters();
  }
}

// ── Thumbnails ─────────────────────────────────────────────────────────

/** Small copy of the image's unfiltered pixels, for drawing filter previews. */
export function thumbnailSource(img: fabric.FabricImage, size = 88): ImageData | null {
  const el = ((img as any)._originalElement ?? img.getElement()) as CanvasImageSource & { width: number; height: number };
  const w = (el as HTMLImageElement).naturalWidth || el.width;
  const h = (el as HTMLImageElement).naturalHeight || el.height;
  if (!w || !h) return null;
  const scale = size / Math.min(w, h);
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // Centre-crop to a square, like Canva's tiles.
  ctx.drawImage(el, (size - cw) / 2, (size - ch) / 2, cw, ch);
  try {
    return ctx.getImageData(0, 0, size, size);
  } catch {
    return null; // tainted (cross-origin) image
  }
}

/** Renders `source` through a matrix (and optional pop step) to a data URL. */
export function renderThumbnail(source: ImageData, m: Matrix, p?: PopProps): string {
  const out = new ImageData(source.width, source.height);
  const s = source.data, d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const r = s[i], g = s[i + 1], b = s[i + 2];
    let nr = r * m[0] + g * m[1] + b * m[2] + m[4] * 255;
    let ng = r * m[5] + g * m[6] + b * m[7] + m[9] * 255;
    let nb = r * m[10] + g * m[11] + b * m[12] + m[14] * 255;
    if (p) {
      const c = (v: number) => Math.min(1, Math.max(0, v / 255));
      const [pr, pg, pb] = popPixel(c(nr), c(ng), c(nb), p);
      nr = pr * 255; ng = pg * 255; nb = pb * 255;
    }
    d[i] = nr;
    d[i + 1] = ng;
    d[i + 2] = nb;
    d[i + 3] = s[i + 3];
  }
  const c = document.createElement("canvas");
  c.width = source.width;
  c.height = source.height;
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c.toDataURL("image/jpeg", 0.8);
}
