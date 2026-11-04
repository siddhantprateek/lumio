import * as fabric from "fabric";

/*
 * Filters, adjustments and effects for shapes and text (not only images).
 *
 * Fabric only filters images. But every cached object is first drawn into
 * its own small bitmap (the "cache canvas") and that bitmap is what lands on
 * the page. So after Fabric redraws an element's cache, we run the same
 * filter chain over it. The element stays a live shape or text box — edit
 * the text and the effects re-apply — and exports include the effects
 * because export renders through the same caches.
 *
 * Elements with edits carry their filters in `_lumioFilters` (rebuilt from
 * the saved lumioLook / lumioAdjust / lumioEffects when a page loads).
 */

type WithFx = fabric.FabricObject & {
  _lumioFilters?: fabric.filters.BaseFilter<string>[];
  _cacheCanvas?: HTMLCanvasElement;
  _cacheContext?: CanvasRenderingContext2D | null;
};

/** Runs filters over a canvas in place. */
function filterCanvasInPlace(canvas: HTMLCanvasElement, filters: fabric.filters.BaseFilter<string>[]) {
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  // The backend changes the target context's transform while copying back,
  // and the cache context's transform must survive, so filter into a scratch
  // canvas and copy the result over with an identity transform.
  const scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  try {
    fabric.getFilterBackend().applyFilters(filters, canvas, w, h, scratch);
  } catch {
    return; // leave the element unfiltered rather than blank
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

let installed = false;

/** Patches Fabric once so element caches get their filters after each redraw. */
export function installElementEffects() {
  if (installed) return;
  installed = true;
  const proto = fabric.FabricObject.prototype as unknown as {
    drawObject: (this: WithFx, ctx: CanvasRenderingContext2D, forClipping?: boolean, context?: unknown) => void;
  };
  const original = proto.drawObject;
  proto.drawObject = function (this: WithFx, ctx, forClipping, context) {
    original.call(this, ctx, forClipping, context);
    const filters = this._lumioFilters;
    if (!forClipping && filters?.length && ctx === this._cacheContext && this._cacheCanvas) {
      filterCanvasInPlace(this._cacheCanvas, filters);
    }
  };
}

/** Sets (or clears) an element's filter chain and asks for a redraw. */
export function setElementFilters(obj: fabric.FabricObject, filters: fabric.filters.BaseFilter<string>[]) {
  (obj as WithFx)._lumioFilters = filters.length ? filters : undefined;
  // Effects live on the cache, so the element must be cached.
  obj.set({ objectCaching: true, dirty: true });
}

/** An unfiltered snapshot of an element, for thumbnails. */
export function elementSnapshot(obj: fabric.FabricObject, size: number): HTMLCanvasElement {
  const fx = obj as WithFx;
  const saved = fx._lumioFilters;
  fx._lumioFilters = undefined;
  try {
    const w = obj.getScaledWidth() || 1, h = obj.getScaledHeight() || 1;
    return obj.toCanvasElement({ multiplier: Math.min(4, size / Math.min(w, h)) });
  } finally {
    fx._lumioFilters = saved;
  }
}
