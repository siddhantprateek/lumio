import * as fabric from "fabric";

/*
 * Regular polygons and stars with an editable number of sides.
 *
 * A polygon element remembers how it was made (`lumioSides`, `lumioStar`,
 * `lumioRound`), so changing the sides later rebuilds its points while it
 * keeps its size, position, scale and styling.
 */

export interface PolygonSpec {
  sides: number;      // 3..20 (points, for a star)
  star: number;       // 0 = plain polygon; otherwise inner radius as 10..90 (% of outer)
  round: number;      // corner rounding 0..100
}

type Shaped = fabric.Polygon & { lumioSides?: number; lumioStar?: number; lumioRound?: number; lumioRadius?: number };

export const isEditablePolygon = (obj: unknown): obj is Shaped =>
  obj instanceof fabric.Polygon && typeof (obj as Shaped).lumioSides === "number";

export const polygonSpecOf = (obj: Shaped): PolygonSpec => ({
  sides: obj.lumioSides ?? 6,
  star: obj.lumioStar ?? 0,
  round: obj.lumioRound ?? 0,
});

/** Vertices around a circle of `radius`, pointing up. Stars alternate outer and inner radius. */
function vertices(spec: PolygonSpec, radius: number) {
  const n = Math.max(3, Math.min(20, Math.round(spec.sides)));
  const count = spec.star ? n * 2 : n;
  const inner = radius * (spec.star / 100);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const r = spec.star && i % 2 === 1 ? inner : radius;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/**
 * Rounds corners by cutting each one with a quadratic curve, flattened into
 * extra points (Fabric polygons are straight segments).
 */
function rounded(pts: { x: number; y: number }[], amount: number) {
  if (amount <= 0) return pts;
  const out: { x: number; y: number }[] = [];
  const t = Math.min(0.5, (amount / 100) * 0.5);
  const steps = 6;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    const a = { x: cur.x + (prev.x - cur.x) * t, y: cur.y + (prev.y - cur.y) * t };
    const b = { x: cur.x + (next.x - cur.x) * t, y: cur.y + (next.y - cur.y) * t };
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      // Quadratic Bézier a → cur → b
      out.push({
        x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cur.x + u * u * b.x,
        y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cur.y + u * u * b.y,
      });
    }
  }
  return out;
}

export function polygonPoints(spec: PolygonSpec, radius: number) {
  return rounded(vertices(spec, radius), spec.round);
}

export function makePolygon(spec: PolygonSpec, center: { x: number; y: number }, radius: number, style: Partial<fabric.Polygon>) {
  const poly = new fabric.Polygon(polygonPoints(spec, radius), { ...style }) as Shaped;
  poly.lumioSides = spec.sides;
  poly.lumioStar = spec.star;
  poly.lumioRound = spec.round;
  poly.lumioRadius = radius;
  poly.setPositionByOrigin(new fabric.Point(center.x, center.y), "center", "center");
  poly.setCoords();
  return poly;
}

/** Rebuilds an editable polygon's points in place, keeping its centre and size. */
export function reshapePolygon(poly: fabric.Polygon, spec: PolygonSpec) {
  const shaped = poly as Shaped;
  const center = poly.getCenterPoint();
  // The radius it was built with (stored, so odd-sided shapes never drift in size).
  const radius = shaped.lumioRadius ?? Math.max(poly.width ?? 100, poly.height ?? 100) / 2;
  shaped.lumioSides = spec.sides;
  shaped.lumioStar = spec.star;
  shaped.lumioRound = spec.round;
  poly.set({ points: polygonPoints(spec, radius) });
  poly.setDimensions();
  poly.setPositionByOrigin(center, "center", "center");
  poly.set({ dirty: true });
  poly.setCoords();
}
