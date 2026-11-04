import * as fabric from "fabric";

export interface GradientSpec {
  from: string;
  to: string;
  /** CSS angle: 0 = bottom to top, 90 = left to right, 180 = top to bottom. */
  angle: number;
  /** 0–1, defaults to 1. Lets one end fade out. */
  fromOpacity?: number;
  toOpacity?: number;
}

/** A linear Fabric gradient covering a width x height frame at a CSS angle. */
export function buildGradient(spec: GradientSpec, width: number, height: number): fabric.Gradient<"linear"> {
  return makeGradient(spec, width, height, "pixels");
}

/** A gradient that stretches with the object it fills (text, shapes). */
export function buildObjectGradient(spec: GradientSpec): fabric.Gradient<"linear"> {
  return makeGradient(spec, 1, 1, "percentage");
}

function makeGradient(spec: GradientSpec, width: number, height: number, units: "pixels" | "percentage"): fabric.Gradient<"linear"> {
  const rad = (spec.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // CSS gradient line length: the corners of the frame touch 0% and 100%.
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return new fabric.Gradient({
    type: "linear",
    gradientUnits: units,
    coords: { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half },
    colorStops: [
      { offset: 0, color: spec.from, opacity: spec.fromOpacity ?? 1 },
      { offset: 1, color: spec.to, opacity: spec.toOpacity ?? 1 },
    ],
  });
}

/** "#rrggbb" + opacity → "#rrggbbaa" (or "#rrggbb" when opaque). */
function withAlpha(hex: string, opacity = 1): string {
  if (opacity >= 1) return hex;
  const a = Math.round(Math.max(0, opacity) * 255).toString(16).padStart(2, "0");
  return `${hex.slice(0, 7)}${a}`;
}

/** Parses "linear-gradient(135deg, #aaa 0%, #bbb 100%)"; stops may be #rrggbb or #rrggbbaa. */
export function parseGradientCss(css: string): GradientSpec | null {
  const angle = css.match(/(-?\d+(?:\.\d+)?)deg/);
  const colors = css.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?/gi);
  if (!colors || colors.length < 2) return null;
  const split = (c: string) => ({ hex: c.slice(0, 7), opacity: c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1 });
  const from = split(colors[0]);
  const to = split(colors[colors.length - 1]);
  return {
    from: from.hex,
    to: to.hex,
    fromOpacity: from.opacity,
    toOpacity: to.opacity,
    angle: angle ? parseFloat(angle[1]) : 180,
  };
}

/** Normalises any stop colour (hex, rgb, rgba) to "#rrggbb" plus its own alpha. */
function readStop(stop: { color: string; opacity?: number }) {
  const color = new fabric.Color(stop.color);
  return { hex: `#${color.toHex().toLowerCase()}`, opacity: (stop.opacity ?? 1) * color.getAlpha() };
}

export function gradientToSpec(value: unknown): GradientSpec | null {
  if (!(value instanceof fabric.Gradient)) return null;
  const { coords, colorStops } = value;
  if (colorStops.length < 2) return null;
  const angle = (Math.atan2((coords.x2 ?? 0) - (coords.x1 ?? 0), -((coords.y2 ?? 0) - (coords.y1 ?? 0))) * 180) / Math.PI;
  const from = readStop(colorStops[0]);
  const to = readStop(colorStops[colorStops.length - 1]);
  return {
    from: from.hex,
    to: to.hex,
    fromOpacity: from.opacity,
    toOpacity: to.opacity,
    angle: Math.round((angle + 360) % 360),
  };
}

export function specToCss(spec: GradientSpec): string {
  return `linear-gradient(${spec.angle}deg, ${withAlpha(spec.from, spec.fromOpacity)} 0%, ${withAlpha(spec.to, spec.toOpacity)} 100%)`;
}

export const GRADIENT_PRESETS: GradientSpec[] = [
  { from: "#667eea", to: "#764ba2", angle: 135 },
  { from: "#f093fb", to: "#f5576c", angle: 135 },
  { from: "#4facfe", to: "#00f2fe", angle: 135 },
  { from: "#43e97b", to: "#38f9d7", angle: 135 },
  { from: "#fa709a", to: "#fee140", angle: 135 },
  { from: "#f6d365", to: "#fda085", angle: 90 },
  { from: "#ff0844", to: "#ffb199", angle: 180 },
  { from: "#ffffff", to: "#ffffff", angle: 180, toOpacity: 0 },
];
