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
  /** Extra cache room around the element, in its own units, so blurs are not cut off. */
  _lumioPad?: number;
  /** Background blur behind the element, in page pixels. */
  lumioBackdrop?: number;
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

/** Traces an element's outline (in its own centred coordinates) for clipping. */
function traceShape(obj: fabric.FabricObject): Path2D {
  const w = obj.width ?? 0, h = obj.height ?? 0;
  const p = new Path2D();
  if (obj instanceof fabric.Circle) {
    p.arc(0, 0, obj.radius ?? w / 2, 0, Math.PI * 2);
  } else if (obj instanceof fabric.Ellipse) {
    p.ellipse(0, 0, obj.rx ?? w / 2, obj.ry ?? h / 2, 0, 0, Math.PI * 2);
  } else if (obj instanceof fabric.Triangle) {
    p.moveTo(-w / 2, h / 2); p.lineTo(0, -h / 2); p.lineTo(w / 2, h / 2); p.closePath();
  } else if (obj instanceof fabric.Polyline) {
    const off = obj.pathOffset;
    obj.points.forEach((pt, i) => (i ? p.lineTo(pt.x - off.x, pt.y - off.y) : p.moveTo(pt.x - off.x, pt.y - off.y)));
    p.closePath();
  } else if (obj instanceof fabric.Path) {
    const off = obj.pathOffset;
    p.addPath(new Path2D(fabric.util.joinPath(obj.path)), new DOMMatrix().translate(-off.x, -off.y));
  } else if (obj instanceof fabric.Rect && (obj.rx || obj.ry)) {
    p.roundRect(-w / 2, -h / 2, w, h, Math.min(obj.rx ?? 0, w / 2, h / 2));
  } else {
    p.rect(-w / 2, -h / 2, w, h);
  }
  return p;
}

/**
 * Background blur (CSS backdrop-filter, for the canvas): what is already
 * painted under the element is blurred, clipped to the element's shape,
 * before the element itself is drawn on top.
 */
function drawBackdrop(obj: WithFx, ctx: CanvasRenderingContext2D) {
  const amount = obj.lumioBackdrop ?? 0;
  if (amount <= 0) return;
  const m = ctx.getTransform(); // page to device pixels (zoom and retina)
  const blur = amount * Math.hypot(m.a, m.b);
  obj.setCoords();
  const pts = Object.values(obj.aCoords).map((pt) => m.transformPoint(new DOMPoint(pt.x, pt.y)));
  const pad = blur * 2;
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q.x)) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q.y)) - pad));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map((q) => q.x)) + pad));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map((q) => q.y)) + pad));
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save();
  const t = obj.calcTransformMatrix();
  ctx.transform(t[0], t[1], t[2], t[3], t[4], t[5]);
  ctx.clip(traceShape(obj), ((obj as { fillRule?: CanvasFillRule }).fillRule ?? "nonzero") as CanvasFillRule);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(ctx.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.filter = "none";
  ctx.restore();
}

let installed = false;

/** Patches Fabric once: element caches get their filters, room for blurs, and background blur. */
export function installElementEffects() {
  if (installed) return;
  installed = true;
  const proto = fabric.FabricObject.prototype as unknown as {
    drawObject: (this: WithFx, ctx: CanvasRenderingContext2D, forClipping?: boolean, context?: unknown) => void;
    render: (this: WithFx, ctx: CanvasRenderingContext2D) => void;
    _getCacheCanvasDimensions: (this: WithFx) => { width: number; height: number; zoomX: number; zoomY: number; x: number; y: number };
  };

  const originalDraw = proto.drawObject;
  proto.drawObject = function (this: WithFx, ctx, forClipping, context) {
    originalDraw.call(this, ctx, forClipping, context);
    const filters = this._lumioFilters;
    if (!forClipping && filters?.length && ctx === this._cacheContext && this._cacheCanvas) {
      filterCanvasInPlace(this._cacheCanvas, filters);
    }
  };

  // Blurs spread past the edge: give the cache room on every side (the
  // element is drawn centred in it, so the extra space is shared evenly).
  const originalDims = proto._getCacheCanvasDimensions;
  proto._getCacheCanvasDimensions = function (this: WithFx) {
    const dims = originalDims.call(this);
    const pad = this._lumioPad ?? 0;
    if (pad > 0) {
      dims.width = Math.ceil(dims.width + pad * 2 * dims.zoomX);
      dims.height = Math.ceil(dims.height + pad * 2 * dims.zoomY);
    }
    return dims;
  };

  const originalRender = proto.render;
  proto.render = function (this: WithFx, ctx) {
    if (this.lumioBackdrop && this.visible !== false) drawBackdrop(this, ctx);
    originalRender.call(this, ctx);
  };
}

/** Sets (or clears) an element's filter chain and asks for a redraw. */
export function setElementFilters(obj: fabric.FabricObject, filters: fabric.filters.BaseFilter<string>[], spread = 0) {
  const fx = obj as WithFx;
  fx._lumioFilters = filters.length ? filters : undefined;
  fx._lumioPad = spread > 0 ? spread * Math.max(obj.width ?? 0, obj.height ?? 0) * 1.3 : 0;
  // Effects live on the cache, so the element must be cached.
  obj.set({ objectCaching: true, dirty: true });
}

/** Sets an element's background blur (page pixels; 0 = off). */
export function setBackdropBlur(obj: fabric.FabricObject, amount: number) {
  (obj as WithFx).lumioBackdrop = amount > 0 ? amount : undefined;
}

export const backdropBlurOf = (obj: fabric.FabricObject) => (obj as WithFx).lumioBackdrop ?? 0;

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
