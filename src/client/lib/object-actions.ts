import * as fabric from "fabric";

// One clipboard for the whole editor, so objects copy across pages.
let clipboard: fabric.FabricObject | null = null;
let styleClipboard: Record<string, unknown> | null = null;

export const hasClipboard = () => clipboard !== null;
export const hasStyleClipboard = () => styleClipboard !== null;

export async function copyObject(obj: fabric.FabricObject) {
  clipboard = await obj.clone();
}

/** Adds a copy of the clipboard, nudged so it does not hide the original. */
export async function pasteObject(canvas: fabric.Canvas): Promise<fabric.FabricObject | null> {
  if (!clipboard) return null;
  const copy = await clipboard.clone();
  copy.set({ left: (copy.left ?? 0) + 20, top: (copy.top ?? 0) + 20 });
  clipboard.set({ left: (clipboard.left ?? 0) + 20, top: (clipboard.top ?? 0) + 20 });
  canvas.add(copy);
  canvas.setActiveObject(copy);
  canvas.requestRenderAll();
  return copy;
}

export async function duplicateObject(canvas: fabric.Canvas, obj: fabric.FabricObject) {
  const copy = await obj.clone();
  copy.set({ left: (obj.left ?? 0) + 20, top: (obj.top ?? 0) + 20 });
  canvas.add(copy);
  canvas.setActiveObject(copy);
  canvas.requestRenderAll();
}

const STYLE_KEYS = [
  "fill", "stroke", "strokeWidth", "opacity", "shadow",
  "fontFamily", "fontWeight", "fontStyle", "underline", "textAlign", "lineHeight", "charSpacing", "fontSize",
  "rx", "ry",
] as const;

export function copyStyle(obj: fabric.FabricObject) {
  const style: Record<string, unknown> = {};
  const isText = obj instanceof fabric.Textbox || obj instanceof fabric.IText;
  for (const key of STYLE_KEYS) {
    if (!isText && /^font|^underline$|^textAlign$|^lineHeight$|^charSpacing$/.test(key)) continue;
    if (key === "rx" || key === "ry") {
      if (!(obj instanceof fabric.Rect)) continue;
    }
    const value = (obj as unknown as Record<string, unknown>)[key];
    if (value !== undefined) style[key] = value;
  }
  styleClipboard = style;
}

/** Applies the copied style; text styles only go to text, shape styles to shapes. */
export function pasteStyle(obj: fabric.FabricObject): boolean {
  if (!styleClipboard) return false;
  const isText = obj instanceof fabric.Textbox || obj instanceof fabric.IText;
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(styleClipboard)) {
    if (!isText && /^font|^underline$|^textAlign$|^lineHeight$|^charSpacing$/.test(key)) continue;
    if ((key === "rx" || key === "ry") && !(obj instanceof fabric.Rect)) continue;
    props[key] = value;
  }
  obj.set(props as Partial<fabric.FabricObject>);
  if (isText) (obj as fabric.Textbox).initDimensions();
  return true;
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Moves an object so its (rotated) bounds touch the chosen page edge or centre. */
export function alignToPage(obj: fabric.FabricObject, how: Alignment, pageWidth: number, pageHeight: number) {
  obj.setCoords();
  const points = Object.values(obj.aCoords);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let dx = 0;
  let dy = 0;
  if (how === "left") dx = -minX;
  if (how === "right") dx = pageWidth - maxX;
  if (how === "center") dx = pageWidth / 2 - (minX + maxX) / 2;
  if (how === "top") dy = -minY;
  if (how === "bottom") dy = pageHeight - maxY;
  if (how === "middle") dy = pageHeight / 2 - (minY + maxY) / 2;
  obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
  obj.setCoords();
}

export const isLocked = (obj: fabric.FabricObject) => !!obj.lockMovementX;

export function lockProps(locked: boolean) {
  return {
    lockMovementX: locked,
    lockMovementY: locked,
    lockRotation: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    hasControls: !locked,
  };
}

export function setLocked(obj: fabric.FabricObject, locked: boolean) {
  obj.set(lockProps(locked));
}
