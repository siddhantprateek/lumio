// Getting things from outside Lumio onto a page: the system clipboard (Ctrl+V,
// right-click → Paste) and drag-and-drop (files from the desktop, images or
// links from another browser tab).

/**
 * Written to the system clipboard when an element is copied inside Lumio, so a
 * later paste can tell whether the most recent copy was a Lumio element or
 * something from another app.
 */
export const ELEMENT_MARKER = "[Lumio element]";

export type Incoming =
  | { kind: "image-file"; file: Blob }
  | { kind: "image-url"; url: string }
  | { kind: "text"; text: string }
  | { kind: "element" };

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Saves an image blob as an upload and returns its URL. */
export async function uploadImageBlob(blob: Blob): Promise<string> {
  const ext = EXT[blob.type] ?? "png";
  const name = blob instanceof File && /\.\w+$/.test(blob.name) ? blob.name : `pasted.${ext}`;
  const form = new FormData();
  form.append("file", new File([blob], name, { type: blob.type || "image/png" }));
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error || "Could not save the image.");
  return data.url;
}

/** Turns any image address into one the canvas can use (same-origin upload). */
export async function importImageUrl(url: string): Promise<string> {
  if (url.startsWith("/api/uploads/") || url.startsWith(`${location.origin}/api/uploads/`)) return url;
  if (url.startsWith("data:image/") || url.startsWith("blob:")) {
    return uploadImageBlob(await (await fetch(url)).blob());
  }
  const res = await fetch("/api/uploads/from-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error || "Could not add that image.");
  return data.url;
}

const looksLikeUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

function firstImageSrc(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const src = doc.querySelector("img")?.getAttribute("src");
  return src && (looksLikeUrl(src) || src.startsWith("data:image/")) ? src : null;
}

/** Reads a paste or drop. Must be called while the event is still live. */
export function readDataTransfer(dt: DataTransfer | null): Incoming | null {
  if (!dt) return null;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return { kind: "image-file", file };
    }
  }
  const text = dt.getData("text/plain");
  if (text === ELEMENT_MARKER) return { kind: "element" };
  const html = dt.getData("text/html");
  const fromHtml = html ? firstImageSrc(html) : null;
  if (fromHtml) return { kind: "image-url", url: fromHtml };
  const uri = dt.getData("text/uri-list").split("\n").find((l) => l && !l.startsWith("#"));
  if (uri && looksLikeUrl(uri)) return { kind: "image-url", url: uri.trim() };
  if (text && looksLikeUrl(text)) return { kind: "image-url", url: text.trim() };
  if (text.trim()) return { kind: "text", text: text.trim() };
  return null;
}

/**
 * Reads the system clipboard on demand (right-click → Paste). The browser may
 * ask for permission the first time. Returns null if it is empty or blocked.
 */
export async function readSystemClipboard(): Promise<Incoming | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const image = item.types.find((t) => t.startsWith("image/"));
      if (image) return { kind: "image-file", file: await item.getType(image) };
    }
    for (const item of items) {
      if (item.types.includes("text/html")) {
        const src = firstImageSrc(await (await item.getType("text/html")).text());
        if (src) return { kind: "image-url", url: src };
      }
      if (item.types.includes("text/plain")) {
        const text = (await (await item.getType("text/plain")).text()).trim();
        if (text === ELEMENT_MARKER) return { kind: "element" };
        if (looksLikeUrl(text)) return { kind: "image-url", url: text };
        if (text) return { kind: "text", text };
      }
    }
  } catch {
    // Permission denied or unsupported: the caller falls back to Lumio's own clipboard.
  }
  return null;
}

/** Marks the system clipboard so the next paste knows a Lumio element is newest. */
export function markElementCopied() {
  navigator.clipboard?.writeText(ELEMENT_MARKER).catch(() => {});
}

/** Fired by a page when something is dropped on it; the clipboard bridge places it. */
export const IMPORT_EVENT = "lumio:import";
export interface ImportDetail {
  item: Incoming;
  /** The page it was dropped on; defaults to the active page. */
  canvas?: import("fabric").Canvas;
  /** Page coordinates to centre the item on; omitted means page centre. */
  at?: { x: number; y: number };
}
