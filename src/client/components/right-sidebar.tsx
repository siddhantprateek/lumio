import { useState, useEffect } from "preact/hooks";
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  FlipHorizontal,
  FlipVertical,
  Trash2,
  Copy,
  BringToFront,
  MoveUp,
  MoveDown,
  SendToBack,
  Scissors,
  Layers,
} from "lucide-preact";
import * as fabric from "fabric";
import { useEditor } from "../context";
import { FontPicker } from "./font-picker";
import { buildObjectGradient, gradientToSpec, specToCss, type GradientSpec } from "../lib/gradient";
import { GradientControls } from "./gradient-controls";
import { FontSizeInput } from "./font-size-input";
import { hasTextBehind } from "../lib/text-behind";
import { useCropSession } from "../lib/crop";

/**
 * The active kit's colours, offered wherever a colour is chosen. This is what
 * "on brand" means day to day: the brand palette is one click away at the
 * moment of picking, not a page you have to remember to visit.
 */
export function BrandSwatches({ onPick }: { onPick: (color: string) => void }) {
  const { activeBrandKit } = useEditor();
  if (!activeBrandKit || activeBrandKit.colors.length === 0) return null;
  return (
    <div class="flex flex-wrap gap-1 mt-1.5">
      {activeBrandKit.colors.map((color, i) => (
        <button
          key={`${color}-${i}`}
          class="w-5 h-5 rounded border border-zinc-300 cursor-pointer transition-all hover:scale-110 hover:border-accent"
          style={{ background: color }}
          title={`${activeBrandKit.name} — ${color}`}
          aria-label={`Use brand color ${color}`}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

/**
 * Names an object so `/api/designs/:id/fields` publishes it and
 * `/api/designs/:id/fill` can write to it. Committed on blur rather than per
 * keystroke, so naming a field costs one undo step instead of one per letter.
 */
function FieldNameInput({
  object,
  onCommit,
}: {
  object: fabric.FabricObject;
  onCommit: (name: string) => void;
}) {
  const saved = ((object as any).fieldName as string) || "";
  const [draft, setDraft] = useState(saved);

  // Re-seed when the selection moves to a different object.
  useEffect(() => setDraft(saved), [object]);

  const commit = () => {
    const next = draft.trim();
    if (next !== saved) onCommit(next);
    setDraft(next);
  };

  return (
    <div>
      <label class="text-[11px] text-zinc-400 mb-1 block">Field name</label>
      <input
        type="text"
        placeholder="e.g. headline"
        class="w-full bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent font-mono"
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <p class="text-[10px] text-zinc-400 mt-1 leading-snug">
        {saved
          ? "Fillable through the design's /fill endpoint."
          : "Name it to fill it from data or an agent."}
      </p>
    </div>
  );
}

/** Two-colour gradient background with an angle. Applied live. */
function GradientEditor() {
  const { canvas, setBackground } = useEditor();
  const current = gradientToSpec(canvas?.backgroundColor);
  const [draft, setDraft] = useState<GradientSpec>({ from: "#667eea", to: "#764ba2", angle: 135 });
  // The live canvas background wins, so presets picked elsewhere show up here.
  const spec = current ?? draft;
  return (
    <div class="flex flex-col gap-2">
      <label class="text-[11px] text-zinc-400">Gradient background</label>
      <GradientControls
        spec={spec}
        onChange={(next) => {
          setDraft(next);
          setBackground("gradient", specToCss(next));
        }}
      />
    </div>
  );
}

/**
 * Solid or gradient fill for text and shapes. A gradient stretches with the
 * object, so resizing text keeps the blend across it.
 */
export function FillEditor({ label, solidDefault }: { label: string; solidDefault: string }) {
  const { selectedObject, updateSelectedObject } = useEditor();
  if (!selectedObject) return null;
  const fill = selectedObject.fill;
  const spec = gradientToSpec(fill);
  const solid = typeof fill === "string" && fill ? fill : solidDefault;
  const mode = spec ? "gradient" : "solid";

  return (
    <div>
      <label class="text-[11px] text-zinc-400 mb-1 block">{label}</label>
      <div class="flex gap-1 mb-2" role="group" aria-label={`${label} type`}>
        {(["solid", "gradient"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            class={`flex-1 py-1 rounded-md border text-xs cursor-pointer capitalize transition-all ${
              mode === m ? "bg-accent/20 border-accent text-accent" : "bg-transparent border-zinc-300 text-zinc-500 hover:text-zinc-900"
            }`}
            onClick={() => {
              if (m === mode) return;
              updateSelectedObject({
                fill: m === "gradient"
                  ? buildObjectGradient({ from: solid, to: "#8b5cf6", angle: 90 })
                  : (spec?.from ?? solidDefault),
              });
            }}
          >{m}</button>
        ))}
      </div>
      {spec ? (
        <GradientControls spec={spec} onChange={(next) => updateSelectedObject({ fill: buildObjectGradient(next) })} />
      ) : (
        <>
          <div class="flex items-center gap-2">
            <input
              type="color"
              class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
              value={solid}
              onInput={(e) => updateSelectedObject({ fill: (e.target as HTMLInputElement).value })}
            />
            <input
              type="text"
              class="flex-1 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent font-mono"
              value={solid}
              onInput={(e) => updateSelectedObject({ fill: (e.target as HTMLInputElement).value })}
            />
          </div>
          <BrandSwatches onPick={(color) => updateSelectedObject({ fill: color })} />
        </>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
        {label}
        <span class="font-mono">{Math.round(value * 100) / 100}{unit}</span>
      </label>
      <input type="range" min={min} max={max} step={step} aria-label={label} class="w-full accent-accent" value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))} />
    </div>
  );
}

/** Rotation, tilt and shadow, like the text controls in text-behind-image. */
export function TextEffects() {
  const { selectedObject, updateSelectedObject } = useEditor();
  if (!selectedObject) return null;
  const shadow = selectedObject.shadow instanceof fabric.Shadow ? selectedObject.shadow : null;
  const setShadow = (patch: Partial<{ color: string; blur: number; offsetX: number; offsetY: number }>) => {
    const base = shadow ?? { color: "rgba(0,0,0,0.5)", blur: 8, offsetX: 0, offsetY: 4 };
    updateSelectedObject({
      shadow: new fabric.Shadow({ color: base.color, blur: base.blur, offsetX: base.offsetX, offsetY: base.offsetY, ...patch }),
    });
  };
  const alphaOf = (color: string) => new fabric.Color(color).getAlpha();

  return (
    <>
      <div class="border-t border-zinc-200 pt-3">
        <h3 class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Effects</h3>
        <div class="flex flex-col gap-3">
          <Slider label="Rotation" unit="°" min={-180} max={180} value={selectedObject.angle ?? 0}
            onChange={(angle) => updateSelectedObject({ angle })} />
          <Slider label="Tilt horizontal" unit="°" min={-45} max={45} value={selectedObject.skewX ?? 0}
            onChange={(skewX) => updateSelectedObject({ skewX })} />
          <Slider label="Tilt vertical" unit="°" min={-45} max={45} value={selectedObject.skewY ?? 0}
            onChange={(skewY) => updateSelectedObject({ skewY })} />
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-[11px] text-zinc-400" for="text-shadow-toggle">Shadow</label>
          <input id="text-shadow-toggle" type="checkbox" class="accent-accent cursor-pointer" checked={!!shadow}
            onChange={(e) => ((e.target as HTMLInputElement).checked ? setShadow({}) : updateSelectedObject({ shadow: null }))} />
        </div>
        {shadow && (
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <input type="color" aria-label="Shadow colour" class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
                value={`#${new fabric.Color(shadow.color).toHex()}`}
                onInput={(e) => {
                  const hex = (e.target as HTMLInputElement).value;
                  setShadow({ color: new fabric.Color(hex).setAlpha(alphaOf(shadow.color)).toRgba() });
                }} />
              <div class="flex-1">
                <Slider label="Shadow opacity" unit="%" min={0} max={100} value={Math.round(alphaOf(shadow.color) * 100)}
                  onChange={(v) => setShadow({ color: new fabric.Color(shadow.color).setAlpha(v / 100).toRgba() })} />
              </div>
            </div>
            <Slider label="Shadow blur" min={0} max={60} value={shadow.blur} onChange={(blur) => setShadow({ blur })} />
            <Slider label="Shadow offset X" min={-50} max={50} value={shadow.offsetX} onChange={(offsetX) => setShadow({ offsetX })} />
            <Slider label="Shadow offset Y" min={-50} max={50} value={shadow.offsetY} onChange={(offsetY) => setShadow({ offsetY })} />
          </div>
        )}
      </div>
    </>
  );
}

export function RightSidebar() {
  const { removeBackground, removeTextBehind, cutoutBusy, cutoutProgress, cutoutError, selectedObject, updateSelectedObject, changeLayer, deleteSelected, canvas, setBackground, canvasWidth, canvasHeight } =
    useEditor();

  const cropping = useCropSession();
  const isText = selectedObject instanceof fabric.Textbox || selectedObject instanceof fabric.IText;
  const isImage = selectedObject instanceof fabric.FabricImage;
  const isShape = selectedObject && !isText && !isImage;

  // The crop frame is a temporary layer, not an element to style.
  if (cropping) {
    return (
      <aside class="w-[280px] bg-white border-l border-zinc-200 flex flex-col shrink-0">
        <div class="p-4 border-b border-zinc-200">
          <h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Crop</h2>
        </div>
        <p class="p-4 text-xs text-zinc-500 leading-relaxed m-0">
          Drag the handles to crop. Drag inside the frame to move the picture. Press Enter or Done to apply, Esc to cancel.
        </p>
      </aside>
    );
  }
  const objects = canvas?.getObjects() ?? [];
  const layerIndex = selectedObject ? objects.indexOf(selectedObject) : -1;
  const layerCount = objects.length;

  if (!selectedObject) {
    return (
      <aside class="w-[280px] bg-white border-l border-zinc-200 flex flex-col shrink-0">
        <div class="p-4 border-b border-zinc-200">
          <h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Canvas</h2>
        </div>
        <div class="p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-zinc-400">Dimensions</span>
            <span class="text-[11px] text-zinc-600 font-mono">{canvasWidth} x {canvasHeight}</span>
          </div>
          <label class="text-[11px] text-zinc-400">Background color</label>
          <input
            type="color"
            class="w-full h-8 rounded-md border border-zinc-300 cursor-pointer bg-transparent"
            onChange={(e) => setBackground("color", (e.target as HTMLInputElement).value)}
          />
          <BrandSwatches onPick={(color) => setBackground("color", color)} />
          <GradientEditor />
        </div>
      </aside>
    );
  }

  return (
    <aside class="w-[280px] bg-white border-l border-zinc-200 flex flex-col shrink-0 overflow-y-auto">
      {/* Header */}
      <div class="p-4 border-b border-zinc-200 flex items-center justify-between">
        <h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          {isText ? "Text" : isImage ? "Image" : "Shape"}
        </h2>
        <div class="flex gap-1">
          <button
            class="p-1 rounded text-zinc-400 bg-transparent border-none cursor-pointer hover:text-zinc-800 hover:bg-zinc-100 transition-all"
            onClick={async () => {
              if (!canvas || !selectedObject) return;
              const clone = await selectedObject.clone();
              clone.set({ left: (selectedObject.left || 0) + 20, top: (selectedObject.top || 0) + 20 });
              canvas.add(clone);
              canvas.setActiveObject(clone);
            }}
            title="Duplicate"
          >
            <Copy size={14} />
          </button>
          <button
            class="p-1 rounded text-zinc-400 bg-transparent border-none cursor-pointer hover:text-red-400 hover:bg-red-500/10 transition-all"
            onClick={deleteSelected}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div class="p-4 flex flex-col gap-4">
        {/* ── Template field ────────────────────────────────────────── */}
        {(isText || isImage) && (
          <FieldNameInput
            object={selectedObject}
            onCommit={(fieldName) => updateSelectedObject({ fieldName })}
          />
        )}

        <div>
          <label class="text-[11px] text-zinc-400 mb-1 block">Layer order</label>
          <div class="flex gap-1">
            {([
              ["front", BringToFront, "To front", layerIndex === layerCount - 1],
              ["forward", MoveUp, "Forward", layerIndex === layerCount - 1],
              ["backward", MoveDown, "Backward", layerIndex <= 0],
              ["back", SendToBack, "To back", layerIndex <= 0],
            ] as const).map(([action, Icon, label, disabled]) => (
              <button
                key={action}
                type="button"
                class="flex-1 flex justify-center p-1.5 rounded-md border border-zinc-300 bg-transparent text-zinc-500 cursor-pointer hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-35 disabled:cursor-not-allowed"
                title={label}
                aria-label={label}
                disabled={layerIndex < 0 || disabled}
                onClick={() => changeLayer(action)}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>

        {/* ── Text properties ───────────────────────────────────────── */}
        {isText && (
          <>
            {/* Font family */}
            <FontPicker
              label="Font family"
              value={(selectedObject as fabric.IText).fontFamily || "Inter"}
              onChange={(fontFamily) => updateSelectedObject({ fontFamily })}
            />

            <FontSizeInput
              value={Math.round((selectedObject as any).fontSize || 18)}
              onChange={(fontSize) => updateSelectedObject({ fontSize })}
            />

            {/* Bold / Italic / Underline */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Style</label>
              <div class="flex gap-1">
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).fontWeight === "700" || (selectedObject as any).fontWeight === "bold"
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() =>
                    updateSelectedObject({
                      fontWeight:
                        (selectedObject as any).fontWeight === "700" || (selectedObject as any).fontWeight === "bold"
                          ? "400"
                          : "700",
                    })
                  }
                >
                  <Bold size={14} />
                </button>
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).fontStyle === "italic"
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() =>
                    updateSelectedObject({
                      fontStyle: (selectedObject as any).fontStyle === "italic" ? "normal" : "italic",
                    })
                  }
                >
                  <Italic size={14} />
                </button>
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).underline
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() =>
                    updateSelectedObject({ underline: !(selectedObject as any).underline })
                  }
                >
                  <Underline size={14} />
                </button>
              </div>
            </div>

            {/* Text alignment */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Alignment</label>
              <div class="flex gap-1">
                {[
                  { align: "left", icon: AlignLeft },
                  { align: "center", icon: AlignCenter },
                  { align: "right", icon: AlignRight },
                ].map(({ align, icon: Icon }) => (
                  <button
                    key={align}
                    class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                      (selectedObject as any).textAlign === align
                        ? "bg-accent/20 border-accent text-accent"
                        : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                    }`}
                    onClick={() => updateSelectedObject({ textAlign: align })}
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>

            <FillEditor label="Color" solidDefault="#ffffff" />

            {/* Line height */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                Line height
                <span class="text-zinc-400 font-mono">{((selectedObject as any).lineHeight || 1.2).toFixed(1)}</span>
              </label>
              <input
                type="range"
                min="0.8"
                max="3"
                step="0.1"
                class="w-full accent-accent"
                value={(selectedObject as any).lineHeight || 1.2}
                onInput={(e) =>
                  updateSelectedObject({
                    lineHeight: parseFloat((e.target as HTMLInputElement).value),
                  })
                }
              />
            </div>

            {/* Letter spacing */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                Letter spacing
                <span class="text-zinc-400 font-mono">{(selectedObject as any).charSpacing || 0}</span>
              </label>
              <input
                type="range"
                min="-200"
                max="800"
                step="10"
                class="w-full accent-accent"
                value={(selectedObject as any).charSpacing || 0}
                onInput={(e) =>
                  updateSelectedObject({
                    charSpacing: parseInt((e.target as HTMLInputElement).value),
                  })
                }
              />
            </div>
          </>
        )}

        {isText && <TextEffects />}

        {/* ── Shape properties ──────────────────────────────────────── */}
        {isShape && (
          <>
            <FillEditor label="Fill" solidDefault="#6366f1" />

            {/* Stroke */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Stroke color</label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
                  value={(selectedObject.stroke as string) || "#000000"}
                  onInput={(e) =>
                    updateSelectedObject({ stroke: (e.target as HTMLInputElement).value })
                  }
                />
                <input
                  type="number"
                  class="w-16 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent"
                  value={selectedObject.strokeWidth || 0}
                  min={0}
                  placeholder="Width"
                  onInput={(e) =>
                    updateSelectedObject({
                      strokeWidth: parseInt((e.target as HTMLInputElement).value) || 0,
                    })
                  }
                />
              </div>
            </div>

            {/* Border radius (for rect) */}
            {selectedObject instanceof fabric.Rect && (
              <div>
                <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                  Border radius
                  <span class="text-zinc-400 font-mono">{(selectedObject as any).rx || 0}px</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  class="w-full accent-accent"
                  value={(selectedObject as any).rx || 0}
                  onInput={(e) => {
                    const val = parseInt((e.target as HTMLInputElement).value);
                    updateSelectedObject({ rx: val, ry: val });
                  }}
                />
              </div>
            )}
          </>
        )}

        {/* ── Image properties ──────────────────────────────────────── */}
        {isImage && (
          <>
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Background</label>
              <div class="flex flex-col gap-1">
                <button type="button" disabled={cutoutBusy}
                  class="flex items-center justify-center gap-1.5 p-1.5 rounded-md border border-zinc-300 bg-transparent text-xs text-zinc-600 cursor-pointer hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-wait"
                  onClick={() => removeBackground(false)}>
                  <Scissors size={14} />{cutoutBusy ? (cutoutProgress !== null && cutoutProgress < 1 ? `Downloading model ${Math.round(cutoutProgress * 100)}%` : "Working…") : "Remove background"}
                </button>
                {hasTextBehind(canvas, selectedObject) ? (
                  <button type="button"
                    class="flex items-center justify-center gap-1.5 p-1.5 rounded-md border border-accent bg-accent/10 text-xs text-accent cursor-pointer hover:bg-accent/20"
                    onClick={removeTextBehind}>
                    <Layers size={14} />Turn off text behind subject
                  </button>
                ) : (
                  <button type="button" disabled={cutoutBusy}
                    class="flex items-center justify-center gap-1.5 p-1.5 rounded-md border border-zinc-300 bg-transparent text-xs text-zinc-600 cursor-pointer hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-wait"
                    onClick={() => removeBackground(true)}>
                    <Layers size={14} />{cutoutBusy ? (cutoutProgress !== null && cutoutProgress < 1 ? `Downloading model ${Math.round(cutoutProgress * 100)}%` : "Working…") : "Put text behind subject"}
                  </button>
                )}
              </div>
              <p class="text-[10px] text-zinc-400 mt-1 leading-snug">
                {cutoutBusy ? "The first run downloads the cut-out model (about 88 MB); after that it is cached."
                  : hasTextBehind(canvas, selectedObject)
                    ? "The subject sits on top and follows this photo. Text you add goes behind it; click through the subject to select that text."
                    : "Cuts the subject out and lays it over the photo, with text in between."}
              </p>
              {cutoutError && <p role="alert" class="text-[11px] text-red-500 mt-1">{cutoutError}</p>}
            </div>
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Flip</label>
              <div class="flex gap-1">
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    selectedObject.flipX
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() => updateSelectedObject({ flipX: !selectedObject.flipX })}
                >
                  <FlipHorizontal size={14} />
                </button>
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    selectedObject.flipY
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() => updateSelectedObject({ flipY: !selectedObject.flipY })}
                >
                  <FlipVertical size={14} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Common: Opacity ───────────────────────────────────────── */}
        <div>
          <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
            Opacity
            <span class="text-zinc-400 font-mono">{Math.round((selectedObject.opacity ?? 1) * 100)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="w-full accent-accent"
            value={selectedObject.opacity ?? 1}
            onInput={(e) =>
              updateSelectedObject({
                opacity: parseFloat((e.target as HTMLInputElement).value),
              })
            }
          />
        </div>
      </div>
    </aside>
  );
}
