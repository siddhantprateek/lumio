import * as fabric from "fabric";

/*
 * Canva-style rotation for every element:
 *  - a round rotate handle just below the element (Fabric's default sits
 *    above it, under the floating quick-actions bar);
 *  - invisible rotate zones just outside each corner: hover there and the
 *    cursor turns into a rotate arrow, drag to turn;
 *  - snapping to every 45° when within a few degrees.
 */

const ACCENT = "#6366f1";

/** A curved double-arrow cursor, centred on its hotspot. */
const ROTATE_CURSOR = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 14.5a7 7 0 0 0 12.6 1.6M18.5 9.5A7 7 0 0 0 5.9 7.9" stroke="#fff" stroke-width="4"/><path d="M5.5 14.5a7 7 0 0 0 12.6 1.6M18.5 9.5A7 7 0 0 0 5.9 7.9" stroke="#111" stroke-width="1.8"/><path d="M14.5 16.5l3.8-.4.4 3.8M9.5 7.5l-3.8.4-.4-3.8" stroke="#fff" stroke-width="4"/><path d="M14.5 16.5l3.8-.4.4 3.8M9.5 7.5l-3.8.4-.4-3.8" stroke="#111" stroke-width="1.8"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
})();

/** White disc with a small circular-arrow glyph, like Canva's handle. */
function renderRotateHandle(ctx: CanvasRenderingContext2D, left: number, top: number) {
  ctx.save();
  ctx.translate(left, top);
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // Glyph: an open circle with an arrowhead.
  ctx.beginPath();
  ctx.arc(0, 0, 5, -Math.PI * 0.15, Math.PI * 1.45);
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.stroke();
  const ax = Math.cos(-Math.PI * 0.15) * 5, ay = Math.sin(-Math.PI * 0.15) * 5;
  ctx.beginPath();
  ctx.moveTo(ax - 3, ay - 1.5);
  ctx.lineTo(ax + 0.5, ay + 0.5);
  ctx.lineTo(ax + 1.5, ay - 3.2);
  ctx.stroke();
  ctx.restore();
}

/** Adds the rotate handle, corner rotate zones and 45° snapping to an element. */
export function installRotateControls(obj: fabric.FabricObject) {
  const rotate = fabric.controlsUtils.rotationWithSnapping;
  const controls = { ...obj.controls };
  controls.mtr = new fabric.Control({
    x: 0,
    y: 0.5,
    offsetY: 30,
    sizeX: 26,
    sizeY: 26,
    actionName: "rotate",
    actionHandler: rotate,
    cursorStyle: ROTATE_CURSOR,
    withConnection: false,
    render: renderRotateHandle,
  });
  // Just outside each corner: invisible, but a rotate cursor and a drag that turns.
  const corners: [string, number, number][] = [["rotTL", -0.5, -0.5], ["rotTR", 0.5, -0.5], ["rotBL", -0.5, 0.5], ["rotBR", 0.5, 0.5]];
  for (const [key, x, y] of corners) {
    controls[key] = new fabric.Control({
      x,
      y,
      offsetX: x * 30,
      offsetY: y * 30,
      sizeX: 22,
      sizeY: 22,
      actionName: "rotate",
      actionHandler: rotate,
      cursorStyle: ROTATE_CURSOR,
      render: () => {},
    });
  }
  obj.controls = controls;
  // Snap to 0°, 45°, 90°… when within 5°, as in Canva.
  obj.set({ snapAngle: 45, snapThreshold: 5, borderColor: ACCENT });
}
