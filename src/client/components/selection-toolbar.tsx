import { useEffect, useRef, useState } from "preact/hooks";
import * as fabric from "fabric";
import { Lock, LockOpen, CopyPlus, Trash2, MoreHorizontal } from "lucide-preact";
import { useEditor } from "../context";
import { duplicateObject, isLocked, lockProps } from "../lib/object-actions";
import { OPEN_CONTEXT_MENU, type ContextMenuDetail } from "./object-context-menu";

const GAP = 44; // px between the element's top edge and the bar

/**
 * The pill that floats above the selected element (Canva's lock / duplicate /
 * delete / more). It tracks the element every frame, so it follows drags,
 * zoom and scrolling, and hides while the element is being transformed.
 */
export function SelectionToolbar() {
  const { canvas, selectedObject, updateSelectedObject, deleteSelected } = useEditor();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [transforming, setTransforming] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvas) return;
    const down = (e: { target?: fabric.FabricObject }) => e.target && setTransforming(true);
    const up = () => setTransforming(false);
    canvas.on("mouse:down", down);
    canvas.on("mouse:up", up);
    return () => {
      canvas.off("mouse:down", down);
      canvas.off("mouse:up", up);
    };
  }, [canvas]);

  useEffect(() => {
    if (!canvas || !selectedObject) {
      setPos(null);
      return;
    }
    let frame = 0;
    let last = "";
    const track = () => {
      frame = requestAnimationFrame(track);
      const el = canvas.upperCanvasEl;
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      // Page units → client pixels: retina viewport transform × CSS zoom.
      const k = (rect.width / canvas.getWidth()) * canvas.viewportTransform[0];
      selectedObject.setCoords();
      const pts = Object.values(selectedObject.aCoords);
      const minX = Math.min(...pts.map((p) => p.x));
      const maxX = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxY = Math.max(...pts.map((p) => p.y));
      const width = bar.current?.offsetWidth ?? 140;
      let x = rect.left + ((minX + maxX) / 2) * k - width / 2;
      let y = rect.top + minY * k - GAP;
      // Not enough room above: sit under the element instead.
      if (y < 56) y = rect.top + maxY * k + GAP - 32;
      x = Math.max(8, Math.min(x, window.innerWidth - width - 8));
      const key = `${Math.round(x)},${Math.round(y)}`;
      if (key !== last) {
        last = key;
        setPos({ x, y });
      }
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [canvas, selectedObject]);

  if (!canvas || !selectedObject || !pos || transforming) return null;
  const locked = isLocked(selectedObject);
  const item = "p-1.5 rounded-md bg-transparent border-none text-zinc-600 cursor-pointer hover:bg-zinc-100 hover:text-zinc-900 flex";

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Quick actions"
      class="fixed z-30 flex items-center gap-0.5 px-1 py-0.5 bg-white border border-zinc-200 rounded-full shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      <button type="button" class={item} title={locked ? "Unlock" : "Lock"} aria-label={locked ? "Unlock" : "Lock"}
        onClick={() => updateSelectedObject(lockProps(!locked))}>
        {locked ? <LockOpen size={15} /> : <Lock size={15} />}
      </button>
      <button type="button" class={item} title="Duplicate" aria-label="Duplicate"
        onClick={() => void duplicateObject(canvas, selectedObject)}>
        <CopyPlus size={15} />
      </button>
      <button type="button" class={item} title="Delete" aria-label="Delete" onClick={deleteSelected}>
        <Trash2 size={15} />
      </button>
      <button type="button" class={item} title="More" aria-label="More actions"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          window.dispatchEvent(new CustomEvent<ContextMenuDetail>(OPEN_CONTEXT_MENU, {
            detail: { x: r.left, y: r.bottom + 6, canvas, target: selectedObject },
          }));
        }}>
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}
