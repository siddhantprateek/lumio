// The full Google Fonts catalogue, via the Fontsource API and CDN. Fonts are
// loaded on demand (only the weights a design uses), so the app stays light.
import * as fabric from "fabric";

export interface GoogleFont {
  id: string;
  family: string;
  category: string;
  weights: number[];
  styles: string[];
}

let catalog: Promise<GoogleFont[]> | null = null;
const loading = new Map<string, Promise<void>>();

export function fetchGoogleFonts(): Promise<GoogleFont[]> {
  catalog ??= fetch("https://api.fontsource.org/v1/fonts?subsets=latin")
    .then((r) => {
      if (!r.ok) throw new Error("catalogue unavailable");
      return r.json() as Promise<(GoogleFont & { type: string })[]>;
    })
    .then((all) => all.filter((f) => f.type === "google"))
    .catch((error) => {
      catalog = null; // allow a retry
      throw error;
    });
  return catalog;
}

/** Loads regular and bold (when offered) so the Bold button works too. */
export function loadGoogleFont(font: GoogleFont): Promise<void> {
  let pending = loading.get(font.id);
  if (!pending) {
    const weights = [400, 700].filter((w) => font.weights.includes(w));
    if (weights.length === 0) weights.push(font.weights[0] ?? 400);
    pending = Promise.all(
      weights.map(async (weight) => {
        const url = `https://cdn.jsdelivr.net/fontsource/fonts/${font.id}@latest/latin-${weight}-normal.woff2`;
        const face = await new FontFace(font.family, `url("${url}")`, { weight: String(weight) }).load();
        document.fonts.add(face);
      })
    ).then(() => undefined);
    pending.catch(() => loading.delete(font.id));
    loading.set(font.id, pending);
  }
  return pending;
}

/** Makes sure every Google font a canvas uses is loaded, then redraws it. */
export async function ensureCanvasFonts(canvas: fabric.Canvas): Promise<void> {
  // `document.fonts.check` says true for a family nothing has registered, so ask the registry.
  const registered = new Set<string>();
  document.fonts.forEach((face) => registered.add(face.family.replace(/^["']|["']$/g, "")));
  const used = new Set<string>();
  for (const obj of canvas.getObjects()) {
    const family = (obj as { fontFamily?: string }).fontFamily;
    if (family && !registered.has(family)) used.add(family);
  }
  if (used.size === 0) return;
  try {
    const fonts = await fetchGoogleFonts();
    const wanted = fonts.filter((f) => used.has(f.family));
    await Promise.allSettled(wanted.map(loadGoogleFont));
  } catch {
    return; // offline: text falls back to a default font
  }
  fabric.cache.clearFontCache();
  for (const obj of canvas.getObjects()) {
    if ("fontFamily" in obj) {
      (obj as fabric.Textbox).initDimensions();
      obj.setCoords();
    }
  }
  canvas.requestRenderAll();
}
