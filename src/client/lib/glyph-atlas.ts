/*
 * Glyph atlas for the text-based Magic Effects (ASCII, Matrix, Braille…).
 *
 * One canvas holds every character set as a row of GLYPHS cells, white on
 * black, plus one last row for the user's own characters. Each set is sorted
 * by how much ink its characters use, so the shader can pick a glyph straight
 * from brightness: slot 0 is the emptiest, slot 15 the fullest. Sets with more
 * than 16 characters are sampled evenly; shorter ones repeat characters.
 */

export const GLYPHS = 16;
export const CELL_W = 48;
export const CELL_H = 64;

/** Row order matters: saved designs refer to sets by index. Only append. */
export const RAMPS: { name: string; chars: string; sort?: boolean; /** Draw the glyphs bigger (small-dot sets). */ scale?: number }[] = [
  { name: "Standard", chars: " .:-=+*#%@" },
  { name: "Dense", chars: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
  { name: "Shades", chars: " ░▒▓█", sort: false },
  { name: "Binary", chars: " 01" },
  { name: "Katakana", chars: " ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ" },
  { name: "Braille", chars: " ⠁⠃⠇⠏⠟⠿⡿⣿", sort: false, scale: 1.6 },
  { name: "Digits", chars: " 0123456789" },
  { name: "Symbols", chars: " ·•○◎●□■◇◆△▲" },
  { name: "Blocks", chars: " ▖▗▘▝▚▞▄▀▌▐▙▛▜▟█" },
  { name: "Mixed", chars: " .,:;ilI1tfjLCJUYXZO0Qmwqpbdkh#MW8%B@░▒▓█" },
  { name: "Cross", chars: " ·+x×✚✖#" },
  { name: "Diagonal", chars: " ˎ/\\╱╲╳" },
  { name: "Lines", chars: " .:|¦│┃▌█" },
  { name: "Diamond", chars: " ·⋄◇◈◆" },
  { name: "Classic", chars: " @#S08Xx+=-;:." },
];

/** Index of the row that holds the user's own characters. */
export const CUSTOM_ROW = RAMPS.length;
export const ROWS = RAMPS.length + 1;

const FAMILY = `ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono", "Segoe UI Symbol", "MS Gothic", monospace`;
const fontAt = (scale = 1) => `bold ${Math.round(CELL_H * 0.78 * scale)}px ${FAMILY}`;
const FONT = fontAt();

function coverage(ctx: CanvasRenderingContext2D, ch: string): number {
  ctx.clearRect(0, 0, CELL_W, CELL_H);
  ctx.fillText(ch, CELL_W / 2, CELL_H / 2);
  const d = ctx.getImageData(0, 0, CELL_W, CELL_H).data;
  let sum = 0;
  for (let i = 3; i < d.length; i += 4) sum += d[i];
  return sum;
}

let probe: CanvasRenderingContext2D | null = null;
function probeCtx() {
  if (probe) return probe;
  const c = document.createElement("canvas");
  c.width = CELL_W;
  c.height = CELL_H;
  probe = c.getContext("2d", { willReadFrequently: true })!;
  probe.font = FONT;
  probe.textAlign = "center";
  probe.textBaseline = "middle";
  probe.fillStyle = "#fff";
  return probe;
}

function drawRow(ctx: CanvasRenderingContext2D, row: number, text: string, sort = true, scale = 1) {
  let chars = [...text];
  if (!chars.length) return;
  ctx.font = fontAt(scale);
  if (sort) {
    const p = probeCtx();
    const score = new Map(chars.map((ch) => [ch, coverage(p, ch)]));
    chars = [...new Set(chars)].sort((a, b) => score.get(a)! - score.get(b)!);
    // A set without a blank still needs an empty slot 0 for black areas.
    if (score.get(chars[0])! > 0) chars.unshift(" ");
  }
  for (let i = 0; i < GLYPHS; i++) {
    const ch = chars[Math.min(chars.length - 1, Math.floor((i / (GLYPHS - 1)) * (chars.length - 1) + 0.5))];
    ctx.save();
    ctx.beginPath();
    ctx.rect(i * CELL_W, row * CELL_H, CELL_W, CELL_H);
    ctx.clip();
    ctx.fillText(ch, i * CELL_W + CELL_W / 2, row * CELL_H + CELL_H / 2);
    ctx.restore();
  }
}

let base: HTMLCanvasElement | null = null;
const withCustom = new Map<string, { key: string; canvas: HTMLCanvasElement }>();

function baseAtlas() {
  if (base) return base;
  const canvas = document.createElement("canvas");
  canvas.width = CELL_W * GLYPHS;
  canvas.height = CELL_H * ROWS;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  RAMPS.forEach((ramp, row) => drawRow(ctx, row, ramp.chars, ramp.sort !== false, ramp.scale));
  base = canvas;
  return canvas;
}

/** The atlas, with `custom` drawn into the last row. Cached per character string. */
export function glyphAtlas(custom = ""): { key: string; canvas: HTMLCanvasElement } {
  const hit = withCustom.get(custom);
  if (hit) return hit;
  let canvas = baseAtlas();
  if (custom) {
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    drawRow(ctx, CUSTOM_ROW, custom);
    canvas = copy;
  }
  const entry = { key: `lumio-glyph-atlas-v2:${custom}`, canvas };
  if (withCustom.size > 24) withCustom.clear();
  withCustom.set(custom, entry);
  return entry;
}
