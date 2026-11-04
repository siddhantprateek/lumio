import * as fabric from "fabric";

export interface GradientSpec {
  from: string;
  to: string;
  /** CSS angle: 0 = bottom to top, 90 = left to right, 180 = top to bottom. */
  angle: number;
}

/** A linear Fabric gradient covering a width x height frame at a CSS angle. */
export function buildGradient(spec: GradientSpec, width: number, height: number): fabric.Gradient<"linear"> {
  const rad = (spec.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // CSS gradient line length: the corners of the frame touch 0% and 100%.
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return new fabric.Gradient({
    type: "linear",
    gradientUnits: "pixels",
    coords: { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half },
    colorStops: [
      { offset: 0, color: spec.from },
      { offset: 1, color: spec.to },
    ],
  });
}

/** Parses "linear-gradient(135deg, #aaa 0%, #bbb 100%)" (two hex stops). */
export function parseGradientCss(css: string): GradientSpec | null {
  const angle = css.match(/(-?\d+(?:\.\d+)?)deg/);
  const colors = css.match(/#[0-9a-f]{6}/gi);
  if (!colors || colors.length < 2) return null;
  return { from: colors[0], to: colors[colors.length - 1], angle: angle ? parseFloat(angle[1]) : 180 };
}

export function gradientToSpec(value: unknown): GradientSpec | null {
  if (!(value instanceof fabric.Gradient)) return null;
  const { coords, colorStops } = value;
  if (colorStops.length < 2) return null;
  const angle = (Math.atan2((coords.x2 ?? 0) - (coords.x1 ?? 0), -((coords.y2 ?? 0) - (coords.y1 ?? 0))) * 180) / Math.PI;
  return {
    from: colorStops[0].color,
    to: colorStops[colorStops.length - 1].color,
    angle: Math.round((angle + 360) % 360),
  };
}

export function specToCss(spec: GradientSpec): string {
  return `linear-gradient(${spec.angle}deg, ${spec.from} 0%, ${spec.to} 100%)`;
}
