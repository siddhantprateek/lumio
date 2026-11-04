/*
 * Hand-drawn style graphics, generated in code: brush strokes, scribbles,
 * sparkles, arrows, patterns. Each is SVG markup from a fixed seed, so the
 * preview tile and the element added to the page are identical, and once on
 * the page every one is an editable vector (colours, line weight, effects).
 */

export interface Doodle {
  id: string;
  label: string;
  group: "Brushes & marks" | "Scribbles & lines" | "Arrows" | "Sparkles & bursts" | "Doodles" | "Patterns";
  svg: string;
}

// ── Tiny toolkit ───────────────────────────────────────────────────────

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D noise in [-1, 1]. */
function noise1(seed: number) {
  const r = rng(seed);
  const pts = Array.from({ length: 64 }, () => r() * 2 - 1);
  return (x: number) => {
    const i = Math.floor(x), f = x - i;
    const a = pts[((i % 64) + 64) % 64], b = pts[(((i + 1) % 64) + 64) % 64];
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  };
}

type P = [number, number];
const f = (n: number) => Math.round(n * 10) / 10;

/** Smooth path through points (quadratic curves via midpoints). */
function smooth(pts: P[], closed = false) {
  if (pts.length < 2) return "";
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % pts.length], q = pts[(i + 1) % pts.length];
    if (!closed && i === pts.length - 1) {
      d += ` L${f(p[0])} ${f(p[1])}`;
    } else {
      d += ` Q${f(p[0])} ${f(p[1])} ${f((p[0] + q[0]) / 2)} ${f((p[1] + q[1]) / 2)}`;
    }
  }
  return closed ? d + " Z" : d;
}

/** Adds a hand-drawn wobble to a polyline. */
function wobble(pts: P[], amount: number, seed: number, steps = 6): P[] {
  const r = rng(seed);
  const out: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([x0 + (x1 - x0) * t + (r() - 0.5) * amount, y0 + (y1 - y0) * t + (r() - 0.5) * amount]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
const fillPath = (d: string, color: string, extra = "") => `<path d="${d}" fill="${color}"${extra}/>`;
const strokePath = (d: string, color: string, width: number) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

// ── Brushes & marks ────────────────────────────────────────────────────

function brushStroke(seed: number, w = 420, h = 80, rough = 0.28) {
  const top = noise1(seed), bot = noise1(seed + 9);
  const r = rng(seed + 3);
  const upper: P[] = [], lower: P[] = [];
  for (let x = 6; x <= w - 6; x += 8) {
    upper.push([x, h * 0.18 + top(x / 40) * h * rough + (r() - 0.5) * 4]);
    lower.push([x, h * 0.82 + bot(x / 40) * h * rough + (r() - 0.5) * 4]);
  }
  // Ragged ends, like bristles leaving the paper.
  const right: P[] = Array.from({ length: 5 }, (_, i) => [w - r() * 26, h * (0.2 + i * 0.15)]);
  const left: P[] = Array.from({ length: 5 }, (_, i) => [r() * 22, h * (0.8 - i * 0.15)]);
  const outline = smooth([...upper, ...right, ...lower.reverse(), ...left], true);
  // Dry-brush gaps: thin slivers cut out of the paint.
  let gaps = "";
  for (let i = 0; i < 4; i++) {
    const y = h * (0.3 + r() * 0.4), x0 = w * (0.25 + r() * 0.3), len = w * (0.15 + r() * 0.35);
    gaps += ` M${f(x0)} ${f(y)} Q${f(x0 + len / 2)} ${f(y - 2)} ${f(x0 + len)} ${f(y)} Q${f(x0 + len / 2)} ${f(y + 2.5)} ${f(x0)} ${f(y)} Z`;
  }
  return outline + gaps;
}

function highlighter(seed: number, w = 400, h = 60) {
  const n = noise1(seed);
  const upper: P[] = [], lower: P[] = [];
  for (let x = 14; x <= w - 14; x += 20) {
    upper.push([x, h * 0.1 + n(x / 60) * 4]);
    lower.push([x, h * 0.9 + n(x / 60 + 7) * 4]);
  }
  return smooth([[2, h / 2], ...upper, [w - 2, h / 2], ...lower.reverse()], true);
}

// ── Scribbles & lines ──────────────────────────────────────────────────

function scribbleCircle(seed: number, w = 320, h = 200, turns = 2.15) {
  const n = noise1(seed);
  const pts: P[] = [];
  const steps = Math.round(turns * 48);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * Math.PI * 2 - 0.6;
    const k = 1 + n(i / 9) * 0.06 + i / steps * 0.04;
    pts.push([w / 2 + Math.cos(t) * (w / 2 - 12) * k, h / 2 + Math.sin(t) * (h / 2 - 12) * k]);
  }
  return smooth(pts);
}

function wavyLine(seed: number, w = 420, h = 60, waves = 6) {
  const n = noise1(seed);
  const pts: P[] = [];
  for (let x = 6; x <= w - 6; x += 6) pts.push([x, h / 2 + Math.sin((x / w) * waves * Math.PI * 2) * (h * 0.3) * (1 + n(x / 30) * 0.25)]);
  return smooth(pts);
}

function zigzag(w = 420, h = 60, teeth = 10, seed = 3) {
  const pts: P[] = [];
  for (let i = 0; i <= teeth * 2; i++) pts.push([10 + (i / (teeth * 2)) * (w - 20), i % 2 ? 10 : h - 10]);
  return smooth(wobble(pts, 2, seed, 2));
}

function underlineDouble(seed: number, w = 420, h = 50) {
  const a = wobble([[8, h * 0.35], [w - 8, h * 0.3]], 3, seed, 10);
  const b = wobble([[30, h * 0.72], [w - 30, h * 0.68]], 3, seed + 1, 10);
  return smooth(a) + " " + smooth(b);
}

function loopLine(seed: number, w = 420, h = 160) {
  const pts: P[] = [];
  const n = noise1(seed);
  for (let i = 0; i <= 160; i++) {
    const t = i / 160;
    const x = 10 + t * (w - 20) + Math.cos(t * Math.PI * 8) * 22;
    const y = h / 2 + Math.sin(t * Math.PI * 8) * 34 + n(i / 12) * 6;
    pts.push([x, y]);
  }
  return smooth(pts);
}

// ── Arrows ─────────────────────────────────────────────────────────────

function head(tip: P, from: P, size = 22, spread = 0.5): string {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const a1: P = [tip[0] - Math.cos(ang - spread) * size, tip[1] - Math.sin(ang - spread) * size];
  const a2: P = [tip[0] - Math.cos(ang + spread) * size, tip[1] - Math.sin(ang + spread) * size];
  return ` M${f(a1[0])} ${f(a1[1])} L${f(tip[0])} ${f(tip[1])} L${f(a2[0])} ${f(a2[1])}`;
}

function curvyArrow(seed: number) {
  const pts = wobble([[20, 170], [80, 60], [170, 40], [260, 90]], 4, seed, 8);
  return smooth(pts) + head(pts[pts.length - 1], pts[pts.length - 4]);
}

function loopArrow(seed: number) {
  const pts: P[] = [];
  for (let i = 0; i <= 90; i++) {
    const t = i / 90;
    const x = 20 + t * 240 + Math.sin(t * Math.PI * 2) * 40;
    const y = 140 - t * 90 - Math.cos(t * Math.PI * 2) * 40 + 40;
    pts.push([x, y]);
  }
  const w = wobble(pts, 1.5, seed, 1);
  return smooth(w) + head(w[w.length - 1], w[w.length - 6]);
}

function spiralArrow(seed: number) {
  const pts: P[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * Math.PI * 3.2;
    const r = 12 + t * 13;
    pts.push([150 + Math.cos(t) * r, 120 + Math.sin(t) * r * 0.8]);
  }
  const w = wobble(pts, 1.5, seed, 1);
  return smooth(w) + head(w[w.length - 1], w[w.length - 6]);
}

function bentArrow(seed: number) {
  const pts = wobble([[30, 40], [40, 150], [250, 160]], 4, seed, 10);
  return smooth(pts) + head(pts[pts.length - 1], pts[pts.length - 5]);
}

// ── Sparkles & bursts ──────────────────────────────────────────────────

function sparkle(cx: number, cy: number, r: number, thin = 0.18) {
  const k = r * thin;
  return `M${f(cx)} ${f(cy - r)} Q${f(cx + k)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} Q${f(cx + k)} ${f(cy + k)} ${f(cx)} ${f(cy + r)} Q${f(cx - k)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} Q${f(cx - k)} ${f(cy - k)} ${f(cx)} ${f(cy - r)} Z`;
}

function starburst(seed: number, points = 22, inner = 0.62) {
  const r = rng(seed);
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = (i % 2 ? inner : 1) * 100 * (0.92 + r() * 0.16);
    pts.push(`${f(110 + Math.cos(a) * rad)} ${f(110 + Math.sin(a) * rad)}`);
  }
  return `M${pts.join(" L")} Z`;
}

function rays(seed: number, count = 14) {
  const r = rng(seed);
  let d = "";
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.15;
    const r0 = 52 + r() * 10, r1 = 92 + r() * 18;
    d += ` M${f(110 + Math.cos(a) * r0)} ${f(110 + Math.sin(a) * r0)} L${f(110 + Math.cos(a) * r1)} ${f(110 + Math.sin(a) * r1)}`;
  }
  return d.trim();
}

function confetti(seed: number) {
  const r = rng(seed);
  const colours = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#14b8a6"];
  let body = "";
  for (let i = 0; i < 34; i++) {
    const x = 10 + r() * 280, y = 10 + r() * 180, c = colours[i % colours.length], rot = Math.round(r() * 180);
    const kind = r();
    if (kind < 0.4) body += `<rect x="${f(x)}" y="${f(y)}" width="${f(6 + r() * 6)}" height="${f(14 + r() * 8)}" rx="2" fill="${c}" transform="rotate(${rot} ${f(x)} ${f(y)})"/>`;
    else if (kind < 0.7) body += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(3 + r() * 4)}" fill="${c}"/>`;
    else body += `<path d="M${f(x)} ${f(y)} q8 -10 16 0 t16 0" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" transform="rotate(${rot} ${f(x)} ${f(y)})"/>`;
  }
  return svg(300, 200, body);
}

// ── Doodles ────────────────────────────────────────────────────────────

function doodle(points: P[], seed: number, closed = false) {
  return smooth(wobble(closed ? [...points, points[0]] : points, 5, seed, 5), false);
}

/** The classic heart curve, sampled with a light hand-drawn wobble, slightly overshooting where it closes. */
function heartDoodle(seed: number) {
  const r = rng(seed);
  const pts: P[] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2.08;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([110 + x * 5.6 + (r() - 0.5) * 2.5, 92 - y * 5.6 + (r() - 0.5) * 2.5]);
  }
  return smooth(pts);
}

function blob(seed: number, n = 9) {
  const r = rng(seed);
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 70 + r() * 35;
    pts.push([110 + Math.cos(a) * rad, 110 + Math.sin(a) * rad]);
  }
  return smooth(pts, true);
}

// ── Patterns ───────────────────────────────────────────────────────────

function halftoneDots(w = 300, h = 200, step = 14) {
  let d = "";
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      const rad = (1 - x / w) * step * 0.48;
      if (rad < 0.6) continue;
      d += `M${f(x - rad)} ${f(y)}a${f(rad)} ${f(rad)} 0 1 0 ${f(rad * 2)} 0a${f(rad)} ${f(rad)} 0 1 0 ${f(-rad * 2)} 0Z`;
    }
  }
  return d;
}

function dotGrid(w = 300, h = 200, step = 20, rad = 2.4) {
  let d = "";
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) d += `M${f(x - rad)} ${f(y)}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0Z`;
  return d;
}

function gridLines(w = 300, h = 200, step = 25) {
  let d = "";
  for (let x = 0; x <= w; x += step) d += ` M${x} 0 V${h}`;
  for (let y = 0; y <= h; y += step) d += ` M0 ${y} H${w}`;
  return d.trim();
}

function waveDivider(w = 420, h = 90) {
  return `M0 ${h * 0.45} C${w * 0.15} ${h * 0.1} ${w * 0.35} ${h * 0.1} ${w * 0.5} ${h * 0.45} S${w * 0.85} ${h * 0.8} ${w} ${h * 0.45} V${h} H0 Z`;
}

// ── Catalogue ──────────────────────────────────────────────────────────

const INK = "#111111";

export const DOODLES: Doodle[] = [
  { id: "brush-yellow", label: "Brush stroke", group: "Brushes & marks", svg: svg(420, 80, fillPath(brushStroke(11), "#fde68a", ' fill-rule="evenodd"')) },
  { id: "brush-pink", label: "Brush stroke", group: "Brushes & marks", svg: svg(420, 80, fillPath(brushStroke(27, 420, 80, 0.36), "#f9a8d4", ' fill-rule="evenodd"')) },
  { id: "brush-lilac", label: "Brush stroke", group: "Brushes & marks", svg: svg(420, 70, fillPath(brushStroke(53, 420, 70, 0.22), "#c4b5fd", ' fill-rule="evenodd"')) },
  { id: "brush-dark", label: "Dry brush", group: "Brushes & marks", svg: svg(420, 90, fillPath(brushStroke(71, 420, 90, 0.4), INK, ' fill-rule="evenodd"')) },
  { id: "highlighter", label: "Highlighter", group: "Brushes & marks", svg: svg(400, 60, fillPath(highlighter(5), "#fef08a")) },
  { id: "highlighter-green", label: "Highlighter", group: "Brushes & marks", svg: svg(400, 60, fillPath(highlighter(17), "#bbf7d0")) },

  { id: "scribble-circle", label: "Scribble circle", group: "Scribbles & lines", svg: svg(320, 200, strokePath(scribbleCircle(4), INK, 4)) },
  { id: "scribble-circle-red", label: "Scribble circle", group: "Scribbles & lines", svg: svg(320, 200, strokePath(scribbleCircle(19, 320, 200, 1.6), "#ef4444", 5)) },
  { id: "wavy", label: "Wavy line", group: "Scribbles & lines", svg: svg(420, 60, strokePath(wavyLine(2), INK, 5)) },
  { id: "zigzag", label: "Zigzag", group: "Scribbles & lines", svg: svg(420, 60, strokePath(zigzag(), INK, 5)) },
  { id: "underline", label: "Double underline", group: "Scribbles & lines", svg: svg(420, 50, strokePath(underlineDouble(8), INK, 5)) },
  { id: "loops", label: "Loops", group: "Scribbles & lines", svg: svg(420, 160, strokePath(loopLine(6), INK, 4)) },

  { id: "curvy-arrow", label: "Curvy arrow", group: "Arrows", svg: svg(280, 200, strokePath(curvyArrow(3), INK, 5)) },
  { id: "loop-arrow", label: "Loop arrow", group: "Arrows", svg: svg(300, 200, strokePath(loopArrow(5), INK, 5)) },
  { id: "spiral-arrow", label: "Spiral arrow", group: "Arrows", svg: svg(300, 240, strokePath(spiralArrow(9), INK, 4)) },
  { id: "bent-arrow", label: "Bent arrow", group: "Arrows", svg: svg(280, 200, strokePath(bentArrow(12), INK, 5)) },

  { id: "sparkle", label: "Sparkle", group: "Sparkles & bursts", svg: svg(200, 200, fillPath(sparkle(100, 100, 90), INK)) },
  { id: "sparkles", label: "Sparkles", group: "Sparkles & bursts", svg: svg(220, 200, fillPath(sparkle(80, 110, 70) + sparkle(170, 50, 36) + sparkle(178, 160, 22), "#facc15")) },
  { id: "sparkles-outline", label: "Sparkle outline", group: "Sparkles & bursts", svg: svg(220, 200, strokePath(sparkle(90, 105, 70, 0.16) + sparkle(175, 45, 30, 0.16), INK, 4)) },
  { id: "starburst", label: "Starburst", group: "Sparkles & bursts", svg: svg(220, 220, fillPath(starburst(6), "#f97316")) },
  { id: "starburst-outline", label: "Burst outline", group: "Sparkles & bursts", svg: svg(220, 220, strokePath(starburst(14, 14, 0.5), INK, 4)) },
  { id: "rays", label: "Rays", group: "Sparkles & bursts", svg: svg(220, 220, strokePath(rays(3), INK, 6)) },
  { id: "confetti", label: "Confetti", group: "Sparkles & bursts", svg: confetti(42) },

  { id: "doodle-heart", label: "Heart doodle", group: "Doodles", svg: svg(220, 200, strokePath(heartDoodle(7), "#ef4444", 5)) },
  { id: "doodle-crown", label: "Crown doodle", group: "Doodles", svg: svg(240, 170, strokePath(doodle([[30, 150], [20, 40], [75, 95], [120, 25], [165, 95], [220, 40], [210, 150], [30, 150]], 9), INK, 5)) },
  { id: "doodle-bolt", label: "Lightning doodle", group: "Doodles", svg: svg(160, 240, strokePath(doodle([[100, 10], [30, 130], [80, 130], [55, 230], [135, 95], [85, 95], [100, 10]], 4), INK, 5)) },
  { id: "doodle-check", label: "Check mark", group: "Doodles", svg: svg(220, 180, strokePath(doodle([[20, 100], [80, 160], [200, 20]], 2), "#16a34a", 10)) },
  { id: "doodle-cross", label: "Cross mark", group: "Doodles", svg: svg(200, 200, strokePath(doodle([[30, 30], [170, 170]], 3) + " " + doodle([[170, 30], [30, 170]], 8), "#ef4444", 10)) },
  { id: "doodle-star", label: "Star doodle", group: "Doodles", svg: svg(220, 220, strokePath(doodle([[110, 15], [140, 85], [210, 90], [155, 135], [175, 205], [110, 165], [45, 205], [65, 135], [10, 90], [80, 85], [110, 15]], 13), INK, 5)) },
  { id: "blob", label: "Blob", group: "Doodles", svg: svg(220, 220, fillPath(blob(21), "#a5b4fc")) },
  { id: "blob-2", label: "Blob", group: "Doodles", svg: svg(220, 220, fillPath(blob(37, 7), "#fda4af")) },

  { id: "halftone", label: "Halftone fade", group: "Patterns", svg: svg(300, 200, fillPath(halftoneDots(), INK)) },
  { id: "dot-grid", label: "Dot grid", group: "Patterns", svg: svg(300, 200, fillPath(dotGrid(), INK)) },
  { id: "grid", label: "Grid", group: "Patterns", svg: svg(300, 200, strokePath(gridLines(), INK, 1.5)) },
  { id: "wave", label: "Wave divider", group: "Patterns", svg: svg(420, 90, fillPath(waveDivider(), "#6366f1")) },
];

export const DOODLE_GROUPS = [...new Set(DOODLES.map((d) => d.group))];
