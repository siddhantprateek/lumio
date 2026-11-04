import * as fabric from "fabric";
import { useEffect, useState } from "preact/hooks";
import { findCutout, syncCutout } from "./text-behind";

/*
 * Canva-style crop for images.
 *
 * While cropping, the real image is hidden and three temporary layers take
 * its place:
 *   ghost   – the whole picture, faded, showing what lies outside the crop
 *   preview – the whole picture at full strength, clipped to the frame
 *   frame   – the crop box with handles; it is the only interactive layer
 * Resizing the frame changes the crop. Dragging inside it moves the picture
 * underneath (the frame stays put), so it feels like sliding a photo in a
 * window. Done writes the result as Fabric's native cropX / cropY / width /
 * height, so the crop saves, undoes and exports like any other property.
 *
 * Nothing temporary is ever saved: history pauses while cropping, the temp
 * layers are excluded from export, and `serializeCanvas` shows the image as
 * it was before the crop started.
 */

interface Box { left: number; top: number; width: number; height: number }

interface CropSession {
  canvas: fabric.Canvas;
  image: fabric.FabricImage;
  ghost: fabric.FabricImage;
  preview: fabric.FabricImage;
  frame: fabric.Rect;
  clip: fabric.Rect;
  cutout?: fabric.FabricObject;
  /** Ghost scale that just covers the frame at zoom 1. */
  baseScale: number;
  zoom: number;
  ratio: number | null;
  natural: { width: number; height: number };
  wasUniform: boolean;
  lastFrame: Box;
  lastGhost: { left: number; top: number };
  detach: () => void;
  onDone: (committed: boolean) => void;
}

let session: CropSession | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isCropping = (canvas?: fabric.Canvas | null) => !!session && (!canvas || session.canvas === canvas);

/** Re-renders when crop mode starts, changes or ends. */
export function useCropSession() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return session ? { zoom: session.zoom, ratio: session.ratio, natural: session.natural } : null;
}

/** JSON for saving / history that never contains crop-mode leftovers. */
export function serializeCanvas(canvas: fabric.Canvas): string {
  if (!session || session.canvas !== canvas) return JSON.stringify(canvas.toJSON());
  const { image, cutout } = session;
  image.visible = true;
  if (cutout) cutout.visible = true;
  try {
    return JSON.stringify(canvas.toJSON());
  } finally {
    image.visible = false;
    if (cutout) cutout.visible = false;
  }
}

/** Can this image be cropped right now? Rotated images are not supported yet. */
export function cropBlockedReason(img: fabric.FabricImage): string | null {
  if (Math.round(img.angle ?? 0) % 360 !== 0) return "Set rotation to 0° to crop";
  if (img.skewX || img.skewY) return "Remove tilt to crop";
  return null;
}

const frameBox = (f: fabric.Rect): Box => ({
  left: f.left ?? 0,
  top: f.top ?? 0,
  width: (f.width ?? 0) * (f.scaleX ?? 1),
  height: (f.height ?? 0) * (f.scaleY ?? 1),
});

const ghostBox = (s: CropSession): Box => ({
  left: s.ghost.left ?? 0,
  top: s.ghost.top ?? 0,
  width: s.natural.width * (s.ghost.scaleX ?? 1),
  height: s.natural.height * (s.ghost.scaleY ?? 1),
});

const inside = (inner: Box, outer: Box, eps = 0.5) =>
  inner.left >= outer.left - eps && inner.top >= outer.top - eps &&
  inner.left + inner.width <= outer.left + outer.width + eps &&
  inner.top + inner.height <= outer.top + outer.height + eps;

/** Bakes the frame's scale into width / height, so its size is plain numbers. */
function normaliseFrame(f: fabric.Rect) {
  const b = frameBox(f);
  f.set({ width: b.width, height: b.height, scaleX: 1, scaleY: 1 });
  f.setCoords();
}

function syncLayers(s: CropSession) {
  const g = s.ghost;
  s.preview.set({ left: g.left, top: g.top, scaleX: g.scaleX, scaleY: g.scaleY });
  const b = frameBox(s.frame);
  s.clip.set({ left: b.left, top: b.top, width: b.width, height: b.height });
  s.preview.setCoords();
  s.canvas.requestRenderAll();
}

/** Keeps the picture covering the frame: moves the ghost back inside if needed. */
function clampGhost(s: CropSession) {
  const f = frameBox(s.frame);
  const g = ghostBox(s);
  let left = g.left, top = g.top;
  if (left > f.left) left = f.left;
  if (top > f.top) top = f.top;
  if (left + g.width < f.left + f.width) left = f.left + f.width - g.width;
  if (top + g.height < f.top + f.height) top = f.top + f.height - g.height;
  s.ghost.set({ left, top });
  s.ghost.setCoords();
}

export async function startCrop(canvas: fabric.Canvas, image: fabric.FabricImage, onDone: (committed: boolean) => void) {
  if (session) commitCrop();
  if (cropBlockedReason(image)) return;
  const natural = image.getOriginalSize();
  const sx = image.scaleX ?? 1;
  const sy = image.scaleY ?? 1;
  const cropX = image.cropX ?? 0;
  const cropY = image.cropY ?? 0;
  const w = image.width ?? natural.width;
  const h = image.height ?? natural.height;

  // Where the whole picture sits, given the current crop (and flips).
  const ghostLeft = (image.left ?? 0) - (image.flipX ? natural.width - cropX - w : cropX) * sx;
  const ghostTop = (image.top ?? 0) - (image.flipY ? natural.height - cropY - h : cropY) * sy;

  const makeFull = async () => {
    const c = (await image.clone()) as fabric.FabricImage;
    c.set({
      cropX: 0, cropY: 0, width: natural.width, height: natural.height,
      left: ghostLeft, top: ghostTop, originX: "left", originY: "top",
      clipPath: undefined, shadow: null, opacity: 1, visible: true,
      selectable: false, evented: false, excludeFromExport: true, hasControls: false,
    });
    delete (c as any).subjectId;
    return c;
  };
  const ghost = await makeFull();
  ghost.set({ opacity: 0.35 });
  const preview = await makeFull();
  const clip = new fabric.Rect({ absolutePositioned: true, left: image.left, top: image.top, width: w * sx, height: h * sy });
  preview.clipPath = clip;

  const frame = new fabric.Rect({
    left: image.left, top: image.top, width: w * sx, height: h * sy,
    originX: "left", originY: "top",
    fill: "rgba(0,0,0,0)", stroke: "#ffffff", strokeWidth: 2, strokeUniform: true, strokeDashArray: [6, 4],
    excludeFromExport: true, lockRotation: true, lockScalingFlip: true,
    transparentCorners: false, cornerColor: "#ffffff", cornerStrokeColor: "#6366f1", cornerSize: 14, borderColor: "#6366f1",
  });
  frame.setControlsVisibility({ mtr: false });

  const cutout = findCutout(canvas, image);
  const index = canvas.getObjects().indexOf(image);
  image.visible = false;
  if (cutout) cutout.visible = false;

  const s: CropSession = {
    canvas, image, ghost, preview, frame, clip, cutout,
    baseScale: sx, zoom: 1, ratio: null, natural,
    wasUniform: canvas.uniformScaling,
    lastFrame: frameBox(frame),
    lastGhost: { left: ghostLeft, top: ghostTop },
    detach: () => {},
    onDone,
  };
  session = s;

  canvas.uniformScaling = false;
  canvas.insertAt(index + 1, ghost, preview, frame);
  canvas.setActiveObject(frame);
  syncLayers(s);

  // Dragging inside the frame slides the picture instead of moving the frame.
  const onMoving = (e: { target?: fabric.FabricObject }) => {
    if (e.target !== frame) return;
    const dx = (frame.left ?? 0) - s.lastFrame.left;
    const dy = (frame.top ?? 0) - s.lastFrame.top;
    frame.set({ left: s.lastFrame.left, top: s.lastFrame.top });
    frame.setCoords();
    ghost.set({ left: (ghost.left ?? 0) + dx, top: (ghost.top ?? 0) + dy });
    clampGhost(s);
    s.lastGhost = { left: ghost.left ?? 0, top: ghost.top ?? 0 };
    syncLayers(s);
  };
  // Resizing the frame is the crop; it may not leave the picture.
  const onScaling = (e: { target?: fabric.FabricObject }) => {
    if (e.target !== frame) return;
    const b = frameBox(frame);
    if (!inside(b, ghostBox(s)) || b.width < 12 || b.height < 12) {
      frame.set({ left: s.lastFrame.left, top: s.lastFrame.top, width: s.lastFrame.width, height: s.lastFrame.height, scaleX: 1, scaleY: 1 });
      frame.setCoords();
    } else {
      s.lastFrame = b;
    }
    syncLayers(s);
  };
  const onModified = (e: { target?: fabric.FabricObject }) => {
    if (e.target !== frame) return;
    normaliseFrame(frame);
    s.lastFrame = frameBox(frame);
    syncLayers(s);
    emit();
  };
  // Clicking away (or selecting something else) applies the crop, like Canva.
  const onSelection = () => {
    if (session === s && s.canvas.getActiveObject() !== frame) end(true, false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (session !== s) return;
    if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); commitCrop(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); cancelCrop(); }
    else if (e.key === "Delete" || e.key === "Backspace" || ((e.ctrlKey || e.metaKey) && /^[zZyYdDcCvVaA]$/.test(e.key))) {
      // Keep editing shortcuts from acting on the temporary crop layers.
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  canvas.on("object:moving", onMoving);
  canvas.on("object:scaling", onScaling);
  canvas.on("object:modified", onModified);
  canvas.on("selection:cleared", onSelection);
  canvas.on("selection:updated", onSelection);
  window.addEventListener("keydown", onKey, true);
  s.detach = () => {
    canvas.off("object:moving", onMoving);
    canvas.off("object:scaling", onScaling);
    canvas.off("object:modified", onModified);
    canvas.off("selection:cleared", onSelection);
    canvas.off("selection:updated", onSelection);
    window.removeEventListener("keydown", onKey, true);
  };
  emit();
}

/** Fits the frame to a ratio (width / height), as large as the picture allows, centred where it is. */
export function setCropRatio(ratio: number | null) {
  const s = session;
  if (!s) return;
  s.ratio = ratio;
  // Fixed ratios resize from the corners only, keeping the shape.
  s.frame.setControlsVisibility({ ml: ratio === null, mr: ratio === null, mt: ratio === null, mb: ratio === null });
  s.canvas.uniformScaling = ratio !== null;
  if (ratio !== null) {
    const g = ghostBox(s);
    const f = frameBox(s.frame);
    let width = Math.min(g.width, g.height * ratio);
    let height = width / ratio;
    // Keep roughly the current size if it fits.
    const area = f.width * f.height;
    const k = Math.min(1, Math.sqrt(area / (width * height)) * 1.0001);
    width *= Math.max(k, 0.3);
    height *= Math.max(k, 0.3);
    const cx = f.left + f.width / 2;
    const cy = f.top + f.height / 2;
    let left = Math.max(g.left, Math.min(cx - width / 2, g.left + g.width - width));
    let top = Math.max(g.top, Math.min(cy - height / 2, g.top + g.height - height));
    s.frame.set({ left, top, width, height, scaleX: 1, scaleY: 1 });
    s.frame.setCoords();
    s.lastFrame = frameBox(s.frame);
  }
  syncLayers(s);
  emit();
}

/** Zooms the picture behind the frame (1 = as cropped when crop mode started). */
export function setCropZoom(zoom: number) {
  const s = session;
  if (!s) return;
  const f = frameBox(s.frame);
  const g = ghostBox(s);
  // Never smaller than needed to cover the frame.
  const minScale = Math.max(f.width / s.natural.width, f.height / s.natural.height);
  const scale = Math.max(minScale, s.baseScale * zoom);
  const fx = f.left + f.width / 2, fy = f.top + f.height / 2;
  // Zoom around the frame centre.
  const rx = (fx - g.left) / g.width, ry = (fy - g.top) / g.height;
  const nw = s.natural.width * scale, nh = s.natural.height * scale;
  s.ghost.set({ scaleX: scale * Math.sign(s.ghost.scaleX ?? 1), scaleY: scale * Math.sign(s.ghost.scaleY ?? 1), left: fx - rx * nw, top: fy - ry * nh });
  s.zoom = scale / s.baseScale;
  clampGhost(s);
  syncLayers(s);
  emit();
}

/** Back to the whole picture. */
export function resetCrop() {
  const s = session;
  if (!s) return;
  s.ghost.set({ scaleX: s.baseScale, scaleY: s.baseScale });
  const g = ghostBox(s);
  s.frame.set({ left: g.left, top: g.top, width: g.width, height: g.height, scaleX: 1, scaleY: 1 });
  s.frame.setCoords();
  s.lastFrame = frameBox(s.frame);
  s.ratio = null;
  s.zoom = 1;
  s.frame.setControlsVisibility({ ml: true, mr: true, mt: true, mb: true });
  s.canvas.uniformScaling = false;
  syncLayers(s);
  emit();
}

function end(committed: boolean, reselect = true) {
  const s = session;
  if (!s) return;
  session = null;
  s.detach();
  const { canvas, image, ghost, preview, frame, cutout } = s;
  canvas.uniformScaling = s.wasUniform;
  // Visible again BEFORE removing the temp layers: removal saves a history
  // step, which must not capture the photo hidden.
  image.visible = true;
  if (cutout) cutout.visible = true;
  canvas.remove(ghost, preview, frame);

  if (committed) {
    const f = frameBox(frame);
    const g = ghostBox(s);
    const sx = Math.abs(ghost.scaleX ?? 1), sy = Math.abs(ghost.scaleY ?? 1);
    const cropX = image.flipX ? (g.left + g.width - (f.left + f.width)) / sx : (f.left - g.left) / sx;
    const cropY = image.flipY ? (g.top + g.height - (f.top + f.height)) / sy : (f.top - g.top) / sy;
    const props = {
      cropX: Math.max(0, cropX), cropY: Math.max(0, cropY),
      width: Math.min(s.natural.width, f.width / sx), height: Math.min(s.natural.height, f.height / sy),
      left: f.left, top: f.top, scaleX: sx, scaleY: sy,
    };
    image.set(props);
    // A rounded-corner clip is sized to the image; resize it with the crop.
    const round = image.clipPath as fabric.Rect | undefined;
    if (round instanceof fabric.Rect && !round.absolutePositioned) {
      image.clipPath = new fabric.Rect({ width: props.width, height: props.height, rx: round.rx, ry: round.ry, originX: "center", originY: "center" });
    }
    image.setCoords();
    if (cutout) {
      cutout.set({ cropX: props.cropX, cropY: props.cropY, width: props.width, height: props.height });
      syncCutout(canvas, image);
    }
  }
  if (reselect) canvas.setActiveObject(image);
  canvas.requestRenderAll();
  if (committed) canvas.fire("object:modified", { target: image } as never);
  emit();
  s.onDone(committed);
}

export const commitCrop = () => end(true);
export const cancelCrop = () => end(false);
