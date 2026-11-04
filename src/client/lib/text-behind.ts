import * as fabric from "fabric";

/*
 * Text behind subject, the way text-behind-image does it: three layers drawn
 * in the same box —
 *   1. the original photo            (bottom)
 *   2. any text                      (middle)
 *   3. the photo with its background removed (top)
 * Because the top layer is the same picture minus its background, the subject
 * covers the text and everything else shows through.
 *
 * In a free-form editor the photo can move, so the cut-out is linked to it:
 * the photo carries `subjectId`, the cut-out carries `cutoutOf` with the same
 * id, and every transform of the photo is copied onto the cut-out. The cut-out
 * ignores the pointer, so clicks reach the text underneath it.
 */

type Linked = fabric.FabricObject & { subjectId?: string; cutoutOf?: string };

const TRANSFORM_KEYS = [
  "left", "top", "scaleX", "scaleY", "angle", "flipX", "flipY", "skewX", "skewY", "originX", "originY",
] as const;

export const subjectIdOf = (obj: fabric.FabricObject | null | undefined) => (obj as Linked | null)?.subjectId;

export function findCutout(canvas: fabric.Canvas, photo: fabric.FabricObject): fabric.FabricObject | undefined {
  const id = subjectIdOf(photo);
  if (!id) return undefined;
  return canvas.getObjects().find((o) => (o as Linked).cutoutOf === id);
}

export function hasTextBehind(canvas: fabric.Canvas | null, photo: fabric.FabricObject | null): boolean {
  return !!canvas && !!photo && !!findCutout(canvas, photo);
}

/** Copies the photo's box onto its cut-out. */
export function syncCutout(canvas: fabric.Canvas, photo: fabric.FabricObject) {
  const cutout = findCutout(canvas, photo);
  if (!cutout) return;
  const props: Record<string, unknown> = {};
  for (const key of TRANSFORM_KEYS) props[key] = (photo as unknown as Record<string, unknown>)[key];
  cutout.set(props as Partial<fabric.FabricObject>);
  cutout.setCoords();
}

function prepareCutout(obj: fabric.FabricObject) {
  obj.set({ selectable: false, evented: false, hasControls: false });
}

/** Links a cut-out to its photo. Call before adding the cut-out to the canvas. */
export function linkCutout(photo: fabric.FabricObject, cutout: fabric.FabricObject) {
  const id = subjectIdOf(photo) ?? `subj_${Math.random().toString(36).slice(2, 10)}`;
  (photo as Linked).subjectId = id;
  (cutout as Linked).cutoutOf = id;
  (cutout as any).isCutout = true;
  prepareCutout(cutout);
}

export function unlinkCutout(canvas: fabric.Canvas, photo: fabric.FabricObject) {
  const cutout = findCutout(canvas, photo);
  delete (photo as Linked).subjectId;
  if (cutout) canvas.remove(cutout);
}

/**
 * Keeps cut-outs glued to their photos. Register before the history listeners
 * so a saved step already holds the synced position.
 */
export function installTextBehind(canvas: fabric.Canvas) {
  const follow = (e: { target?: fabric.FabricObject }) => {
    const target = e.target;
    if (!target) return;
    if (target instanceof fabric.ActiveSelection) {
      // Children are in selection space while grouped; sync once released.
      return;
    }
    if (subjectIdOf(target)) syncCutout(canvas, target);
  };
  canvas.on("object:moving", follow);
  canvas.on("object:scaling", follow);
  canvas.on("object:rotating", follow);
  canvas.on("object:skewing", follow);
  canvas.on("object:modified", follow);

  // A photo moved as part of a multi-selection: sync once the group lets go.
  canvas.on("selection:cleared", (e) => {
    for (const obj of e.deselected ?? []) if (subjectIdOf(obj)) syncCutout(canvas, obj);
    canvas.requestRenderAll();
  });
  canvas.on("selection:updated", (e) => {
    for (const obj of e.deselected ?? []) if (subjectIdOf(obj)) syncCutout(canvas, obj);
  });

  canvas.on("object:added", (e) => {
    const obj = e.target as Linked | undefined;
    if (!obj) return;
    if (obj.cutoutOf) prepareCutout(obj);
    // A pasted or duplicated photo must not steer the original's cut-out.
    if (obj.subjectId) {
      const twin = canvas.getObjects().find((o) => o !== obj && (o as Linked).subjectId === obj.subjectId);
      if (twin) delete obj.subjectId;
    }
  });

  // Deleting the photo takes its cut-out with it.
  canvas.on("object:removed", (e) => {
    const obj = e.target;
    if (!obj || !subjectIdOf(obj)) return;
    const cutout = findCutout(canvas, obj);
    if (cutout) canvas.remove(cutout);
  });
}
