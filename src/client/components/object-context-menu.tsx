import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import * as fabric from "fabric";
import {
  Copy,
  Paintbrush,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  Layers,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Lock,
  LockOpen,
  Accessibility,
  Scissors,
  ImageDown,
  ImagePlus,
  Info,
  ChevronRight,
  BringToFront,
  MoveUp,
  MoveDown,
  SendToBack,
} from "lucide-preact";
import { useEditor } from "../context";
import { downloadDataURL } from "../lib/export";
import {
  alignToPage,
  copyObject,
  copyStyle,
  duplicateObject,
  hasClipboard,
  hasStyleClipboard,
  isLocked,
  pasteObject,
  pasteStyle,
  setLocked,
  type Alignment,
} from "../lib/object-actions";
import { hasTextBehind } from "../lib/text-behind";

export const OPEN_CONTEXT_MENU = "lumio:contextmenu";

export interface ContextMenuDetail {
  x: number;
  y: number;
  canvas: fabric.Canvas;
  target: fabric.FabricObject | null;
}

type Panel = null | "alt" | "info";

function Row({ icon, label, hint, disabled, onClick, children }: {
  icon?: ComponentChildren;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick?: () => void;
  children?: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [flip, setFlip] = useState(false);
  const [up, setUp] = useState(false);
  const hasSub = children !== undefined;
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const show = () => {
    if (!hasSub) return;
    window.clearTimeout(closeTimer.current);
    setOpen(true);
    const rect = row.current?.getBoundingClientRect();
    if (rect) {
      setFlip(rect.right + 200 > window.innerWidth);
      setUp(rect.top + 240 > window.innerHeight);
    }
  };
  // A short grace period, so a pointer travelling diagonally to the
  // flyout does not close it on the way.
  const hide = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 250);
  };

  return (
    <div
      ref={row}
      class="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup={hasSub ? "menu" : undefined}
        aria-expanded={hasSub ? open : undefined}
        disabled={disabled}
        class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left text-xs bg-transparent border-none text-zinc-700 cursor-pointer hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        onClick={() => (hasSub ? show() : onClick?.())}
      >
        <span class="w-4 flex justify-center text-zinc-500">{icon}</span>
        <span class="flex-1">{label}</span>
        {hint && <span class="text-[10px] text-zinc-400 font-mono">{hint}</span>}
        {hasSub && <ChevronRight size={12} class="text-zinc-400" />}
      </button>
      {hasSub && open && (
        // The outer box is an invisible bridge: it starts flush against the
        // row and pads across the gap, so the pointer never leaves the row's
        // subtree on its way into the flyout.
        <div
          class={`absolute ${up ? "-bottom-1" : "-top-1"} ${flip ? "right-full pr-2" : "left-full pl-2"} z-10`}
          onMouseEnter={show}
        >
          <div role="menu" class="w-44 bg-white border border-zinc-200 rounded-lg shadow-xl p-1">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

const Divider = () => <div class="my-1 border-t border-zinc-200" />;

/**
 * Right-click menu for canvas objects: clipboard, layer order, alignment,
 * lock, alt text and image tools. Also owns the clipboard shortcuts.
 */
export function ObjectContextMenu() {
  const { removeBackground, removeTextBehind, cutoutBusy, setBackground, canvasWidth, canvasHeight, updateSelectedObject } = useEditor();
  const [menu, setMenu] = useState<ContextMenuDetail | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [altDraft, setAltDraft] = useState("");
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setMenu(null);
    setPanel(null);
  };

  useEffect(() => {
    const open = (e: Event) => {
      const detail = (e as CustomEvent<ContextMenuDetail>).detail;
      setPanel(null);
      setMenu(detail);
      setPos({ x: detail.x, y: detail.y });
      setAltDraft(((detail.target as any)?.altText as string) || "");
    };
    window.addEventListener(OPEN_CONTEXT_MENU, open);
    return () => window.removeEventListener(OPEN_CONTEXT_MENU, open);
  }, []);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
  }, [menu, panel]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
    };
  }, [menu]);

  // Shortcuts act on the active canvas's selection.
  const { canvas: activeCanvas } = useEditor();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const canvas = activeCanvas;
      if (!canvas) return;
      const obj = canvas.getActiveObject();
      if (obj && (obj as fabric.Textbox).isEditing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.altKey && e.code === "KeyC" && obj) { e.preventDefault(); copyStyle(obj); }
      else if (mod && e.altKey && e.code === "KeyV" && obj) { e.preventDefault(); if (pasteStyle(obj)) commit(canvas, obj); }
      else if (mod && !e.altKey && e.code === "KeyC" && obj) { e.preventDefault(); void copyObject(obj); }
      else if (mod && !e.altKey && e.code === "KeyV" && hasClipboard()) { e.preventDefault(); void pasteObject(canvas); }
      else if (mod && !e.altKey && e.code === "KeyD" && obj) { e.preventDefault(); void duplicateObject(canvas, obj); }
      else if (e.altKey && e.shiftKey && e.code === "KeyL" && obj) { e.preventDefault(); setLocked(obj, !isLocked(obj)); commit(canvas, obj); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeCanvas]);

  if (!menu) return null;
  const { canvas, target } = menu;

  /** Saves a history step (and autosave) after a direct edit to an object. */
  function commit(c: fabric.Canvas, obj: fabric.FabricObject) {
    obj.setCoords();
    c.requestRenderAll();
    c.fire("object:modified", { target: obj } as never);
    updateSelectedObject({});
  }

  const run = (fn: () => void | Promise<void>) => async () => {
    close();
    await fn();
  };

  // Empty canvas: only paste makes sense.
  if (!target) {
    if (!hasClipboard()) return null;
    return (
      <div ref={ref} role="menu" class="fixed z-50 w-56 bg-white border border-zinc-200 rounded-lg shadow-xl p-1" style={{ left: pos.x, top: pos.y }}>
        <Row icon={<ClipboardPaste size={14} />} label="Paste" hint="Ctrl+V" onClick={run(() => void pasteObject(canvas))} />
      </div>
    );
  }

  const isImage = target instanceof fabric.FabricImage;
  const isText = target instanceof fabric.Textbox || target instanceof fabric.IText;
  const objects = canvas.getObjects();
  const index = objects.indexOf(target);
  const locked = isLocked(target);

  const layer = (action: "front" | "forward" | "backward" | "back") => run(() => {
    if (action === "front") canvas.bringObjectToFront(target);
    else if (action === "forward") canvas.bringObjectForward(target);
    else if (action === "backward") canvas.sendObjectBackwards(target);
    else canvas.sendObjectToBack(target);
    commit(canvas, target);
  });

  const align = (how: Alignment) => run(() => {
    alignToPage(target, how, canvasWidth, canvasHeight);
    commit(canvas, target);
  });

  const shell = "fixed z-50 w-60 bg-white border border-zinc-200 rounded-lg shadow-xl p-1";

  if (panel === "alt") {
    return (
      <div ref={ref} class={`${shell} p-3`} style={{ left: pos.x, top: pos.y }}>
        <label class="text-[11px] text-zinc-400 mb-1 block" for="alt-text-input">Alternative text</label>
        <textarea
          id="alt-text-input"
          rows={3}
          autofocus
          class="w-full bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent resize-none"
          placeholder="Describe this element for screen readers"
          value={altDraft}
          onInput={(e) => setAltDraft((e.target as HTMLTextAreaElement).value)}
        />
        <div class="flex justify-end gap-1 mt-2">
          <button type="button" class="px-2.5 py-1 rounded-md text-xs border border-zinc-300 bg-transparent text-zinc-500 cursor-pointer" onClick={close}>Cancel</button>
          <button
            type="button"
            class="px-2.5 py-1 rounded-md text-xs border-none bg-accent text-white cursor-pointer"
            onClick={() => {
              (target as any).altText = altDraft.trim();
              commit(canvas, target);
              close();
            }}
          >Save</button>
        </div>
      </div>
    );
  }

  if (panel === "info") {
    const rows: [string, string][] = [
      ["Type", isImage ? "Image" : isText ? "Text" : target.type],
      ["Size", `${Math.round(target.getScaledWidth())} × ${Math.round(target.getScaledHeight())} px`],
      ["Position", `${Math.round(target.left ?? 0)}, ${Math.round(target.top ?? 0)}`],
      ["Rotation", `${Math.round(target.angle ?? 0)}°`],
      ["Layer", `${index + 1} of ${objects.length}`],
      ["Locked", locked ? "Yes" : "No"],
    ];
    if (isText) rows.splice(1, 0, ["Font", `${(target as fabric.Textbox).fontFamily}, ${Math.round((target as fabric.Textbox).fontSize)}px`]);
    return (
      <div ref={ref} class={`${shell} p-3`} style={{ left: pos.x, top: pos.y }}>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs m-0">
          {rows.map(([k, v]) => (
            <>
              <dt class="text-zinc-400">{k}</dt>
              <dd class="m-0 text-zinc-700 font-mono text-right">{v}</dd>
            </>
          ))}
        </dl>
        <div class="flex justify-end mt-2">
          <button type="button" class="px-2.5 py-1 rounded-md text-xs border border-zinc-300 bg-transparent text-zinc-500 cursor-pointer" onClick={close}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} role="menu" aria-label="Element actions" class={shell} style={{ left: pos.x, top: pos.y }}>
      <Row icon={<Copy size={14} />} label="Copy" hint="Ctrl+C" onClick={run(() => copyObject(target))} />
      <Row icon={<Paintbrush size={14} />} label="Copy style" hint="Ctrl+Alt+C" onClick={run(() => copyStyle(target))} />
      <Row icon={<ClipboardPaste size={14} />} label="Paste" hint="Ctrl+V" disabled={!hasClipboard()} onClick={run(() => void pasteObject(canvas))} />
      <Row icon={<Paintbrush size={14} />} label="Paste style" hint="Ctrl+Alt+V" disabled={!hasStyleClipboard()} onClick={run(() => { if (pasteStyle(target)) commit(canvas, target); })} />
      <Row icon={<CopyPlus size={14} />} label="Duplicate" hint="Ctrl+D" onClick={run(() => duplicateObject(canvas, target))} />
      <Row icon={<Trash2 size={14} />} label="Delete" hint="Del" onClick={run(() => { canvas.remove(target); canvas.discardActiveObject(); canvas.requestRenderAll(); })} />
      <Divider />
      <Row icon={<Layers size={14} />} label="Layer">
        <Row icon={<BringToFront size={14} />} label="Bring to front" disabled={index === objects.length - 1} onClick={layer("front")} />
        <Row icon={<MoveUp size={14} />} label="Bring forward" disabled={index === objects.length - 1} onClick={layer("forward")} />
        <Row icon={<MoveDown size={14} />} label="Send backward" disabled={index <= 0} onClick={layer("backward")} />
        <Row icon={<SendToBack size={14} />} label="Send to back" disabled={index <= 0} onClick={layer("back")} />
      </Row>
      <Row icon={<AlignHorizontalJustifyStart size={14} />} label="Align to page">
        <Row icon={<AlignHorizontalJustifyStart size={14} />} label="Left" onClick={align("left")} />
        <Row icon={<AlignHorizontalJustifyCenter size={14} />} label="Center" onClick={align("center")} />
        <Row icon={<AlignHorizontalJustifyEnd size={14} />} label="Right" onClick={align("right")} />
        <Row icon={<AlignVerticalJustifyStart size={14} />} label="Top" onClick={align("top")} />
        <Row icon={<AlignVerticalJustifyCenter size={14} />} label="Middle" onClick={align("middle")} />
        <Row icon={<AlignVerticalJustifyEnd size={14} />} label="Bottom" onClick={align("bottom")} />
      </Row>
      <Divider />
      {isImage && (
        <>
          <Row icon={<Scissors size={14} />} label="Remove background" disabled={cutoutBusy} onClick={run(() => removeBackground(false))} />
          {hasTextBehind(canvas, target)
            ? <Row icon={<Layers size={14} />} label="Turn off text behind subject" onClick={run(() => removeTextBehind())} />
            : <Row icon={<Layers size={14} />} label="Put text behind subject" disabled={cutoutBusy} onClick={run(() => removeBackground(true))} />}
          <Row
            icon={<ImagePlus size={14} />}
            label="Replace as background"
            onClick={run(() => {
              setBackground("image", (target as fabric.FabricImage).getSrc());
              canvas.remove(target);
              canvas.discardActiveObject();
              canvas.requestRenderAll();
            })}
          />
        </>
      )}
      <Row
        icon={locked ? <LockOpen size={14} /> : <Lock size={14} />}
        label={locked ? "Unlock" : "Lock"}
        hint="Alt+Shift+L"
        onClick={run(() => { setLocked(target, !locked); commit(canvas, target); })}
      />
      <Row icon={<Accessibility size={14} />} label="Alternative text" onClick={() => setPanel("alt")} />
      <Row
        icon={<ImageDown size={14} />}
        label="Download selection"
        onClick={run(() => {
          const url = target.toDataURL({ format: "png", multiplier: 2 });
          downloadDataURL(url, `${isImage ? "image" : isText ? "text" : "element"}.png`);
        })}
      />
      <Divider />
      <Row icon={<Info size={14} />} label="Info" onClick={() => setPanel("info")} />
    </div>
  );
}
