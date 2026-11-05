/*
 * Headless render bridge: every lumio image tool, callable from a script that
 * drives a headless browser (no editor UI, no API server). Served by vite at
 * /render.html.
 *
 *   window.lumioBridge.process(src | null, ops[]) -> PNG data URL
 *   window.lumioBridge.treat(src, { look?, effects? }, size?)   (shortcut: resize + effects)
 *   window.lumioBridge.cutout(src)                              (shortcut: background removal)
 *   window.lumioBridge.list()                                   -> catalogue of every op, look, filter, effect, shape, doodle
 *
 * `ops` run in order on one bitmap. Pixel values are numbers; "50%" strings are
 * a share of the current width/height. See OPS below for every op and its fields.
 */
import * as fabric from "fabric";
import { h, render } from "preact";
import { EFFECTS, findEffect, effectFilters, type EffectState } from "../client/lib/effects";
import { RECIPES } from "../client/lib/magic-effects";
import {
  LOOK_CATEGORIES, CUSTOM_DUOTONE_ID, NO_ADJUSTMENTS, buildFilters, autoAdjust, findLook, type Adjustments,
} from "../client/lib/image-filters";
import { SHAPES, findShape } from "../client/lib/shapes";
import { polygonPoints } from "../client/lib/polygon";
import { DOODLES } from "../client/lib/doodles";
import { GRADIENT_PRESETS, type GradientSpec } from "../client/lib/gradient";

type Op = { op: string } & Record<string, any>;
type Fit = "cover" | "contain" | "stretch";
interface TreatSpec { look?: string; effects?: (string | EffectState)[] }

// ── Bitmap helpers ─────────────────────────────────────────────────────

function blank(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;

async function load(src: string): Promise<HTMLCanvasElement> {
  const img = await fabric.util.loadImage(src, { crossOrigin: "anonymous" });
  const c = blank(img.naturalWidth, img.naturalHeight);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}

/** 120, "50%" → pixels of `total`. */
function px(v: unknown, total: number, fallback = 0): number {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "string" && v.trim().endsWith("%")) return (parseFloat(v) / 100) * total;
  return Number(v);
}

function ratioOf(r: unknown): number {
  if (typeof r === "number") return r;
  const m = String(r).match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`bad ratio "${r}" (use "4:5", "1:1", 0.8)`);
  return Number(m[1]) / Number(m[2]);
}

const FOCUS: Record<string, [number, number]> = {
  center: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5],
  "top-left": [0, 0], "top-right": [1, 0], "bottom-left": [0, 1], "bottom-right": [1, 1],
};
function focusOf(f: unknown): [number, number] {
  if (!f) return FOCUS.center;
  if (typeof f === "string") {
    if (!FOCUS[f]) throw new Error(`bad focus "${f}" (${Object.keys(FOCUS).join(", ")} or {x, y} 0..1)`);
    return FOCUS[f];
  }
  const o = f as { x?: number; y?: number };
  return [o.x ?? 0.5, o.y ?? 0.5];
}

/** Background paint: "#hex", "transparent", a gradient {from, to, angle}, or a preset index. */
function paint(ctx: CanvasRenderingContext2D, w: number, h: number, bg: unknown) {
  if (bg === undefined || bg === null || bg === "transparent") return;
  if (typeof bg === "number") bg = GRADIENT_PRESETS[bg];
  if (typeof bg === "string") { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); return; }
  const g = bg as GradientSpec;
  const rad = ((g.angle ?? 180) * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const grad = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  const withA = (hex: string, a = 1) => { ctx.fillStyle = hex; const c = ctx.fillStyle as string; return a >= 1 ? c : hexA(c, a); };
  grad.addColorStop(0, withA(g.from, g.fromOpacity));
  grad.addColorStop(1, withA(g.to, g.toOpacity));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}
function hexA(c: string, a: number) {
  const n = parseInt(c.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function fitInto(src: HTMLCanvasElement, w: number, h: number, fit: Fit = "cover", focus?: unknown, bg?: unknown) {
  const out = blank(w, h);
  const ctx = ctx2d(out);
  paint(ctx, w, h, bg);
  if (fit === "stretch") { ctx.drawImage(src, 0, 0, w, h); return out; }
  const s = fit === "cover" ? Math.max(w / src.width, h / src.height) : Math.min(w / src.width, h / src.height);
  const dw = src.width * s, dh = src.height * s;
  const [fx, fy] = focusOf(focus);
  ctx.drawImage(src, (w - dw) * fx, (h - dh) * fy, dw, dh);
  return out;
}

/** Runs Fabric filters over a bitmap through the same WebGL pipeline as the editor. */
function runFilters(src: HTMLCanvasElement, filters: fabric.filters.BaseFilter<string>[]): HTMLCanvasElement {
  if (!filters.length) return src;
  const img = new fabric.FabricImage(src);
  img.filters = filters;
  img.applyFilters();
  const el = img.getElement() as HTMLCanvasElement;
  const out = blank(el.width, el.height);
  ctx2d(out).drawImage(el, 0, 0);
  (fabric.getFilterBackend() as { evictCachesForKey?: (k: string) => void }).evictCachesForKey?.(img.cacheKey);
  return out;
}

function alphaBox(c: HTMLCanvasElement, threshold = 8) {
  const { data } = ctx2d(c).getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The silhouette of `c` filled with one colour. */
function silhouette(c: HTMLCanvasElement, color: string) {
  const s = blank(c.width, c.height);
  const ctx = ctx2d(s);
  ctx.drawImage(c, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, s.width, s.height);
  return s;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
const blobToURL = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(b);
});

/** Re-frames an SVG's viewBox to what it actually draws (lumio's doodles overflow their own box). */
function fitViewBox(svg: string, pad = 4): string {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden";
  host.innerHTML = svg;
  document.body.appendChild(host);
  try {
    const root = host.querySelector("svg") as SVGSVGElement | null;
    if (!root) return svg;
    const b = root.getBBox();
    if (!b.width || !b.height) return svg;
    const vb = [b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2];
    root.setAttribute("viewBox", vb.join(" "));
    root.setAttribute("width", String(vb[2]));
    root.setAttribute("height", String(vb[3]));
    return root.outerHTML;
  } finally { host.remove(); }
}

async function svgToCanvas(svg: string, w?: number, h?: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await fabric.util.loadImage(url);
    const iw = img.naturalWidth || 100, ih = img.naturalHeight || 100;
    const W = w ?? (h ? (iw * h) / ih : iw), H = h ?? (w ? (ih * w) / iw : ih);
    const c = blank(W, H);
    ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

// ── Shapes for masks ───────────────────────────────────────────────────

function maskPath(o: Op, w: number, h: number): Path2D {
  const shape = String(o.shape ?? "circle");
  const p = new Path2D();
  if (shape === "circle" || shape === "ellipse") { p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return p; }
  if (shape === "rounded") { p.roundRect(0, 0, w, h, px(o.radius ?? "8%", Math.min(w, h))); return p; }
  if (shape === "arch") {
    const r = w / 2;
    p.moveTo(0, h); p.lineTo(0, r); p.arc(r, r, r, Math.PI, 0); p.lineTo(w, h); p.closePath(); return p;
  }
  if (shape === "polygon" || shape === "star") {
    const pts = polygonPoints({ sides: o.sides ?? (shape === "star" ? 5 : 6), star: shape === "star" ? (o.inner ?? 45) : 0, round: o.round ?? 0 }, 50);
    const m = new DOMMatrix().scale(w / 100, h / 100).translate(50, 50);
    const raw = new Path2D(); pts.forEach((q, i) => (i ? raw.lineTo(q.x, q.y) : raw.moveTo(q.x, q.y))); raw.closePath();
    p.addPath(raw, m); return p;
  }
  const def = shape === "path" ? { d: String(o.d) } : findShape(shape);
  if (!def) throw new Error(`unknown mask shape "${shape}" (circle, ellipse, rounded, arch, polygon, star, path, ${SHAPES.map((s) => s.id).join(", ")})`);
  p.addPath(new Path2D(def.d), new DOMMatrix().scale(w / 100, h / 100));
  return p;
}

// ── Ops ────────────────────────────────────────────────────────────────

function resolveStack(spec: TreatSpec): EffectState[] {
  const stack: EffectState[] = [];
  if (spec.look) {
    const recipe = RECIPES.find((r) => r.id === spec.look);
    if (!recipe) throw new Error(`unknown look "${spec.look}". Known: ${RECIPES.map((r) => r.id).join(", ")}`);
    stack.push(...recipe.stack.map((e) => ({ id: e.id, values: { ...e.values } })));
  }
  for (const e of spec.effects ?? []) {
    const state = typeof e === "string" ? { id: e, values: {} } : { id: e.id, values: e.values ?? {}, enabled: e.enabled };
    if (!findEffect(state.id)) throw new Error(`unknown effect "${state.id}"`);
    stack.push(state);
  }
  return stack;
}

const ADJUST_KEYS = Object.keys(NO_ADJUSTMENTS);

type OpFn = (cur: HTMLCanvasElement | null, o: Op) => HTMLCanvasElement | Promise<HTMLCanvasElement>;
const need = (cur: HTMLCanvasElement | null, op: string) => {
  if (!cur) throw new Error(`"${op}" needs an image: pass a source, or start with "canvas" / "graphic"`);
  return cur;
};

const OPS: Record<string, { desc: string; fields: string; run: OpFn }> = {
  canvas: {
    desc: "Start a blank bitmap (when no source is given) or replace the current one.",
    fields: "width, height, background (#hex | transparent | {from, to, angle} | preset index)",
    run: (_c, o) => { const c = blank(o.width ?? 1080, o.height ?? 1350); paint(ctx2d(c), c.width, c.height, o.background); return c; },
  },
  load: {
    desc: "Replace the current bitmap with an image.",
    fields: "src",
    run: (_c, o) => load(o.src),
  },
  crop: {
    desc: "Crop a box (x, y, width, height) or the largest box of a ratio around a focus point.",
    fields: "x, y, width, height (px or %) | ratio ('4:5'), focus (center|top|bottom|left|right|top-left|… or {x, y} 0..1), zoom (>=1)",
    run: (c, o) => {
      c = need(c, "crop");
      let x: number, y: number, w: number, hh: number;
      if (o.ratio !== undefined) {
        const r = ratioOf(o.ratio);
        w = Math.min(c.width, c.height * r); hh = w / r;
        const z = Math.max(1, o.zoom ?? 1); w /= z; hh /= z;
        const [fx, fy] = focusOf(o.focus);
        x = Math.min(c.width - w, Math.max(0, fx * c.width - w / 2));
        y = Math.min(c.height - hh, Math.max(0, fy * c.height - hh / 2));
      } else {
        x = px(o.x, c.width); y = px(o.y, c.height);
        w = px(o.width, c.width, c.width - x); hh = px(o.height, c.height, c.height - y);
      }
      const out = blank(w, hh);
      ctx2d(out).drawImage(c, x, y, w, hh, 0, 0, out.width, out.height);
      return out;
    },
  },
  resize: {
    desc: "Resize to a box. Cover crops, contain letterboxes, stretch distorts.",
    fields: "width, height (one may be omitted), fit (cover|contain|stretch), focus, background, scale (instead of width/height)",
    run: (c, o) => {
      c = need(c, "resize");
      if (o.scale) return fitInto(c, c.width * o.scale, c.height * o.scale, "stretch");
      const w = o.width ?? (o.height ? (c.width * o.height) / c.height : c.width);
      const hh = o.height ?? (o.width ? (c.height * o.width) / c.width : c.height);
      return fitInto(c, w, hh, o.fit ?? "cover", o.focus, o.background);
    },
  },
  rotate: {
    desc: "Rotate by any angle; the bitmap grows to fit.",
    fields: "deg, background",
    run: (c, o) => {
      c = need(c, "rotate");
      const a = ((o.deg ?? 90) * Math.PI) / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
      const out = blank(c.width * cos + c.height * sin, c.width * sin + c.height * cos);
      const ctx = ctx2d(out); paint(ctx, out.width, out.height, o.background);
      ctx.translate(out.width / 2, out.height / 2); ctx.rotate(a); ctx.drawImage(c, -c.width / 2, -c.height / 2);
      return out;
    },
  },
  flip: {
    desc: "Mirror horizontally and/or vertically.",
    fields: "x (bool, default true), y (bool)",
    run: (c, o) => {
      c = need(c, "flip");
      const out = blank(c.width, c.height), ctx = ctx2d(out);
      const fx = o.x !== false, fy = !!o.y;
      ctx.translate(fx ? c.width : 0, fy ? c.height : 0); ctx.scale(fx ? -1 : 1, fy ? -1 : 1); ctx.drawImage(c, 0, 0);
      return out;
    },
  },
  adjust: {
    desc: "Canva-style Adjust sliders (-100..100, blur 0..100). auto: true reads the levels first, explicit values override.",
    fields: `auto, ${ADJUST_KEYS.join(", ")}`,
    run: (c, o) => {
      c = need(c, "adjust");
      const base = o.auto ? autoAdjust(new fabric.FabricImage(c)) : NO_ADJUSTMENTS;
      const a: Adjustments = { ...base };
      for (const k of Object.keys(o)) {
        if (k === "op" || k === "auto") continue;
        if (!ADJUST_KEYS.includes(k)) throw new Error(`adjust has no "${k}" (${ADJUST_KEYS.join(", ")})`);
        (a as unknown as Record<string, unknown>)[k] = o[k];
      }
      return runFilters(c, buildFilters(undefined, a));
    },
  },
  filter: {
    desc: "Canva-style photo filter (Natural, Warm, Cool, Vivid, Soft, Vintage, Mono, Color Pop, Duotone).",
    fields: "id, intensity (0..100, default 100), dark + light (for id duo-custom)",
    run: (c, o) => {
      c = need(c, "filter");
      if (o.id !== CUSTOM_DUOTONE_ID && !findLook(o.id)) throw new Error(`unknown filter "${o.id}"`);
      return runFilters(c, buildFilters({ id: o.id, intensity: o.intensity ?? 100, dark: o.dark, light: o.light }, NO_ADJUSTMENTS));
    },
  },
  effects: {
    desc: "GPU effects (grain, halation, halftone, ASCII, glitch…) and/or a recipe look.",
    fields: "look (recipe id), effects ([{id, values}] or ids)",
    run: (c, o) => runFilters(need(c, "effects"), effectFilters(resolveStack(o))),
  },
  cutout: {
    desc: "Remove the background (in-browser ISNet model; the first call downloads it, ~88 MB fp16).",
    fields: "model (isnet_fp16 default | isnet | isnet_quint8)",
    run: async (c, o) => {
      c = need(c, "cutout");
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await toBlob(c);
      const run = () => removeBackground(blob, { model: o.model ?? "isnet_fp16", output: { format: "image/png" } });
      const res = await run().catch((e) => { if (e instanceof TypeError) return run(); throw e; });
      return load(await blobToURL(res));
    },
  },
  trim: {
    desc: "Crop away transparent edges (after cutout), keeping padding.",
    fields: "pad (px or %), threshold (0..255 alpha)",
    run: (c, o) => {
      c = need(c, "trim");
      const b = alphaBox(c, o.threshold ?? 8);
      if (!b) return c;
      const pad = px(o.pad ?? 0, Math.max(b.w, b.h));
      const out = blank(b.w + pad * 2, b.h + pad * 2);
      ctx2d(out).drawImage(c, b.x, b.y, b.w, b.h, pad, pad, b.w, b.h);
      return out;
    },
  },
  outline: {
    desc: "Sticker outline around the opaque shape (use after cutout).",
    fields: "width (px, default 12), color (#fff)",
    run: (c, o) => {
      c = need(c, "outline");
      const wd = Math.max(1, o.width ?? 12), sil = silhouette(c, o.color ?? "#ffffff");
      const out = blank(c.width + wd * 2, c.height + wd * 2), ctx = ctx2d(out);
      const steps = Math.max(16, Math.round(wd * 2));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        ctx.drawImage(sil, wd + Math.cos(a) * wd, wd + Math.sin(a) * wd);
      }
      ctx.drawImage(sil, wd, wd);
      ctx.drawImage(c, wd, wd);
      return out;
    },
  },
  shadow: {
    desc: "Drop shadow or glow behind the opaque shape; the bitmap grows to fit.",
    fields: "blur (px, 30), x, y (offset px; 0, 20), color (#000), opacity (0..1, 0.5)",
    run: (c, o) => {
      c = need(c, "shadow");
      const blur = o.blur ?? 30, dx = o.x ?? 0, dy = o.y ?? 20;
      const pad = Math.ceil(blur * 2 + Math.max(Math.abs(dx), Math.abs(dy)));
      const out = blank(c.width + pad * 2, c.height + pad * 2), ctx = ctx2d(out);
      ctx.fillStyle = o.color ?? "#000000";
      ctx.shadowColor = hexA(ctx.fillStyle as string, o.opacity ?? 0.5);
      ctx.shadowBlur = blur; ctx.shadowOffsetX = dx; ctx.shadowOffsetY = dy;
      ctx.drawImage(c, pad, pad);
      return out;
    },
  },
  mask: {
    desc: "Clip to a shape.",
    fields: `shape (circle, ellipse, rounded + radius, arch, polygon + sides/round, star + sides/inner, path + d in a 100x100 box, ${SHAPES.map((s) => s.id).join(", ")})`,
    run: (c, o) => {
      c = need(c, "mask");
      const out = blank(c.width, c.height), ctx = ctx2d(out);
      ctx.clip(maskPath(o, c.width, c.height));
      ctx.drawImage(c, 0, 0);
      return out;
    },
  },
  fade: {
    desc: "Fade one edge to transparent (blend a photo into a background).",
    fields: "edge (bottom|top|left|right), size (0..1 share of the side, 0.4)",
    run: (c, o) => {
      c = need(c, "fade");
      const out = blank(c.width, c.height), ctx = ctx2d(out);
      ctx.drawImage(c, 0, 0);
      const edge = o.edge ?? "bottom", s = o.size ?? 0.4, W = c.width, H = c.height;
      const [x0, y0, x1, y1] = edge === "top" ? [0, H * s, 0, 0] : edge === "left" ? [W * s, 0, 0, 0]
        : edge === "right" ? [W * (1 - s), 0, W, 0] : [0, H * (1 - s), 0, H];
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      return out;
    },
  },
  recolor: {
    desc: "Fill every opaque pixel with one colour (silhouettes, one-colour graphics).",
    fields: "color",
    run: (c, o) => silhouette(need(c, "recolor"), o.color ?? "#ffffff"),
  },
  opacity: {
    desc: "Make the whole bitmap more transparent.",
    fields: "value (0..1)",
    run: (c, o) => {
      c = need(c, "opacity");
      const out = blank(c.width, c.height), ctx = ctx2d(out);
      ctx.globalAlpha = o.value ?? 1; ctx.drawImage(c, 0, 0);
      return out;
    },
  },
  place: {
    desc: "Put the current bitmap onto a new background (colour, gradient or image) at a position and size.",
    fields: "width, height, background (#hex | gradient | transparent), image (src, drawn cover), image_ops (ops for that image), x, y (centre, 0..1, 0.5), size (share of the page height, or width if fit: width), fit (height|width|contain, default contain at size 1), anchor (center|bottom: y is the subject's bottom edge)",
    run: async (c, o) => {
      c = need(c, "place");
      const W = o.width ?? 1080, H = o.height ?? 1350;
      const out = blank(W, H), ctx = ctx2d(out);
      paint(ctx, W, H, o.background ?? "transparent");
      if (o.image) {
        const bg = await processCanvas(await load(o.image), o.image_ops ?? []);
        ctx.drawImage(fitInto(bg, W, H, "cover", o.image_focus), 0, 0);
      }
      let s: number;
      if (o.fit === "width") s = (W * (o.size ?? 1)) / c.width;
      else if (o.fit === "height") s = (H * (o.size ?? 1)) / c.height;
      else s = Math.min(W / c.width, H / c.height) * (o.size ?? 1);
      const dw = c.width * s, dh = c.height * s;
      const cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.5) * H;
      ctx.drawImage(c, cx - dw / 2, o.anchor === "bottom" ? cy - dh : cy - dh / 2, dw, dh);
      return out;
    },
  },
  overlay: {
    desc: "Lay an image over the current one (textures, light leaks, paper) with a blend mode.",
    fields: "src, mode (source-over|multiply|screen|overlay|soft-light|lighten|darken|color-dodge|…), opacity (0..1), fit (cover)",
    run: async (c, o) => {
      c = need(c, "overlay");
      const top = fitInto(await load(o.src), c.width, c.height, o.fit ?? "cover");
      const out = blank(c.width, c.height), ctx = ctx2d(out);
      ctx.drawImage(c, 0, 0);
      ctx.globalCompositeOperation = o.mode ?? "source-over";
      ctx.globalAlpha = o.opacity ?? 1;
      ctx.drawImage(top, 0, 0);
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(c, 0, 0); // keep the base's transparency
      return out;
    },
  },
  graphic: {
    desc: "Start from (or replace with) a vector graphic: a lumio doodle, a shape, a polygon/star, a Lucide icon, or raw SVG.",
    fields: "kind (doodle|shape|polygon|icon|svg), id (doodle/shape id, or Lucide icon name like 'sparkles'), svg, width, height, color, stroke (icons), sides/star/round (polygon)",
    run: async (_c, o) => {
      const W = o.width, H = o.height;
      let svg: string;
      if (o.kind === "doodle") {
        const d = DOODLES.find((x) => x.id === o.id);
        if (!d) throw new Error(`unknown doodle "${o.id}"`);
        svg = fitViewBox(d.svg);
      } else if (o.kind === "shape") {
        const s = findShape(o.id);
        if (!s) throw new Error(`unknown shape "${o.id}"`);
        const col = o.color ?? "#ffffff";
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400"><path d="${s.d}" ${s.line ? `fill="none" stroke="${col}" stroke-width="${o.stroke ?? 6}" stroke-linecap="round" stroke-linejoin="round"` : `fill="${col}"`}${s.evenOdd ? ' fill-rule="evenodd"' : ""}/></svg>`;
      } else if (o.kind === "polygon") {
        const pts = polygonPoints({ sides: o.sides ?? 6, star: o.star ?? 0, round: o.round ?? 0 }, 50);
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100" width="400" height="400"><polygon points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="${o.color ?? "#ffffff"}"/></svg>`;
      } else if (o.kind === "icon") {
        const mod = (await import("lucide-preact")) as unknown as Record<string, unknown>;
        const name = String(o.id).replace(/(^|[-_ ])(\w)/g, (_m, _s, ch: string) => ch.toUpperCase());
        const Icon = (mod[name] ?? mod[`${name}Icon`]) as Parameters<typeof h>[0] | undefined;
        if (!Icon) throw new Error(`unknown Lucide icon "${o.id}" (see lucide.dev/icons)`);
        const host = document.createElement("div");
        render(h(Icon as never, { size: 400, color: o.color ?? "#ffffff", strokeWidth: o.stroke ?? 2 }), host);
        svg = host.innerHTML.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      } else if (o.kind === "svg") {
        svg = String(o.svg);
      } else throw new Error(`graphic kind must be doodle, shape, polygon, icon or svg`);
      let c = await svgToCanvas(svg, W, H ?? (W ? undefined : 400));
      if (o.color && o.kind === "doodle") c = silhouette(c, o.color);
      return c;
    },
  },
};

async function processCanvas(start: HTMLCanvasElement | null, ops: Op[]): Promise<HTMLCanvasElement> {
  let cur = start;
  for (const [i, o] of ops.entries()) {
    const def = OPS[o.op];
    if (!def) throw new Error(`step ${i + 1}: unknown op "${o.op}" (${Object.keys(OPS).join(", ")})`);
    try { cur = await def.run(cur, o); } catch (e) { throw new Error(`step ${i + 1} (${o.op}): ${(e as Error).message}`); }
  }
  if (!cur) throw new Error("nothing to output: pass a source or start with canvas / graphic");
  return cur;
}

function webglBackend(): boolean {
  return fabric.getFilterBackend() instanceof fabric.WebGLFilterBackend;
}

async function process(src: string | null, ops: Op[] = []): Promise<string> {
  if (!webglBackend()) throw new Error("WebGL is not available in this browser; lumio filters would silently do nothing");
  const out = await processCanvas(src ? await load(src) : null, ops);
  return out.toDataURL("image/png");
}

/** Shortcut kept for the first version of the bridge: resize, then a look/effect stack. */
function treat(src: string, spec: TreatSpec = {}, size: { width?: number; height?: number; fit?: Fit; background?: string } = {}) {
  const ops: Op[] = [];
  if (size.width || size.height) ops.push({ op: "resize", ...size });
  if (spec.look || spec.effects?.length) ops.push({ op: "effects", ...spec });
  return process(src, ops);
}

const cutout = (src: string) => process(src, [{ op: "cutout" }]);

function list() {
  return {
    ops: Object.entries(OPS).map(([id, d]) => ({ id, desc: d.desc, fields: d.fields })),
    filters: LOOK_CATEGORIES.map((c) => ({ category: c.name, ids: c.looks.map((l) => l.id) })),
    adjust: NO_ADJUSTMENTS,
    effects: EFFECTS.map((e) => ({
      id: e.id, name: e.name, category: e.category, magic: !!e.magic, desc: e.desc,
      params: e.params.map((p) => ({
        key: p.key, label: p.label, kind: p.kind ?? "range", min: p.min, max: p.max, default: p.default,
        options: p.options?.map((o) => `${o.value}=${o.label}`),
      })),
    })),
    recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, desc: r.desc, stack: r.stack })),
    shapes: SHAPES.map((s) => s.id),
    doodles: DOODLES.map((d) => ({ id: d.id, group: d.group })),
    gradients: GRADIENT_PRESETS,
  };
}

declare global { interface Window { lumioBridge: unknown } }
window.lumioBridge = { ready: true, webgl: webglBackend(), process, treat, cutout, list };
