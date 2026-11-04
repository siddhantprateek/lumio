import { useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import * as fabric from "fabric";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  CaseSensitive,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  FlipHorizontal,
  FlipVertical,
  Scissors,
  Layers,
  ImagePlus,
  Replace,
  Square,
  SquareRoundCorner,
  Blend,
  Move,
  Sparkles,
  MoveHorizontal,
  Wand2,
  Crop,
  ImageOff,
  Check,
  X,
  RotateCcw,
} from "lucide-preact";
import { useEditor } from "../context";
import { FontPicker } from "./font-picker";
import { FontSizeInput } from "./font-size-input";
import { FillEditor, BrandSwatches } from "./right-sidebar";
import { GradientControls } from "./gradient-controls";
import { findBackdropShape, findBgImage, isBgImage } from "../lib/background";
import { buildObjectGradient } from "../lib/gradient";
import { Popover, useCanvasTick, useEditorUI } from "./editor-ui";
import { hasTextBehind } from "../lib/text-behind";
import { specToCss, gradientToSpec, type GradientSpec } from "../lib/gradient";
import {
  cancelCrop, commitCrop, cropBlockedReason, resetCrop, setCropRatio, setCropZoom, startCrop, useCropSession,
} from "../lib/crop";

const btn =
  "flex items-center gap-1.5 h-8 px-2 rounded-md text-xs font-medium bg-transparent border-none text-zinc-700 cursor-pointer hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";
const active = "bg-accent/15 text-accent hover:bg-accent/20";
const Sep = () => <span class="w-px h-5 bg-zinc-200 mx-1 shrink-0" />;

function Btn({ title, on, onClick, disabled, children }: {
  title: string; on?: boolean; onClick?: () => void; disabled?: boolean; children: ComponentChildren;
}) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={on} disabled={disabled}
      class={`${btn} ${on ? active : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function Range({ label, value, min, max, step = 1, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
        {label}<span class="font-mono">{Math.round(value * 100) / 100}{unit}</span>
      </label>
      <input type="range" min={min} max={max} step={step} aria-label={label} class="w-full accent-accent" value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))} />
    </div>
  );
}

/** Opacity button + popover, shared by every element type. */
function Transparency() {
  const { selectedObject, updateSelectedObject } = useEditor();
  if (!selectedObject) return null;
  return (
    <Popover width="w-56" trigger={(open, toggle) => (
      <Btn title="Transparency" on={open} onClick={toggle}><Blend size={15} /></Btn>
    )}>
      <Range label="Transparency" unit="%" min={0} max={100} value={Math.round((selectedObject.opacity ?? 1) * 100)}
        onChange={(v) => updateSelectedObject({ opacity: v / 100 })} />
    </Popover>
  );
}

function PositionButton() {
  const { panel, setPanel } = useEditorUI();
  return (
    <Btn title="Position" on={panel === "position"} onClick={() => setPanel(panel === "position" ? null : "position")}>
      <Move size={14} />Position
    </Btn>
  );
}

/** Swatch that shows the current fill (solid or gradient) and opens the fill editor. */
function FillSwatch({ label, solidDefault, underline }: { label: string; solidDefault: string; underline?: boolean }) {
  const { selectedObject } = useEditor();
  const fill = selectedObject?.fill;
  const spec = gradientToSpec(fill);
  const background = spec ? specToCss(spec) : typeof fill === "string" && fill ? fill : solidDefault;
  return (
    <Popover width="w-72" trigger={(open, toggle) => (
      <Btn title={label} on={open} onClick={toggle}>
        {underline ? (
          <span class="flex flex-col items-center leading-none">
            <span class="text-sm font-bold">A</span>
            <span class="w-4 h-1 rounded-sm border border-zinc-300" style={{ background }} />
          </span>
        ) : (
          <span class="w-5 h-5 rounded-full border border-zinc-300" style={{ background }} />
        )}
      </Btn>
    )}>
      <FillEditor label={label} solidDefault={solidDefault} />
    </Popover>
  );
}

/** Border colour + width, and corner rounding for rectangles and images. */
function BorderControls({ rounding }: { rounding: boolean }) {
  const { selectedObject, updateSelectedObject } = useEditor();
  if (!selectedObject) return null;
  const stroke = typeof selectedObject.stroke === "string" && selectedObject.stroke ? selectedObject.stroke : "#000000";
  const width = selectedObject.strokeWidth ?? 0;
  const isImage = selectedObject instanceof fabric.FabricImage;
  // Images round through a clip path; rectangles through rx / ry.
  const radius = isImage
    ? ((selectedObject.clipPath as fabric.Rect | undefined)?.rx ?? 0)
    : ((selectedObject as fabric.Rect).rx ?? 0);
  const maxRadius = Math.round(Math.min(selectedObject.width ?? 0, selectedObject.height ?? 0) / 2);

  const setRadius = (r: number) => {
    if (!isImage) return updateSelectedObject({ rx: r, ry: r });
    const w = selectedObject.width ?? 0;
    const h = selectedObject.height ?? 0;
    updateSelectedObject({
      clipPath: r > 0
        ? new fabric.Rect({ width: w, height: h, rx: r, ry: r, originX: "center", originY: "center" })
        : undefined,
    });
  };

  return (
    <>
      <Popover width="w-60" trigger={(open, toggle) => (
        <Btn title="Border" on={open} onClick={toggle}><Square size={15} /></Btn>
      )}>
        <div class="flex flex-col gap-3">
          <Range label="Border weight" min={0} max={40} value={width}
            onChange={(strokeWidth) => updateSelectedObject({ strokeWidth, stroke, strokeUniform: true })} />
          <div>
            <label class="text-[11px] text-zinc-400 mb-1 block">Border colour</label>
            <input type="color" aria-label="Border colour" class="w-full h-8 rounded border border-zinc-300 cursor-pointer bg-transparent"
              value={stroke} onInput={(e) => updateSelectedObject({ stroke: (e.target as HTMLInputElement).value, strokeWidth: width || 4, strokeUniform: true })} />
            <BrandSwatches onPick={(color) => updateSelectedObject({ stroke: color, strokeWidth: width || 4, strokeUniform: true })} />
          </div>
        </div>
      </Popover>
      {rounding && (
        <Popover width="w-56" trigger={(open, toggle) => (
          <Btn title="Corner rounding" on={open} onClick={toggle}><SquareRoundCorner size={15} /></Btn>
        )}>
          <Range label="Corner rounding" min={0} max={maxRadius} value={radius} onChange={setRadius} />
        </Popover>
      )}
    </>
  );
}

function FlipMenu() {
  const { selectedObject, updateSelectedObject } = useEditor();
  if (!selectedObject) return null;
  return (
    <Popover width="w-48" trigger={(open, toggle) => (
      <Btn title="Flip" on={open} onClick={toggle}>Flip</Btn>
    )}>
      <div class="flex flex-col gap-1 -m-1">
        <button type="button" class={`${btn} w-full`} onClick={() => updateSelectedObject({ flipX: !selectedObject.flipX })}>
          <FlipHorizontal size={14} />Flip horizontal
        </button>
        <button type="button" class={`${btn} w-full`} onClick={() => updateSelectedObject({ flipY: !selectedObject.flipY })}>
          <FlipVertical size={14} />Flip vertical
        </button>
      </div>
    </Popover>
  );
}

function ImageBar() {
  const { canvas, selectedObject, removeBackground, removeTextBehind, cutoutBusy, cutoutProgress, setBackground, updateSelectedObject } = useEditor();
  const file = useRef<HTMLInputElement>(null);
  const image = selectedObject as fabric.FabricImage;
  const linked = hasTextBehind(canvas, image);
  const busyLabel = cutoutProgress !== null && cutoutProgress < 1 ? `Downloading model ${Math.round(cutoutProgress * 100)}%` : "Removing…";

  // Replace keeps the frame: the new picture is scaled to cover the old box.
  const replace = async (f: File) => {
    const form = new FormData();
    form.append("file", f);
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    const data = await res.json();
    if (!data.url) return;
    const boxW = image.getScaledWidth();
    const boxH = image.getScaledHeight();
    await image.setSrc(data.url, { crossOrigin: "anonymous" });
    const scale = Math.max(boxW / (image.width || 1), boxH / (image.height || 1));
    updateSelectedObject({ scaleX: scale, scaleY: scale, clipPath: undefined });
  };

  const { panel, setPanel } = useEditorUI();
  return (
    <>
      <Btn title="Edit image" on={panel === "edit-image"} onClick={() => setPanel(panel === "edit-image" ? null : "edit-image")}>
        <Wand2 size={14} />Edit
      </Btn>
      <Sep />
      <Btn title="Replace image" onClick={() => file.current?.click()}><Replace size={14} />Replace</Btn>
      <Btn title={cropBlockedReason(image) ?? "Crop"} disabled={!!cropBlockedReason(image)}
        onClick={() => {
          if (!canvas) return;
          setPanel(null);
          void startCrop(canvas, image, () => {});
        }}>
        <Crop size={14} />Crop
      </Btn>
      <input ref={file} type="file" accept="image/*" class="hidden" aria-label="Replacement image"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void replace(f);
        }} />
      <Btn title="Remove background" disabled={cutoutBusy} onClick={() => removeBackground(false)}>
        <Scissors size={14} />{cutoutBusy ? busyLabel : "BG Remover"}
      </Btn>
      <Btn title={linked ? "Turn off text behind subject" : "Put text behind subject"} on={linked} disabled={cutoutBusy && !linked}
        onClick={() => (linked ? removeTextBehind() : removeBackground(true))}>
        <Layers size={14} />Text behind
      </Btn>
      <Btn title="Set as page background" onClick={() => {
        if (!canvas) return;
        setBackground("image", image.getSrc());
        canvas.remove(image);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }}><ImagePlus size={14} />Set as BG</Btn>
      <Sep />
      <BorderControls rounding />
      <FlipMenu />
      <Transparency />
      <Sep />
      <PositionButton />
    </>
  );
}

const ALIGN_CYCLE = ["left", "center", "right", "justify"] as const;
const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };

function TextBar() {
  const { selectedObject, updateSelectedObject } = useEditor();
  const { panel, setPanel } = useEditorUI();
  const text = selectedObject as fabric.Textbox;
  const bold = text.fontWeight === "bold" || Number(text.fontWeight) >= 600;
  const align = (ALIGN_CYCLE as readonly string[]).includes(text.textAlign) ? text.textAlign as typeof ALIGN_CYCLE[number] : "left";
  const AlignIcon = ALIGN_ICON[align];
  const isUpper = text.text === text.text.toUpperCase() && text.text !== text.text.toLowerCase();

  return (
    <>
      <FontPicker compact label="Font" value={text.fontFamily || "Inter"} onChange={(fontFamily) => updateSelectedObject({ fontFamily })} />
      <FontSizeInput compact value={Math.round(text.fontSize || 18)} onChange={(fontSize) => updateSelectedObject({ fontSize })} />
      <Sep />
      <FillSwatch label="Text colour" solidDefault="#000000" underline />
      <Btn title="Bold" on={bold} onClick={() => updateSelectedObject({ fontWeight: bold ? "400" : "700" })}><Bold size={15} /></Btn>
      <Btn title="Italic" on={text.fontStyle === "italic"} onClick={() => updateSelectedObject({ fontStyle: text.fontStyle === "italic" ? "normal" : "italic" })}><Italic size={15} /></Btn>
      <Btn title="Underline" on={!!text.underline} onClick={() => updateSelectedObject({ underline: !text.underline })}><Underline size={15} /></Btn>
      <Btn title="Strikethrough" on={!!text.linethrough} onClick={() => updateSelectedObject({ linethrough: !text.linethrough })}><Strikethrough size={15} /></Btn>
      <Btn title="Uppercase" on={isUpper} onClick={() => {
        // Remember the original casing so toggling back restores it.
        const t = text as fabric.Textbox & { _caseOriginal?: string };
        if (isUpper) updateSelectedObject({ text: t._caseOriginal ?? text.text.toLowerCase() });
        else {
          t._caseOriginal = text.text;
          updateSelectedObject({ text: text.text.toUpperCase() });
        }
      }}><CaseSensitive size={16} /></Btn>
      <Btn title={`Alignment: ${align}`} onClick={() => updateSelectedObject({ textAlign: ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(align) + 1) % ALIGN_CYCLE.length] })}>
        <AlignIcon size={15} />
      </Btn>
      <Popover width="w-60" trigger={(open, toggle) => (
        <Btn title="Spacing" on={open} onClick={toggle}><MoveHorizontal size={15} /></Btn>
      )}>
        <div class="flex flex-col gap-3">
          <Range label="Letter spacing" min={-200} max={800} step={10} value={text.charSpacing ?? 0}
            onChange={(charSpacing) => updateSelectedObject({ charSpacing })} />
          <Range label="Line spacing" min={0.5} max={3} step={0.05} value={text.lineHeight ?? 1.16}
            onChange={(lineHeight) => updateSelectedObject({ lineHeight })} />
        </div>
      </Popover>
      <Transparency />
      <Sep />
      <Btn title="Edit: filters, adjust and effects" on={panel === "edit-image"} onClick={() => setPanel(panel === "edit-image" ? null : "edit-image")}>
        <Wand2 size={14} />Edit
      </Btn>
      <Btn title="Shadow, rotation and tilt" on={panel === "effects"} onClick={() => setPanel(panel === "effects" ? null : "effects")}>
        <Sparkles size={14} />Shadow & tilt
      </Btn>
      <PositionButton />
    </>
  );
}

function ShapeBar() {
  const { selectedObject } = useEditor();
  const { panel, setPanel } = useEditorUI();
  const single = !(selectedObject instanceof fabric.ActiveSelection);
  return (
    <>
      {single && (
        <>
          <Btn title="Edit: filters, adjust and effects" on={panel === "edit-image"} onClick={() => setPanel(panel === "edit-image" ? null : "edit-image")}>
            <Wand2 size={14} />Edit
          </Btn>
          <Sep />
        </>
      )}
      <FillSwatch label="Colour" solidDefault="#6366f1" />
      <BorderControls rounding={selectedObject instanceof fabric.Rect} />
      <Transparency />
      <Sep />
      <PositionButton />
    </>
  );
}

const PAGE_COLORS = [
  "#ffffff", "#f8fafc", "#fef3c7", "#fde2e4", "#e0f2fe", "#dcfce7",
  "#18181b", "#0f172a", "#1e1b4b", "#7c3aed", "#2563eb", "#e11d48",
];

/** Page colour: solid or gradient. Choosing one drops a background image, as in Canva. */
function PageColour() {
  const { canvas, setBackground, removeBackgroundImage, canvasWidth, canvasHeight } = useEditor();
  // A template's full-page shape is the visible background; colour that instead.
  const backdrop = canvas ? findBackdropShape(canvas, canvasWidth, canvasHeight) : undefined;
  const bg = backdrop ? backdrop.fill : canvas?.backgroundColor;
  const spec = gradientToSpec(bg);
  const solid = typeof bg === "string" && bg ? bg : "#ffffff";
  const hasImage = !!(canvas && findBgImage(canvas));
  const swatch = spec ? specToCss(spec) : solid;
  const [mode, setMode] = useState<"solid" | "gradient">(spec ? "gradient" : "solid");
  const [draft, setDraft] = useState<GradientSpec>(spec ?? { from: "#667eea", to: "#764ba2", angle: 135 });

  const paintBackdrop = (fill: string | fabric.Gradient<"linear">) => {
    if (!canvas || !backdrop) return;
    backdrop.set({ fill, dirty: true });
    canvas.requestRenderAll();
    canvas.fire("object:modified", { target: backdrop } as never);
  };
  const setSolid = (c: string) => {
    if (hasImage) removeBackgroundImage();
    if (backdrop) paintBackdrop(c);
    else setBackground("color", c);
  };
  const setGradient = (g: GradientSpec) => {
    setDraft(g);
    if (hasImage) removeBackgroundImage();
    if (backdrop) paintBackdrop(buildObjectGradient(g));
    else setBackground("gradient", specToCss(g));
  };

  return (
    <Popover width="w-72" trigger={(open, toggle) => (
      <Btn title="Background colour" on={open} onClick={toggle}>
        <span class="w-5 h-5 rounded-full border border-zinc-300" style={{ background: swatch }} />
      </Btn>
    )}>
      <div class="flex gap-1 mb-3" role="group" aria-label="Background type">
        {(["solid", "gradient"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m}
            class={`flex-1 py-1 rounded-md border text-xs cursor-pointer capitalize ${mode === m ? "bg-accent/20 border-accent text-accent" : "bg-transparent border-zinc-300 text-zinc-500 hover:text-zinc-900"}`}
            onClick={() => {
              setMode(m);
              if (m === "gradient") setGradient(spec ?? draft);
            }}>{m}</button>
        ))}
      </div>
      {mode === "solid" ? (
        <div class="flex flex-col gap-2">
          <div class="grid grid-cols-6 gap-1.5">
            {PAGE_COLORS.map((c) => (
              <button key={c} type="button" title={c} aria-label={`Background ${c}`}
                class={`aspect-square rounded-md border cursor-pointer hover:scale-110 transition-all ${solid.toLowerCase() === c && !spec ? "border-accent" : "border-zinc-300"}`}
                style={{ background: c }} onClick={() => setSolid(c)} />
            ))}
          </div>
          <input type="color" aria-label="Custom background colour" class="w-full h-8 rounded border border-zinc-300 cursor-pointer bg-transparent"
            value={solid} onInput={(e) => setSolid((e.target as HTMLInputElement).value)} />
          <BrandSwatches onPick={setSolid} />
        </div>
      ) : (
        <GradientControls spec={spec ?? draft} onChange={setGradient} />
      )}
      {hasImage && (
        <p class="text-[10px] text-zinc-400 mt-2 mb-0">Picking a colour replaces the background image.</p>
      )}
    </Popover>
  );
}

/** Upload → page background image. */
function ReplaceBackground({ label }: { label: string }) {
  const { setBackground } = useEditor();
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <Btn title="Background image" onClick={() => file.current?.click()}><Replace size={14} />{label}</Btn>
      <input ref={file} type="file" accept="image/*" class="hidden" aria-label="Background image file"
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!f) return;
          const form = new FormData();
          form.append("file", f);
          const res = await fetch("/api/uploads", { method: "POST", body: form });
          const data = await res.json();
          if (data.url) setBackground("image", data.url);
        }} />
    </>
  );
}

/** Nothing selected = the page is selected, as in Canva. */
function PageBar() {
  const { canvas, editBackground } = useEditor();
  const { setPanel } = useEditorUI();
  const [busy, setBusy] = useState(false);
  const hasImage = !!(canvas && findBgImage(canvas));
  return (
    <>
      <Btn title="Edit the page background: filters, adjust, effects" disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            if (await editBackground()) setPanel("edit-image");
          } finally {
            setBusy(false);
          }
        }}>
        <Wand2 size={14} />{busy ? "Preparing…" : "Edit"}
      </Btn>
      <Sep />
      <ReplaceBackground label={hasImage ? "Replace" : "Add image"} />
      <PageColour />
      <Sep />
      <PositionButton />
    </>
  );
}

/** The background image is being edited (it cannot be moved or resized). */
function BackgroundBar() {
  const { canvas, removeBackgroundImage } = useEditor();
  const { panel, setPanel } = useEditorUI();
  return (
    <>
      <span class="flex items-center gap-1.5 px-2 text-xs font-semibold text-zinc-800">Background</span>
      <Sep />
      <Btn title="Edit background" on={panel === "edit-image"} onClick={() => setPanel(panel === "edit-image" ? null : "edit-image")}>
        <Wand2 size={14} />Edit
      </Btn>
      <ReplaceBackground label="Replace" />
      <PageColour />
      <Btn title="Remove background image" onClick={() => { setPanel(null); removeBackgroundImage(); }}>
        <ImageOff size={14} />Remove image
      </Btn>
      <Sep />
      <Transparency />
      <button type="button" title="Done editing the background"
        class="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border-none bg-accent text-[#ffffff] cursor-pointer hover:bg-accent-hover"
        onClick={() => { setPanel(null); canvas?.discardActiveObject(); canvas?.requestRenderAll(); }}>
        <Check size={14} />Done
      </button>
    </>
  );
}

const RATIOS: { label: string; value: number | "original" | null }[] = [
  { label: "Free", value: null },
  { label: "Original", value: "original" },
  { label: "1:1", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
];

/** Shown instead of the image tools while cropping. */
function CropBar({ session }: { session: NonNullable<ReturnType<typeof useCropSession>> }) {
  const original = session.natural.width / session.natural.height;
  const isOn = (v: number | "original" | null) =>
    v === null ? session.ratio === null : Math.abs((v === "original" ? original : v) - (session.ratio ?? -1)) < 1e-6;
  return (
    <>
      <span class="flex items-center gap-1.5 px-2 text-xs font-semibold text-zinc-800"><Crop size={14} />Crop</span>
      <Sep />
      {RATIOS.map((r) => (
        <Btn key={r.label} title={`Aspect ratio ${r.label}`} on={isOn(r.value)}
          onClick={() => setCropRatio(r.value === "original" ? original : r.value)}>{r.label}</Btn>
      ))}
      <Sep />
      <label class="flex items-center gap-2 px-2 text-xs text-zinc-600">
        Zoom
        <input type="range" min="1" max="3" step="0.01" aria-label="Crop zoom" class="w-24 accent-accent"
          value={session.zoom} onInput={(e) => setCropZoom(parseFloat((e.target as HTMLInputElement).value))} />
      </label>
      <Btn title="Reset crop" onClick={resetCrop}><RotateCcw size={14} />Reset</Btn>
      <Sep />
      <Btn title="Cancel (Esc)" onClick={cancelCrop}><X size={14} />Cancel</Btn>
      <button type="button" title="Apply crop (Enter)"
        class="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border-none bg-accent text-[#ffffff] cursor-pointer hover:bg-accent-hover"
        onClick={commitCrop}>
        <Check size={14} />Done
      </button>
    </>
  );
}

/**
 * Canva-style contextual bar above the canvas. Its buttons depend on what is
 * selected: image tools, text formatting, or shape styling.
 */
export function ContextToolbar() {
  const { canvas, selectedObject } = useEditor();
  useCanvasTick(canvas);
  const crop = useCropSession();
  const isText = selectedObject instanceof fabric.Textbox || selectedObject instanceof fabric.IText;
  const isImage = selectedObject instanceof fabric.FabricImage;

  return (
    <div class="min-h-12 shrink-0 flex items-center justify-center px-3 py-1.5 border-b border-zinc-200 bg-surface relative z-30">
      {crop ? (
        <div role="toolbar" aria-label="Crop tools"
          class="flex items-center gap-0.5 px-1.5 py-1 bg-white border border-accent rounded-lg shadow-sm max-w-full flex-wrap">
          <CropBar session={crop} />
        </div>
      ) : selectedObject ? (
        <div role="toolbar" aria-label="Element tools"
          class="flex items-center gap-0.5 px-1.5 py-1 bg-white border border-zinc-200 rounded-lg shadow-sm max-w-full overflow-visible flex-wrap">
          {isBgImage(selectedObject) ? <BackgroundBar /> : isImage ? <ImageBar /> : isText ? <TextBar /> : <ShapeBar />}
        </div>
      ) : canvas ? (
        <div role="toolbar" aria-label="Page tools"
          class="flex items-center gap-0.5 px-1.5 py-1 bg-white border border-zinc-200 rounded-lg shadow-sm max-w-full overflow-visible flex-wrap">
          <PageBar />
        </div>
      ) : null}
    </div>
  );
}
