import * as fabric from "fabric";
import { uploadImageBlob } from "./clipboard-import";

/*
 * The page background. A page has a colour or gradient (canvas
 * backgroundColor) and, optionally, a background image: a full-page
 * FabricImage at the bottom, flagged `_isBgImage`.
 *
 * The background image must never move or be picked up by a click, so it is
 * locked. Fabric does not save `selectable` / `evented`, so the lock is
 * re-applied whenever a page loads (see page-canvas).
 */

export const BG_LOCK = {
  selectable: false,
  evented: false,
  hasControls: false,
  hasBorders: true,
  lockMovementX: true,
  lockMovementY: true,
  lockScalingX: true,
  lockScalingY: true,
  lockRotation: true,
  hoverCursor: "default",
} as const;

export const isBgImage = (obj: fabric.FabricObject | null | undefined): obj is fabric.FabricImage =>
  !!obj && obj instanceof fabric.FabricImage && !!(obj as { _isBgImage?: boolean })._isBgImage;

export const findBgImage = (canvas: fabric.Canvas) => canvas.getObjects().find(isBgImage);

/**
 * True for the lowest element when it is a shape or image covering (almost)
 * the whole page: templates paint their background that way.
 */
export function isBackdrop(canvas: fabric.Canvas, obj: fabric.FabricObject, width: number, height: number) {
  if (canvas.getObjects()[0] !== obj) return false;
  if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) return false;
  obj.setCoords();
  const pts = Object.values(obj.aCoords);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const slack = 4;
  return minX <= slack && minY <= slack && maxX >= width - slack && maxY >= height - slack;
}

/** A template's full-page background shape (not an image), if the page has one. */
export function findBackdropShape(canvas: fabric.Canvas, width: number, height: number) {
  const bottom = canvas.getObjects()[0];
  return bottom && !(bottom instanceof fabric.FabricImage) && isBackdrop(canvas, bottom, width, height) ? bottom : undefined;
}

export function lockBackground(obj: fabric.FabricObject) {
  if (isBgImage(obj)) obj.set(BG_LOCK);
}

/** Paints the page's colour or gradient into a PNG upload, so it can take filters and effects. */
export async function bakeBackground(canvas: fabric.Canvas, width: number, height: number): Promise<string> {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  const ctx = el.getContext("2d")!;
  const bg = canvas.backgroundColor;
  ctx.fillStyle = bg instanceof fabric.Gradient ? bg.toLive(ctx) : typeof bg === "string" && bg ? bg : "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    el.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render the background."))), "image/png"),
  );
  return uploadImageBlob(blob);
}

/** Puts `url` in as the page's background image (replacing any), covering the page. */
export async function placeBackgroundImage(canvas: fabric.Canvas, url: string, width: number, height: number) {
  const img = await fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
  // Cover the page, centred, like a CSS `background-size: cover`.
  const scale = Math.max(width / (img.width || 1), height / (img.height || 1));
  img.set({
    left: (width - (img.width || 0) * scale) / 2,
    top: (height - (img.height || 0) * scale) / 2,
    scaleX: scale,
    scaleY: scale,
    ...BG_LOCK,
  });
  (img as { _isBgImage?: boolean })._isBgImage = true;
  const old = findBgImage(canvas);
  if (old) canvas.remove(old);
  canvas.add(img);
  canvas.sendObjectToBack(img);
  canvas.requestRenderAll();
  return img;
}
