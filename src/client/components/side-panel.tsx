import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import * as fabric from "fabric";
import {
  X,
  BringToFront,
  SendToBack,
  MoveUp,
  MoveDown,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  Lock,
  LockOpen,
  Link2,
  Unlink2,
  Type,
  Image as ImageIcon,
  Shapes,
  Eye,
  EyeOff,
} from "lucide-preact";
import { useEditor } from "../context";
import { useCanvasTick, useEditorUI } from "./editor-ui";
import { TextEffects } from "./right-sidebar";
import { ImageEditPanel } from "./image-edit-panel";
import { alignToPage, isLocked, lockProps, type Alignment } from "../lib/object-actions";

const tile =
  "flex items-center gap-2 h-9 px-2.5 rounded-md border border-zinc-300 bg-transparent text-xs text-zinc-700 cursor-pointer hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed";

/** Number field that commits on Enter or blur, so typing "1" on the way to "120" does not jump. */
function NumberField({ label, value, unit, onCommit, disabled }: {
  label: string; value: number; unit: string; onCommit: (v: number) => void; disabled?: boolean;
}) {
  const shown = String(Math.round(value * 10) / 10);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setDraft(shown);
  };
  return (
    <label class="block">
      <span class="text-[11px] text-zinc-400 mb-1 block">{label}</span>
      <span class="flex items-center h-9 px-2 rounded-md border border-zinc-300 bg-white focus-within:border-accent">
        <input type="text" inputMode="decimal" aria-label={label} disabled={disabled}
          class="w-full min-w-0 bg-transparent border-none outline-none text-xs text-zinc-700 disabled:opacity-50"
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        <span class="text-[11px] text-zinc-400 ml-1">{unit}</span>
      </span>
    </label>
  );
}

function Arrange() {
  const { canvas, selectedObject, changeLayer, updateSelectedObject, canvasWidth, canvasHeight } = useEditor();
  const [ratioLocked, setRatioLocked] = useState(true);
  if (!canvas || !selectedObject) return <p class="text-xs text-zinc-400">Select an element to arrange it.</p>;

  const objects = canvas.getObjects();
  const index = objects.indexOf(selectedObject);
  const atTop = index === objects.length - 1;
  const atBottom = index <= 0;
  const isText = selectedObject instanceof fabric.Textbox;
  const w = selectedObject.getScaledWidth();
  const h = selectedObject.getScaledHeight();

  const align = (how: Alignment) => {
    alignToPage(selectedObject, how, canvasWidth, canvasHeight);
    updateSelectedObject({ left: selectedObject.left, top: selectedObject.top });
  };

  // Text boxes change their wrap width; everything else scales.
  const setWidth = (next: number) => {
    if (next <= 0) return;
    if (isText) return updateSelectedObject({ width: next / (selectedObject.scaleX || 1) });
    const sx = next / (selectedObject.width || 1);
    updateSelectedObject(ratioLocked ? { scaleX: sx, scaleY: sx * ((selectedObject.scaleY || 1) / (selectedObject.scaleX || 1)) } : { scaleX: sx });
  };
  const setHeight = (next: number) => {
    if (next <= 0 || isText) return;
    const sy = next / (selectedObject.height || 1);
    updateSelectedObject(ratioLocked ? { scaleY: sy, scaleX: sy * ((selectedObject.scaleX || 1) / (selectedObject.scaleY || 1)) } : { scaleY: sy });
  };

  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class={tile} disabled={atTop} onClick={() => changeLayer("forward")}><MoveUp size={14} />Forward</button>
        <button type="button" class={tile} disabled={atBottom} onClick={() => changeLayer("backward")}><MoveDown size={14} />Backward</button>
        <button type="button" class={tile} disabled={atTop} onClick={() => changeLayer("front")}><BringToFront size={14} />To front</button>
        <button type="button" class={tile} disabled={atBottom} onClick={() => changeLayer("back")}><SendToBack size={14} />To back</button>
      </div>

      <div>
        <h3 class="text-xs font-semibold text-zinc-700 mb-2">Align to page</h3>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class={tile} onClick={() => align("top")}><AlignVerticalJustifyStart size={14} />Top</button>
          <button type="button" class={tile} onClick={() => align("left")}><AlignHorizontalJustifyStart size={14} />Left</button>
          <button type="button" class={tile} onClick={() => align("middle")}><AlignVerticalJustifyCenter size={14} />Middle</button>
          <button type="button" class={tile} onClick={() => align("center")}><AlignHorizontalJustifyCenter size={14} />Center</button>
          <button type="button" class={tile} onClick={() => align("bottom")}><AlignVerticalJustifyEnd size={14} />Bottom</button>
          <button type="button" class={tile} onClick={() => align("right")}><AlignHorizontalJustifyEnd size={14} />Right</button>
        </div>
      </div>

      <div>
        <h3 class="text-xs font-semibold text-zinc-700 mb-2">Advanced</h3>
        <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2 items-end">
          <NumberField label="Width" unit="px" value={w} onCommit={setWidth} />
          <NumberField label="Height" unit="px" value={h} onCommit={setHeight} disabled={isText} />
          <button type="button" title={ratioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
            aria-label={ratioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"} aria-pressed={ratioLocked}
            class={`${tile} justify-center px-0 ${ratioLocked ? "bg-accent/15 text-accent border-accent" : ""}`}
            onClick={() => setRatioLocked(!ratioLocked)}>
            {ratioLocked ? <Link2 size={14} /> : <Unlink2 size={14} />}
          </button>
        </div>
        <div class="grid grid-cols-3 gap-2 mt-2">
          <NumberField label="X" unit="px" value={selectedObject.left ?? 0} onCommit={(left) => updateSelectedObject({ left })} />
          <NumberField label="Y" unit="px" value={selectedObject.top ?? 0} onCommit={(top) => updateSelectedObject({ top })} />
          <NumberField label="Rotate" unit="°" value={selectedObject.angle ?? 0}
            onCommit={(angle) => updateSelectedObject({ angle: ((angle % 360) + 360) % 360 })} />
        </div>
        {isText && <p class="text-[10px] text-zinc-400 mt-2 m-0">Text height follows its content; change the font size to make it taller.</p>}
      </div>
    </div>
  );
}

function layerLabel(obj: fabric.FabricObject): { icon: ComponentChildren; name: string } {
  if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) {
    return { icon: <Type size={14} />, name: obj.text.replace(/\s+/g, " ").trim() || "Text" };
  }
  if (obj instanceof fabric.FabricImage) {
    return { icon: <ImageIcon size={14} />, name: (obj as any)._isBgImage ? "Background image" : "Image" };
  }
  const type = obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
  return { icon: <Shapes size={14} />, name: type };
}

/** Every element, top of the stack first. Click to select; reorder, hide or lock in place. */
function LayersList() {
  const { canvas, selectedObject, updateSelectedObject } = useEditor();
  if (!canvas) return null;
  const objects = canvas.getObjects();
  // Cut-outs are part of their photo, not separate layers to manage.
  const rows = objects.map((obj, i) => ({ obj, i })).filter(({ obj }) => !(obj as any).cutoutOf).reverse();
  if (rows.length === 0) return <p class="text-xs text-zinc-400">This page is empty.</p>;

  const select = (obj: fabric.FabricObject) => {
    if (!obj.selectable) return;
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
  };
  const edit = (obj: fabric.FabricObject, props: Record<string, unknown>) => {
    obj.set(props as Partial<fabric.FabricObject>);
    canvas.requestRenderAll();
    canvas.fire("object:modified", { target: obj } as never);
    if (obj === selectedObject) updateSelectedObject({});
  };
  const move = (obj: fabric.FabricObject, dir: 1 | -1) => {
    if (dir === 1) canvas.bringObjectForward(obj);
    else canvas.sendObjectBackwards(obj);
    edit(obj, {});
  };

  return (
    <ul class="flex flex-col gap-1 list-none m-0 p-0">
      {rows.map(({ obj, i }) => {
        const { icon, name } = layerLabel(obj);
        const locked = isLocked(obj);
        const hidden = obj.visible === false;
        const selected = obj === selectedObject;
        return (
          <li key={i}
            class={`group flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-pointer ${selected ? "border-accent bg-accent/10" : "border-zinc-200 hover:bg-zinc-50"}`}
            onClick={() => select(obj)}>
            <span class="text-zinc-500 shrink-0">{icon}</span>
            <span class={`flex-1 truncate text-xs ${hidden ? "text-zinc-400 line-through" : "text-zinc-700"}`}>{name}</span>
            <span class="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button type="button" title="Move up" aria-label={`Move ${name} up`} disabled={i === objects.length - 1}
                class="p-1 rounded bg-transparent border-none text-zinc-400 cursor-pointer hover:text-zinc-900 disabled:opacity-30" onClick={() => move(obj, 1)}>
                <MoveUp size={12} />
              </button>
              <button type="button" title="Move down" aria-label={`Move ${name} down`} disabled={i === 0}
                class="p-1 rounded bg-transparent border-none text-zinc-400 cursor-pointer hover:text-zinc-900 disabled:opacity-30" onClick={() => move(obj, -1)}>
                <MoveDown size={12} />
              </button>
              <button type="button" title={hidden ? "Show" : "Hide"} aria-label={`${hidden ? "Show" : "Hide"} ${name}`}
                class="p-1 rounded bg-transparent border-none text-zinc-400 cursor-pointer hover:text-zinc-900" onClick={() => edit(obj, { visible: hidden })}>
                {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button type="button" title={locked ? "Unlock" : "Lock"} aria-label={`${locked ? "Unlock" : "Lock"} ${name}`}
                class={`p-1 rounded bg-transparent border-none cursor-pointer hover:text-zinc-900 ${locked ? "text-accent" : "text-zinc-400"}`}
                onClick={() => edit(obj, lockProps(!locked))}>
                {locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PositionPanel() {
  const [tab, setTab] = useState<"arrange" | "layers">("arrange");
  return (
    <>
      <div class="flex border-b border-zinc-200 mb-4" role="tablist">
        {(["arrange", "layers"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t}
            class={`flex-1 py-2 text-xs font-medium bg-transparent border-none border-b-2 cursor-pointer capitalize -mb-px ${tab === t ? "text-zinc-900 border-accent" : "text-zinc-400 border-transparent hover:text-zinc-700"}`}
            style={{ borderBottomStyle: "solid", borderBottomWidth: 2, borderBottomColor: tab === t ? "var(--color-accent)" : "transparent" }}
            onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "arrange" ? <Arrange /> : <LayersList />}
    </>
  );
}

const TITLES = { position: "Position", effects: "Shadow & tilt", "edit-image": "Edit" } as const;

/** The drawer that opens over the left of the canvas, like Canva's Position and Effects panels. */
export function SidePanel() {
  const { canvas, selectedObject } = useEditor();
  const { panel, setPanel } = useEditorUI();
  useCanvasTick(canvas);

  // Effects only apply to text and Edit image to images; close them when the selection changes kind.
  const isText = selectedObject instanceof fabric.Textbox || selectedObject instanceof fabric.IText;
  const isImage = selectedObject instanceof fabric.FabricImage;
  useEffect(() => {
    const editable = !!selectedObject && !(selectedObject instanceof fabric.ActiveSelection);
    if ((panel === "effects" && !isText) || (panel === "edit-image" && !editable)) setPanel(null);
  }, [panel, isText, isImage, selectedObject]);

  if (!panel) return null;
  return (
    <aside aria-label={TITLES[panel]}
      class="absolute left-3 top-3 bottom-3 w-72 z-[35] bg-white border border-zinc-200 rounded-xl shadow-xl flex flex-col">
      <div class="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 class="text-sm font-semibold text-zinc-800 m-0">{TITLES[panel]}</h2>
        <button type="button" aria-label="Close panel" class="p-1 rounded bg-transparent border-none text-zinc-400 cursor-pointer hover:text-zinc-900 hover:bg-zinc-100"
          onClick={() => setPanel(null)}>
          <X size={16} />
        </button>
      </div>
      <div class="px-4 pb-4 overflow-y-auto flex-1">
        {panel === "position" && <PositionPanel />}
        {panel === "effects" && isText && <div class="flex flex-col gap-4"><TextEffects /></div>}
        {panel === "edit-image" && selectedObject && (
          <ImageEditPanel key={isImage ? (selectedObject as fabric.FabricImage).getSrc() : String(canvas?.getObjects().indexOf(selectedObject))} />
        )}
      </div>
    </aside>
  );
}
