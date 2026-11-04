import * as fabric from "fabric";

/*
 * Extra shapes as SVG paths drawn in a 100 × 100 box. Filled shapes take a
 * fill colour like any rectangle; "line" shapes are drawn with a stroke only
 * (arrows made of lines). All of them can use gradients, borders, filters and
 * effects like other shapes.
 */

export interface ShapeDef {
  id: string;
  label: string;
  d: string;
  /** Outline-only shape (stroke, no fill). */
  line?: boolean;
  evenOdd?: boolean;
  group: "Arrows" | "Basic" | "Symbols";
}

export const SHAPES: ShapeDef[] = [
  // Arrows
  { id: "arrow", label: "Arrow", group: "Arrows", d: "M0 35 H58 V12 L100 50 L58 88 V65 H0 Z" },
  { id: "double-arrow", label: "Double arrow", group: "Arrows", d: "M0 50 L30 14 V35 H70 V14 L100 50 L70 86 V65 H30 V86 Z" },
  { id: "curved-arrow", label: "Curved arrow", group: "Arrows", d: "M8 92 C8 42 36 20 68 20 V4 L100 30 L68 56 V40 C46 40 30 58 30 92 Z" },
  { id: "u-turn", label: "U-turn arrow", group: "Arrows", d: "M18 100 V46 C18 10 82 10 82 46 V56 H98 L70 88 L42 56 H58 V46 C58 32 42 32 42 46 V100 Z" },
  { id: "chevron", label: "Chevron", group: "Arrows", d: "M0 0 H58 L100 50 L58 100 H0 L42 50 Z" },
  { id: "line-arrow", label: "Line arrow", group: "Arrows", line: true, d: "M2 50 H96 M78 32 L97 50 L78 68" },
  { id: "curved-line-arrow", label: "Curved line arrow", group: "Arrows", line: true, d: "M6 86 Q40 6 90 52 M74 50 L91 54 L90 36" },
  { id: "loop-arrow", label: "Loop arrow", group: "Arrows", line: true, d: "M4 70 C30 70 40 20 62 20 C80 20 80 50 62 50 C44 50 52 82 96 82 M84 72 L97 82 L84 92" },
  // Basic
  { id: "heart", label: "Heart", group: "Basic", d: "M50 92 C20 70 0 52 0 30 C0 13 13 2 28 2 C38 2 46 8 50 16 C54 8 62 2 72 2 C87 2 100 13 100 30 C100 52 80 70 50 92 Z" },
  { id: "speech", label: "Speech bubble", group: "Basic", d: "M12 6 H88 Q100 6 100 18 V60 Q100 72 88 72 H42 L20 94 L25 72 H12 Q0 72 0 60 V18 Q0 6 12 6 Z" },
  { id: "cloud", label: "Cloud", group: "Basic", d: "M25 85 C10 85 0 75 0 62 C0 50 9 41 21 40 C22 25 34 14 50 14 C63 14 74 22 78 34 C91 35 100 46 100 59 C100 73 89 85 75 85 Z" },
  { id: "ring", label: "Ring", group: "Basic", evenOdd: true, d: "M50 0 A50 50 0 1 0 50 100 A50 50 0 1 0 50 0 Z M50 26 A24 24 0 1 1 50 74 A24 24 0 1 1 50 26 Z" },
  { id: "shield", label: "Shield", group: "Basic", d: "M50 0 L95 15 V45 C95 72 75 90 50 100 C25 90 5 72 5 45 V15 Z" },
  // Symbols
  { id: "plus", label: "Plus", group: "Symbols", d: "M35 0 H65 V35 H100 V65 H65 V100 H35 V65 H0 V35 H35 Z" },
  { id: "cross", label: "Cross", group: "Symbols", d: "M15 0 L50 35 L85 0 L100 15 L65 50 L100 85 L85 100 L50 65 L15 100 L0 85 L35 50 L0 15 Z" },
  { id: "lightning", label: "Lightning", group: "Symbols", d: "M60 0 L10 58 H45 L35 100 L90 38 H55 Z" },
];

export const findShape = (id: string) => SHAPES.find((s) => s.id === id);

/** A path shape sized `size` on the page, centred on `center`. */
export function makeShape(def: ShapeDef, center: { x: number; y: number }, size: number, fill: string) {
  const style: Partial<fabric.Path> = def.line
    ? { fill: "", stroke: fill, strokeWidth: 6, strokeLineCap: "round", strokeLineJoin: "round", strokeUniform: true }
    : { fill, fillRule: def.evenOdd ? "evenodd" : "nonzero", strokeUniform: true };
  const path = new fabric.Path(def.d, style);
  const k = size / Math.max(path.width || 100, path.height || 100);
  path.set({ scaleX: k, scaleY: k });
  path.setPositionByOrigin(new fabric.Point(center.x, center.y), "center", "center");
  path.setCoords();
  return path;
}
