import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import type * as fabric from "fabric";

/** Which drawer is open beside the canvas (Canva's Position / Effects panels). */
export type SidePanel = null | "position" | "effects" | "edit-image";

interface EditorUI {
  panel: SidePanel;
  setPanel: (panel: SidePanel) => void;
}

const EditorUIContext = createContext<EditorUI>({ panel: null, setPanel: () => {} });

export function EditorUIProvider({ children }: { children: ComponentChildren }) {
  const [panel, setPanel] = useState<SidePanel>(null);
  return <EditorUIContext.Provider value={{ panel, setPanel }}>{children}</EditorUIContext.Provider>;
}

export const useEditorUI = () => useContext(EditorUIContext);

/**
 * Re-renders whenever objects on the canvas move, scale, rotate or change, so
 * read-outs like X / Y / width stay live while dragging.
 */
export function useCanvasTick(canvas: fabric.Canvas | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!canvas) return;
    const bump = () => setTick((t) => t + 1);
    const events = ["object:moving", "object:scaling", "object:rotating", "object:modified", "object:added", "object:removed"] as const;
    for (const e of events) canvas.on(e, bump);
    return () => {
      for (const e of events) canvas.off(e, bump);
    };
  }, [canvas]);
}

/** Small click-to-open popover used by toolbar buttons. Closes on outside click or Escape. */
export function Popover({ trigger, children, align = "center", width = "w-64" }: {
  trigger: (open: boolean, toggle: () => void) => ComponentChildren;
  children: ComponentChildren;
  align?: "left" | "center" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const pos = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <div ref={ref} class="relative">
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div class={`absolute top-full mt-2 ${pos} ${width} z-40 bg-white border border-zinc-200 rounded-lg shadow-xl p-3`}>
          {children}
        </div>
      )}
    </div>
  );
}
