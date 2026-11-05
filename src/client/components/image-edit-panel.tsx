import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as fabric from "fabric";
import { ArrowLeft, Scissors, Layers, SlidersHorizontal, Ban, RotateCcw, Wand2, Lightbulb, Sun, Droplet, Waves } from "lucide-preact";
import { useEditor } from "../context";
import { findCutout, hasTextBehind } from "../lib/text-behind";
import {
  CUSTOM_DUOTONE_ID,
  IDENTITY,
  LOOK_CATEGORIES,
  NO_ADJUSTMENTS,
  adjustOf,
  applyEdits,
  effectsOf,
  autoAdjust,
  lookOf,
  renderThumbnail,
  previewSource,
  type Adjustments,
  type Look,
  type LookState,
} from "../lib/image-filters";
import { defaultValues, findEffect, type EffectState } from "../lib/effects";
import { EffectDetail, EffectsGallery, EffectsSection } from "./effects-panel";
import { backdropBlurOf } from "../lib/element-effects";

type View = "main" | "filters" | "adjust" | "effects" | "magic" | "effect";

/**
 * Thumbnails of the selected image through every look. Rendered once per
 * image in small batches, so opening the gallery does not freeze the page.
 */
function useLookThumbnails(img: fabric.FabricObject, enabled: boolean) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const src = img instanceof fabric.FabricImage ? img.getSrc() : img;
  useEffect(() => {
    setThumbs({});
    if (!enabled) return;
    // Flat shapes and plain backgrounds preview on a sample picture instead.
    const source = previewSource(img);
    const looks: { id: string; matrix: number[]; pop?: Look["pop"] }[] = [{ id: "none", matrix: IDENTITY }, ...LOOK_CATEGORIES.flatMap((c) => c.looks)];
    let i = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const batch: Record<string, string> = {};
      for (const end = Math.min(i + 8, looks.length); i < end; i++) batch[looks[i].id] = renderThumbnail(source, looks[i].matrix, looks[i].pop);
      setThumbs((prev) => ({ ...prev, ...batch }));
      if (i < looks.length) requestAnimationFrame(step);
    };
    step();
    return () => {
      cancelled = true;
    };
  }, [src, enabled]);
  return thumbs;
}

function Tile({ label, thumb, selected, onClick }: { label: string; thumb?: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} title={label}
      class="flex flex-col items-center gap-1 bg-transparent border-none p-0 cursor-pointer group" onClick={onClick}>
      <span class={`w-full aspect-square rounded-lg overflow-hidden border-2 ${selected ? "border-accent" : "border-transparent group-hover:border-zinc-300"}`}>
        {thumb
          ? <img src={thumb} alt="" class="w-full h-full object-cover block" />
          : <span class="block w-full h-full bg-zinc-100 animate-pulse" />}
      </span>
      <span class="text-[11px] text-zinc-600 truncate max-w-full">{label}</span>
    </button>
  );
}

function Slider({ label, value, min, max, onChange, track }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
  /** CSS background for the track, e.g. the blue→yellow of Temperature. */
  track?: string;
}) {
  return (
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-xs text-zinc-600">{label}</label>
        <input type="number" aria-label={`${label} value`} min={min} max={max} value={value}
          class="w-12 text-center text-[11px] bg-white border border-zinc-300 rounded px-1 py-0.5 text-zinc-700 outline-none focus:border-accent"
          onChange={(e) => {
            const n = parseInt((e.target as HTMLInputElement).value);
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
          }} />
      </div>
      <input type="range" aria-label={label} min={min} max={max} step={1} value={value} class="w-full accent-accent"
        style={track ? ({ "--track": track } as Record<string, string>) : undefined}
        onInput={(e) => onChange(parseInt((e.target as HTMLInputElement).value))} />
    </div>
  );
}

/** Canva's "Edit image" drawer: tools, filters with intensity, adjustments and shadows. */
export function ImageEditPanel() {
  const { canvas, selectedObject, updateSelectedObject, removeBackground, removeTextBehind, cutoutBusy } = useEditor();
  const img = selectedObject as fabric.FabricObject;
  const isPhoto = img instanceof fabric.FabricImage && !(img as { _isBgImage?: boolean })._isBgImage;
  const isShape = !(img instanceof fabric.FabricImage) && !(img instanceof fabric.IText) && !(img instanceof fabric.Textbox);
  const [view, setView] = useState<View>("main");
  const thumbs = useLookThumbnails(img, true);
  const current = lookOf(img);
  const adjust = adjustOf(img);
  const linked = hasTextBehind(canvas, img);
  const effects = effectsOf(img);
  const [fxIndex, setFxIndex] = useState(0);

  // Dragging a slider re-filters live; the history step is saved once, when it settles.
  const commitTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(commitTimer.current), []);
  const [, rerender] = useState(0);
  const apply = (state: LookState | undefined, adj: Adjustments, fx: EffectState[] = effects) => {
    const cutout = canvas ? findCutout(canvas, img) : undefined;
    applyEdits(img, state, adj, cutout, fx);
    canvas?.requestRenderAll();
    rerender((n) => n + 1);
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => updateSelectedObject({ lumioLook: state, lumioAdjust: adj, lumioEffects: fx }), 250);
  };
  const setEffects = (fx: EffectState[]) => apply(current, adjust, fx);
  const addEffect = (id: string) => {
    const def = findEffect(id);
    if (!def) return;
    setEffects([...effects, { id, values: defaultValues(def) }]);
    setFxIndex(effects.length);
    setView("effect");
  };
  const isMagic = (id: string) => !!findEffect(id)?.magic;
  const sectionProps = (magic: boolean) => ({
    img,
    effects,
    magic,
    onSeeAll: () => setView(magic ? "magic" : "effects"),
    onAdd: addEffect,
    // "None" clears only this section's effects.
    onClear: () => setEffects(effects.filter((e) => isMagic(e.id) !== magic)),
    onOpen: (i: number) => { setFxIndex(i); setView("effect"); },
    onToggle: (i: number) => setEffects(effects.map((e, j) => (j === i ? { ...e, enabled: e.enabled === false } : e))),
    onRemove: (i: number) => setEffects(effects.filter((_, j) => j !== i)),
  });

  const pick = (look: Look | null) => {
    if (!look) return apply(undefined, adjust);
    if (current?.id === look.id) return; // keep its intensity
    apply({ id: look.id, intensity: 100, ...(look.id === CUSTOM_DUOTONE_ID ? { dark: "#1e1b4b", light: "#f9a8d4" } : {}) }, adjust);
  };

  const setShadow = (kind: "none" | "glow" | "drop") => {
    const shadow = kind === "glow"
      ? new fabric.Shadow({ color: "rgba(255,255,255,0.85)", blur: 40, offsetX: 0, offsetY: 0 })
      : kind === "drop"
        ? new fabric.Shadow({ color: "rgba(0,0,0,0.45)", blur: 30, offsetX: 10, offsetY: 14 })
        : null;
    updateSelectedObject({ shadow });
  };
  const shadowKind = !img.shadow ? "none" : (img.shadow as fabric.Shadow).offsetX === 0 && (img.shadow as fabric.Shadow).offsetY === 0 ? "glow" : "drop";

  const allLooks = useMemo(() => LOOK_CATEGORIES.flatMap((c) => c.looks), []);
  const featured = allLooks.filter((l) => ["fresco", "bali", "scandi"].includes(l.id));
  const currentLook = allLooks.find((l) => l.id === current?.id);

  const intensity = current && (
    <div class="mt-3 pt-3 border-t border-zinc-200">
      <p class="text-xs font-semibold text-zinc-700 mb-2 m-0">{currentLook?.name ?? "Filter"}</p>
      <Slider label="Intensity" min={0} max={100} value={current.intensity}
        onChange={(intensity) => apply({ ...current, intensity }, adjust)} />
      {current.id === CUSTOM_DUOTONE_ID && (
        <div class="flex gap-3 mt-3">
          {(["dark", "light"] as const).map((k) => (
            <label key={k} class="flex-1 text-[11px] text-zinc-500">
              {k === "dark" ? "Shadows" : "Highlights"}
              <input type="color" aria-label={`Duotone ${k === "dark" ? "shadow" : "highlight"} colour`}
                class="mt-1 w-full h-8 rounded border border-zinc-300 cursor-pointer bg-transparent"
                value={current[k] ?? (k === "dark" ? "#1e1b4b" : "#f9a8d4")}
                onInput={(e) => apply({ ...current, [k]: (e.target as HTMLInputElement).value }, adjust)} />
            </label>
          ))}
        </div>
      )}
    </div>
  );

  if (view === "effects" || view === "magic") {
    return <EffectsGallery img={img} effects={effects} onAdd={addEffect} magic={view === "magic"}
      onRecipe={(rc) => {
        // A recipe replaces this picture's magic look: drop its old magic effects and any finishing effects the recipe brings.
        const ids = new Set(rc.stack.map((s) => s.id));
        const kept = effects.filter((e) => !isMagic(e.id) && !ids.has(e.id));
        setEffects([...kept, ...rc.stack.map((s) => ({ id: s.id, values: { ...defaultValues(findEffect(s.id)!), ...s.values } }))]);
        setView("main");
      }}
      onOpen={(i) => { setFxIndex(i); setView("effect"); }} onBack={() => setView("main")} />;
  }

  if (view === "effect" && effects[fxIndex]) {
    return <EffectDetail effect={effects[fxIndex]}
      onChange={(next) => setEffects(effects.map((e, i) => (i === fxIndex ? next : e)))}
      onRemove={() => { setEffects(effects.filter((_, i) => i !== fxIndex)); setView("main"); }}
      onBack={() => setView(isMagic(effects[fxIndex].id) ? "magic" : "effects")} />;
  }

  if (view === "filters") {
    return (
      <div>
        <button type="button" class="flex items-center gap-1.5 mb-3 bg-transparent border-none p-0 text-sm font-semibold text-zinc-800 cursor-pointer"
          onClick={() => setView("main")}>
          <ArrowLeft size={16} />Filters
        </button>
        {LOOK_CATEGORIES.map((cat) => (
          <section key={cat.name} class="mb-4">
            <h3 class="text-xs font-semibold text-zinc-700 mb-2 m-0">{cat.name}</h3>
            <div class="grid grid-cols-3 gap-2">
              {cat.looks.map((l) => (
                <Tile key={l.id} label={l.name} thumb={thumbs[l.id]} selected={current?.id === l.id} onClick={() => pick(l)} />
              ))}
            </div>
            {cat.looks.some((l) => l.id === current?.id) && intensity}
          </section>
        ))}
        <button type="button" disabled={!current}
          class="w-full h-9 rounded-md border border-zinc-300 bg-transparent text-xs text-zinc-700 cursor-pointer hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => pick(null)}>Remove filter</button>
      </div>
    );
  }

  if (view === "adjust") {
    const set = (key: keyof Adjustments) => (v: number | boolean) => apply(current, { ...adjust, [key]: v });
    const changed = (Object.keys(NO_ADJUSTMENTS) as (keyof Adjustments)[]).some((k) => adjust[k] !== NO_ADJUSTMENTS[k]);
    const heading = (Icon: typeof Sun, text: string, extra?: preact.ComponentChildren) => (
      <div class="flex items-center justify-between mt-2">
        <h3 class="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 m-0"><Icon size={14} />{text}</h3>
        {extra}
      </div>
    );
    return (
      <div>
        <button type="button" class="flex items-center gap-1.5 mb-3 bg-transparent border-none p-0 text-sm font-semibold text-zinc-800 cursor-pointer"
          onClick={() => setView("main")}>
          <ArrowLeft size={16} />Adjust
        </button>
        <div class="flex flex-col gap-4">
          <button type="button"
            class="flex items-center justify-center gap-2 h-10 rounded-lg border-none bg-accent text-[#ffffff] text-sm font-medium cursor-pointer hover:bg-accent-hover"
            onClick={() => apply(current, autoAdjust(img))}>
            <Wand2 size={15} />Auto-adjust
          </button>

          {heading(Lightbulb, "White balance")}
          <Slider label="Temperature" min={-100} max={100} value={adjust.temperature} onChange={set("temperature")}
            track="linear-gradient(90deg, #3b82f6, #e5e7eb, #facc15)" />
          <Slider label="Tint" min={-100} max={100} value={adjust.tint} onChange={set("tint")}
            track="linear-gradient(90deg, #22c55e, #e5e7eb, #d946ef)" />

          {heading(Sun, "Light")}
          <Slider label="Brightness" min={-100} max={100} value={adjust.brightness} onChange={set("brightness")} />
          <Slider label="Contrast" min={-100} max={100} value={adjust.contrast} onChange={set("contrast")} />
          <Slider label="Highlights" min={-100} max={100} value={adjust.highlights} onChange={set("highlights")} />
          <Slider label="Shadows" min={-100} max={100} value={adjust.shadows} onChange={set("shadows")} />
          <Slider label="Whites" min={-100} max={100} value={adjust.whites} onChange={set("whites")} />
          <Slider label="Blacks" min={-100} max={100} value={adjust.blacks} onChange={set("blacks")} />

          {heading(Droplet, "Color", (
            <label class="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
              Invert
              <button type="button" role="switch" aria-checked={adjust.invert} aria-label="Invert colours"
                class={`relative w-9 h-5 rounded-full border-none cursor-pointer transition-colors ${adjust.invert ? "bg-accent" : "bg-zinc-300"}`}
                onClick={() => set("invert")(!adjust.invert)}>
                <span class={`absolute top-0.5 w-4 h-4 rounded-full bg-[#ffffff] shadow transition-all ${adjust.invert ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </label>
          ))}
          <Slider label="Vibrance" min={-100} max={100} value={adjust.vibrance} onChange={set("vibrance")} />
          <Slider label="Saturation" min={-100} max={100} value={adjust.saturation} onChange={set("saturation")} />

          {heading(Waves, "Texture")}
          <Slider label="Sharpness" min={-100} max={100} value={adjust.sharpness} onChange={set("sharpness")} />
          <Slider label="Clarity" min={-100} max={100} value={adjust.clarity} onChange={set("clarity")} />
          <Slider label="Vignette" min={-100} max={100} value={adjust.vignette} onChange={set("vignette")} />
          <Slider label="Blur" min={0} max={100} value={adjust.blur} onChange={set("blur")} />

          <button type="button" disabled={!changed}
            class="flex items-center justify-center gap-1.5 h-9 rounded-md border border-zinc-300 bg-transparent text-xs text-zinc-700 cursor-pointer hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => apply(current, NO_ADJUSTMENTS)}>
            <RotateCcw size={13} />Reset adjustments
          </button>
        </div>
      </div>
    );
  }

  const seeAll = (to: View) => (
    <button type="button" class="text-[11px] text-zinc-500 bg-transparent border-none p-0 cursor-pointer hover:text-zinc-900" onClick={() => setView(to)}>
      See all
    </button>
  );
  const tool = "flex flex-col items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer text-[11px] text-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed";
  const toolIcon = "w-12 h-12 rounded-full flex items-center justify-center border border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <div class="flex flex-col gap-5">
      <section>
        <h3 class="text-xs font-semibold text-zinc-700 mb-3 m-0">Tools</h3>
        <div class="grid grid-cols-3 gap-2">
          <button type="button" class={tool} onClick={() => setView("adjust")}>
            <span class={toolIcon}><SlidersHorizontal size={18} /></span>Adjust
          </button>
          {isPhoto && <button type="button" class={tool} disabled={cutoutBusy} onClick={() => removeBackground(false)}>
            <span class={toolIcon}><Scissors size={18} /></span>{cutoutBusy ? "Working…" : "BG Remover"}
          </button>}
          {isPhoto && <button type="button" class={tool} disabled={cutoutBusy && !linked} onClick={() => (linked ? removeTextBehind() : removeBackground(true))}>
            <span class={`${toolIcon} ${linked ? "border-accent text-accent bg-accent/10" : ""}`}><Layers size={18} /></span>
            {linked ? "Text behind: on" : "Text behind"}
          </button>}
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-xs font-semibold text-zinc-700 m-0">Filters</h3>
          {seeAll("filters")}
        </div>

        <div class="grid grid-cols-4 gap-2">
          <Tile label="None" thumb={thumbs.none} selected={!current} onClick={() => pick(null)} />
          {(currentLook && !featured.includes(currentLook) ? [currentLook, ...featured.slice(0, 2)] : featured).map((l) => (
            <Tile key={l.id} label={l.name} thumb={thumbs[l.id]} selected={current?.id === l.id} onClick={() => pick(l)} />
          ))}
        </div>
        {intensity}
      </section>

      <EffectsSection {...sectionProps(true)} />

      <EffectsSection {...sectionProps(false)} />

      {isShape && (
        <section>
          <h3 class="text-xs font-semibold text-zinc-700 mb-2 m-0">Background blur &amp; glass</h3>
          <Slider label="Background blur" min={0} max={60} value={Math.round(backdropBlurOf(img))}
            onChange={(v) => updateSelectedObject({ lumioBackdrop: v > 0 ? v : undefined })} />
          <p class="text-[10px] text-zinc-400 mt-1 mb-2">Blurs whatever is behind this shape. Use a see-through fill to show it.</p>
          <button type="button"
            class="w-full h-9 rounded-md border border-zinc-300 bg-transparent text-xs text-zinc-700 cursor-pointer hover:bg-zinc-100"
            onClick={() => {
              updateSelectedObject({
                lumioBackdrop: 16,
                fill: "rgba(255,255,255,0.16)",
                stroke: "rgba(255,255,255,0.6)",
                strokeWidth: 1.5,
                strokeUniform: true,
                shadow: new fabric.Shadow({ color: "rgba(0,0,0,0.25)", blur: 30, offsetX: 0, offsetY: 12 }),
              });
              if (!effects.some((e) => e.id === "noise")) {
                const def = findEffect("noise");
                if (def) setEffects([...effects, { id: "noise", values: { ...defaultValues(def), amount: 10 } }]);
              }
            }}>
            Make it glass
          </button>
        </section>
      )}

      <section>
        <h3 class="text-xs font-semibold text-zinc-700 mb-2 m-0">Shadows</h3>
        <div class="grid grid-cols-3 gap-2">
          {(["none", "glow", "drop"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={shadowKind === k}
              class={`flex flex-col items-center gap-1 bg-transparent border-none p-0 cursor-pointer text-[11px] text-zinc-600`}
              onClick={() => setShadow(k)}>
              <span class={`w-full aspect-square rounded-lg flex items-center justify-center border-2 ${shadowKind === k ? "border-accent" : "border-zinc-200"} bg-zinc-50`}>
                {k === "none"
                  ? <Ban size={18} class="text-zinc-400" />
                  : <span class="w-8 h-8 rounded-md bg-accent/40" style={{ boxShadow: k === "glow" ? "0 0 14px 4px rgba(167,139,250,0.9)" : "4px 6px 8px rgba(0,0,0,0.45)" }} />}
              </span>
              <span class="capitalize">{k}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
