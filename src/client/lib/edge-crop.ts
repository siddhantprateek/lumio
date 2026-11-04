import * as fabric from "fabric";
import { findCutout, syncCutout } from "./text-behind";

/*
 * Side handles on an image crop it instead of stretching it (how Canva treats
 * photos): dragging an edge in trims that side, dragging it out reveals more
 * of the original picture, up to its real edge. Corner handles still resize
 * proportionally. The result is Fabric's native cropX / cropY / width /
 * height, so it saves, undoes and exports like any other property.
 *
 * Works in the image's own coordinate space, so it is correct for rotated and
 * flipped images too.
 */

type Side = "l" | "r" | "t" | "b";
const MIN = 10;

/** The two corners on the side that must stay put while `side` moves. */
const FIXED: Record<Side, ["tl" | "tr" | "bl" | "br", "tl" | "tr" | "bl" | "br"]> = {
  r: ["tl", "bl"],
  l: ["tr", "br"],
  b: ["tl", "tr"],
  t: ["bl", "br"],
};

function midpoint(obj: fabric.FabricObject, keys: [string, string]) {
  const c = obj.aCoords as Record<string, fabric.Point>;
  return new fabric.Point((c[keys[0]].x + c[keys[1]].x) / 2, (c[keys[0]].y + c[keys[1]].y) / 2);
}

/**
 * The frame has grown past the picture's edge on the dragged axis. Like Canva,
 * scale the picture up (keeping its proportions) until it covers the new
 * frame; the other axis is then cropped automatically, centred on what was
 * visible. `nextLocal` is the wanted frame size along the dragged axis, in the
 * image's current (pre-scale) pixel units.
 */
function fillFrame(img: fabric.FabricImage, horizontal: boolean, nextLocal: number, movesSourceStart: boolean) {
  const natural = img.getOriginalSize();
  const sx = Math.abs(img.scaleX ?? 1), sy = Math.abs(img.scaleY ?? 1);
  // Wanted frame size on the page.
  const frameW = horizontal ? nextLocal * sx : (img.width ?? 0) * sx;
  const frameH = horizontal ? (img.height ?? 0) * sy : nextLocal * sy;
  const scale = Math.max(frameW / natural.width, frameH / natural.height);
  const w = Math.min(natural.width, frameW / scale);
  const h = Math.min(natural.height, frameH / scale);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const cropX0 = img.cropX ?? 0, cropY0 = img.cropY ?? 0;
  const w0 = img.width ?? w, h0 = img.height ?? h;
  let cropX: number, cropY: number;
  if (horizontal) {
    // Keep the fixed edge's spot in the picture; centre the other axis.
    cropX = movesSourceStart ? clamp(cropX0 + w0 - w, 0, natural.width - w) : clamp(cropX0, 0, natural.width - w);
    cropY = clamp(cropY0 + h0 / 2 - h / 2, 0, natural.height - h);
  } else {
    cropY = movesSourceStart ? clamp(cropY0 + h0 - h, 0, natural.height - h) : clamp(cropY0, 0, natural.height - h);
    cropX = clamp(cropX0 + w0 / 2 - w / 2, 0, natural.width - w);
  }
  return {
    width: w,
    height: h,
    cropX,
    cropY,
    scaleX: scale * Math.sign(img.scaleX ?? 1),
    scaleY: scale * Math.sign(img.scaleY ?? 1),
  };
}

function cropHandler(side: Side): fabric.TransformActionHandler {
  return (_e, transform, x, y) => {
    const img = transform.target as fabric.FabricImage;
    const natural = img.getOriginalSize();
    // Pointer in the image's local space: origin at its centre, units = image pixels.
    const local = fabric.util.transformPoint(new fabric.Point(x, y), fabric.util.invertTransform(img.calcTransformMatrix()));
    const horizontal = side === "l" || side === "r";
    const size = horizontal ? img.width : img.height;
    const offset = horizontal ? img.cropX ?? 0 : img.cropY ?? 0;
    const full = horizontal ? natural.width : natural.height;
    const flipped = horizontal ? img.flipX : img.flipY;

    let next = side === "r" ? local.x + size / 2
      : side === "l" ? size / 2 - local.x
      : side === "b" ? local.y + size / 2
      : size / 2 - local.y;

    // Local "far" sides map to the source's far edge unless the image is flipped.
    const movesSourceStart = (side === "l" || side === "t") !== !!flipped;
    const max = movesSourceStart ? offset + size : full - offset;
    next = Math.max(MIN, next);
    if (Math.abs(next - size) < 0.01) return false;

    const fixedBefore = midpoint(img, FIXED[side]);
    let props: Record<string, number>;
    if (next <= max) {
      // Plain crop: there is still picture to reveal (or we are trimming).
      props = horizontal ? { width: next } : { height: next };
      if (movesSourceStart) props[horizontal ? "cropX" : "cropY"] = offset + (size - next);
    } else {
      props = fillFrame(img, horizontal, next, movesSourceStart);
    }
    img.set(props);
    img.setCoords();
    // Keep the opposite edge where it was.
    const fixedAfter = midpoint(img, FIXED[side]);
    img.set({ left: (img.left ?? 0) + fixedBefore.x - fixedAfter.x, top: (img.top ?? 0) + fixedBefore.y - fixedAfter.y });
    img.setCoords();

    // Rounded corners are a clip sized to the image; keep it matching.
    const round = img.clipPath as fabric.Rect | undefined;
    if (round instanceof fabric.Rect && !round.absolutePositioned) {
      round.set({ width: img.width, height: img.height });
      img.set({ dirty: true });
    }
    // A text-behind cut-out shows the same pixels, so it takes the same crop.
    const canvas = img.canvas as fabric.Canvas | undefined;
    const cutout = canvas ? findCutout(canvas, img) : undefined;
    if (canvas && cutout) {
      cutout.set({ cropX: img.cropX, cropY: img.cropY, width: img.width, height: img.height });
      syncCutout(canvas, img);
    }
    return true;
  };
}

/** Replaces an image's side handles with crop handles (keeps their look). */
export function installEdgeCrop(img: fabric.FabricImage) {
  const sides: [string, Side, string][] = [["ml", "l", "ew-resize"], ["mr", "r", "ew-resize"], ["mt", "t", "ns-resize"], ["mb", "b", "ns-resize"]];
  const controls = { ...img.controls };
  for (const [key, side, cursor] of sides) {
    const old = controls[key];
    if (!old) continue;
    controls[key] = new fabric.Control({
      x: old.x,
      y: old.y,
      offsetX: old.offsetX,
      offsetY: old.offsetY,
      sizeX: old.sizeX,
      sizeY: old.sizeY,
      render: old.render,
      cursorStyle: cursor,
      actionName: "crop",
      actionHandler: cropHandler(side),
    });
  }
  img.controls = controls;
}
