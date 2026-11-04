import * as fabric from "fabric";

/*
 * SVG graphics as editable vectors (not flat pictures): doodles, icons and
 * uploaded .svg files are parsed into Fabric shapes, so their colours, line
 * weight, size and effects can all be changed.
 */

/** Parses SVG markup into one object: a single shape, or a group of them. */
export async function svgToObject(svg: string): Promise<fabric.FabricObject | null> {
  const { objects, options } = await fabric.loadSVGFromString(svg);
  const shapes = objects.filter((o): o is fabric.FabricObject => !!o);
  if (shapes.length === 0) return null;
  const obj = shapes.length === 1 ? shapes[0] : fabric.util.groupSVGElements(shapes, options);
  obj.set({ objectCaching: true });
  return obj;
}

/** Adds an SVG to the page as an editable vector, `size` page pixels on its longer side. */
export async function placeSvg(
  canvas: fabric.Canvas,
  svg: string,
  page: { width: number; height: number },
  opts: { size?: number; at?: { x: number; y: number } } = {},
) {
  const obj = await svgToObject(svg);
  if (!obj) throw new Error("That SVG has nothing to draw.");
  const size = opts.size ?? Math.min(page.width, page.height) * 0.35;
  const k = size / Math.max(obj.width || 1, obj.height || 1);
  obj.set({ scaleX: k, scaleY: k });
  const at = opts.at ?? { x: page.width / 2, y: page.height / 2 };
  obj.setPositionByOrigin(new fabric.Point(at.x, at.y), "center", "center");
  obj.setCoords();
  canvas.add(obj);
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
  return obj;
}

// ── Colour editing for vector graphics ─────────────────────────────────

const isPaint = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v !== "none" && v !== "transparent" && !/^rgba\([^)]*,\s*0\)$/.test(v);

/** Every leaf shape of a vector graphic (groups flattened). */
export function leafShapes(obj: fabric.FabricObject): fabric.FabricObject[] {
  if (obj instanceof fabric.Group && !(obj instanceof fabric.ActiveSelection)) {
    return obj.getObjects().flatMap(leafShapes);
  }
  return [obj];
}

/** True for vector graphics with their own colours worth listing (groups, or stroke-only paths). */
export function isVectorGraphic(obj: fabric.FabricObject | null | undefined): boolean {
  if (!obj) return false;
  if (obj instanceof fabric.Group && !(obj instanceof fabric.ActiveSelection)) return true;
  return obj instanceof fabric.Path && !isPaint(obj.fill) && isPaint(obj.stroke);
}

const normal = (c: string) => {
  try {
    return `#${new fabric.Color(c).toHex().toLowerCase()}`;
  } catch {
    return c.toLowerCase();
  }
};

/** The distinct solid colours used by a graphic's fills and strokes (most used first). */
export function graphicColours(obj: fabric.FabricObject): string[] {
  const counts = new Map<string, number>();
  for (const s of leafShapes(obj)) {
    for (const v of [s.fill, s.stroke]) {
      if (isPaint(v)) counts.set(normal(v), (counts.get(normal(v)) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Recolours every fill and stroke that uses `from`. */
export function replaceColour(obj: fabric.FabricObject, from: string, to: string) {
  for (const s of leafShapes(obj)) {
    if (isPaint(s.fill) && normal(s.fill) === from) s.set({ fill: to });
    if (isPaint(s.stroke) && normal(s.stroke) === from) s.set({ stroke: to });
  }
  obj.set({ dirty: true });
}

/** The line weight of a graphic's strokes (the thickest one), in its own units. */
export function graphicStrokeWidth(obj: fabric.FabricObject): number {
  return Math.max(0, ...leafShapes(obj).filter((s) => isPaint(s.stroke)).map((s) => s.strokeWidth ?? 0));
}

export const hasStrokes = (obj: fabric.FabricObject) => leafShapes(obj).some((s) => isPaint(s.stroke));

/** Sets every stroke in the graphic to `width`. */
export function setGraphicStrokeWidth(obj: fabric.FabricObject, width: number) {
  for (const s of leafShapes(obj)) if (isPaint(s.stroke)) s.set({ strokeWidth: width });
  obj.set({ dirty: true });
}
