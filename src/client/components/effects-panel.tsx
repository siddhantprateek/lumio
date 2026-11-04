import { useEffect, useState } from "preact/hooks";
import * as fabric from "fabric";
import { ArrowLeft, Eye, EyeOff, Plus, RotateCcw, Shuffle, SlidersHorizontal, Trash2, X } from "lucide-preact";
import {
  EFFECTS,
  EFFECT_CATEGORIES,
  defaultValues,
  findEffect,
  renderEffectPreview,
  type EffectDef,
  type EffectState,
  type ParamDef,
} from "../lib/effects";
import { previewSource } from "../lib/image-filters";

/** Small previews of the selected picture through every effect, built in batches. */
export function useEffectPreviews(img: fabric.FabricObject) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const src = img instanceof fabric.FabricImage ? img.getSrc() : img;
  useEffect(() => {
    setThumbs({});
    // Flat shapes and plain backgrounds preview on a sample picture instead.
    const data = previewSource(img, 120);
    const source = document.createElement("canvas");
    source.width = data.width;
    source.height = data.height;
    source.getContext("2d")!.putImageData(data, 0, 0);
    let i = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const batch: Record<string, string> = {};
      for (const end = Math.min(i + 3, EFFECTS.length); i < end; i++) {
        try {
          batch[EFFECTS[i].id] = renderEffectPreview(source, EFFECTS[i]);
        } catch {
          // A preview failing should not stop the rest.
        }
      }
      setThumbs((prev) => ({ ...prev, ...batch }));
      if (i < EFFECTS.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => {
      cancelled = true;
    };
  }, [src]);
  return thumbs;
}

function Thumb({ def, thumb, active, onClick }: { def: EffectDef; thumb?: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" title={def.name} aria-pressed={active}
      class="flex flex-col items-center gap-1 bg-transparent border-none p-0 cursor-pointer group" onClick={onClick}>
      <span class={`relative w-full aspect-square rounded-lg overflow-hidden border-2 ${active ? "border-accent" : "border-transparent group-hover:border-zinc-300"}`}>
        {thumb ? <img src={thumb} alt="" class="w-full h-full object-cover block" /> : <span class="block w-full h-full bg-zinc-100 animate-pulse" />}
      </span>
      <span class="text-[11px] text-zinc-600 truncate max-w-full">{def.name}</span>
    </button>
  );
}

/** Every effect by category. Clicking one adds it to the image and opens its controls. */
export function EffectsGallery({ img, effects, onAdd, onOpen, onBack }: {
  img: fabric.FabricObject;
  effects: EffectState[];
  onAdd: (id: string) => void;
  onOpen: (index: number) => void;
  onBack: () => void;
}) {
  const thumbs = useEffectPreviews(img);
  return (
    <div>
      <button type="button" class="flex items-center gap-1.5 mb-3 bg-transparent border-none p-0 text-sm font-semibold text-zinc-800 cursor-pointer" onClick={onBack}>
        <ArrowLeft size={16} />Effects
      </button>
      <p class="text-[11px] text-zinc-500 mb-3 m-0">Click an effect to add it. Effects stack, and each has its own settings.</p>
      {EFFECT_CATEGORIES.map((cat) => (
        <section key={cat} class="mb-4">
          <h3 class="text-xs font-semibold text-zinc-700 mb-2 m-0">{cat}</h3>
          <div class="grid grid-cols-3 gap-2">
            {EFFECTS.filter((e) => e.category === cat).map((def) => {
              const index = effects.findIndex((e) => e.id === def.id);
              return <Thumb key={def.id} def={def} thumb={thumbs[def.id]} active={index >= 0}
                onClick={() => (index >= 0 ? onOpen(index) : onAdd(def.id))} />;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ParamControl({ param, value, onChange }: { param: ParamDef; value: number | string; onChange: (v: number | string) => void }) {
  if (param.kind === "color") {
    return (
      <div class="flex items-center justify-between">
        <label class="text-xs text-zinc-600">{param.label}</label>
        <input type="color" aria-label={param.label} value={String(value)}
          class="w-10 h-7 rounded border border-zinc-300 cursor-pointer bg-transparent"
          onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
      </div>
    );
  }
  if (param.kind === "select") {
    return (
      <div>
        <label class="text-xs text-zinc-600 mb-1 block">{param.label}</label>
        <div class="flex flex-wrap gap-1" role="group" aria-label={param.label}>
          {param.options!.map((o) => (
            <button key={o.value} type="button" aria-pressed={Number(value) === o.value}
              class={`px-2 py-1 rounded-md border text-[11px] cursor-pointer ${Number(value) === o.value ? "bg-accent/15 border-accent text-accent" : "bg-transparent border-zinc-300 text-zinc-600 hover:text-zinc-900"}`}
              onClick={() => onChange(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>
    );
  }
  const n = Number(value);
  const step = param.step ?? 1;
  const decimals = step < 1 ? (String(step).split(".")[1]?.length ?? 1) : 0;
  return (
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-xs text-zinc-600">{param.label}</label>
        <span class="flex items-center gap-1">
          <input type="number" aria-label={`${param.label} value`} min={param.min} max={param.max} step={step} value={n.toFixed(decimals)}
            class="w-14 text-center text-[11px] bg-white border border-zinc-300 rounded px-1 py-0.5 text-zinc-700 outline-none focus:border-accent"
            onChange={(e) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              if (Number.isFinite(v)) onChange(Math.max(param.min!, Math.min(param.max!, v)));
            }} />
          {param.unit && <span class="text-[10px] text-zinc-400 w-3">{param.unit}</span>}
        </span>
      </div>
      <input type="range" aria-label={param.label} min={param.min} max={param.max} step={step} value={n} class="w-full accent-accent"
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))} />
    </div>
  );
}

/** One applied effect's full controls. */
export function EffectDetail({ effect, onChange, onRemove, onBack }: {
  effect: EffectState;
  onChange: (next: EffectState) => void;
  onRemove: () => void;
  onBack: () => void;
}) {
  const def = findEffect(effect.id);
  if (!def) return null;
  const hasSeed = def.params.some((p) => p.key === "seed");
  const enabled = effect.enabled !== false;
  return (
    <div>
      <div class="flex items-center justify-between mb-3">
        <button type="button" class="flex items-center gap-1.5 bg-transparent border-none p-0 text-sm font-semibold text-zinc-800 cursor-pointer" onClick={onBack}>
          <ArrowLeft size={16} />{def.name}
        </button>
        <button type="button" title={enabled ? "Hide effect" : "Show effect"} aria-label={enabled ? "Hide effect" : "Show effect"}
          class="p-1 rounded bg-transparent border-none text-zinc-500 cursor-pointer hover:text-zinc-900"
          onClick={() => onChange({ ...effect, enabled: !enabled })}>
          {enabled ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
      </div>
      <div class={`flex flex-col gap-4 ${enabled ? "" : "opacity-50"}`}>
        {def.params.map((p) => (
          <ParamControl key={p.key} param={p} value={effect.values[p.key] ?? p.default}
            onChange={(v) => onChange({ ...effect, values: { ...effect.values, [p.key]: v } })} />
        ))}
      </div>
      <div class="grid grid-cols-2 gap-2 mt-5">
        {hasSeed && (
          <button type="button" class="col-span-2 flex items-center justify-center gap-1.5 h-9 rounded-md border border-zinc-300 bg-transparent text-xs text-zinc-700 cursor-pointer hover:bg-zinc-100"
            onClick={() => onChange({ ...effect, values: { ...effect.values, seed: Math.round(Math.random() * 100) } })}>
            <Shuffle size={13} />Shuffle variation
          </button>
        )}
        <button type="button" class="flex items-center justify-center gap-1.5 h-9 rounded-md border border-zinc-300 bg-transparent text-xs text-zinc-700 cursor-pointer hover:bg-zinc-100"
          onClick={() => onChange({ ...effect, values: defaultValues(def) })}>
          <RotateCcw size={13} />Reset
        </button>
        <button type="button" class="flex items-center justify-center gap-1.5 h-9 rounded-md border border-zinc-300 bg-transparent text-xs text-red-500 cursor-pointer hover:bg-red-500/10"
          onClick={onRemove}>
          <Trash2 size={13} />Remove
        </button>
      </div>
    </div>
  );
}

/** The Effects block on the main Edit image screen: what is applied, plus Add. */
const FEATURED = ["grain", "light-leak", "halftone", "vhs", "rgb-split", "bloom"];

export function EffectsSection({ img, effects, onSeeAll, onAdd, onClear, onOpen, onToggle, onRemove }: {
  img: fabric.FabricObject;
  effects: EffectState[];
  onSeeAll: () => void;
  onAdd: (id: string) => void;
  onClear: () => void;
  onOpen: (index: number) => void;
  onToggle: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section>
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-zinc-700 m-0">Effects</h3>
        <button type="button" class="text-[11px] text-zinc-500 bg-transparent border-none p-0 cursor-pointer hover:text-zinc-900" onClick={onSeeAll}>See all</button>
      </div>
      {/* Like the Filters row: None, then what is applied, then popular picks. */}
      <EffectTiles img={img} effects={effects} onAdd={onAdd} onOpen={onOpen} onClear={onClear} />
      {effects.length > 0 && (
        <ul class="list-none m-0 p-0 mt-3 mb-2 flex flex-col gap-1">
          {effects.map((e, i) => {
            const def = findEffect(e.id);
            if (!def) return null;
            const on = e.enabled !== false;
            return (
              <li key={`${e.id}-${i}`} class="flex items-center gap-2 px-2 py-1.5 rounded-md border border-zinc-200">
                <button type="button" class={`flex-1 flex items-center gap-2 text-left text-xs bg-transparent border-none p-0 cursor-pointer ${on ? "text-zinc-700" : "text-zinc-400 line-through"}`}
                  onClick={() => onOpen(i)}>
                  <SlidersHorizontal size={13} class="text-zinc-400" />{def.name}
                </button>
                <button type="button" title={on ? "Hide" : "Show"} aria-label={`${on ? "Hide" : "Show"} ${def.name}`}
                  class="p-0.5 rounded bg-transparent border-none text-zinc-400 cursor-pointer hover:text-zinc-900" onClick={() => onToggle(i)}>
                  {on ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button type="button" title="Remove" aria-label={`Remove ${def.name}`}
                  class="p-0.5 rounded bg-transparent border-none text-zinc-400 cursor-pointer hover:text-red-500" onClick={() => onRemove(i)}>
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EffectTiles({ img, effects, onAdd, onOpen, onClear }: {
  img: fabric.FabricObject;
  effects: EffectState[];
  onAdd: (id: string) => void;
  onOpen: (index: number) => void;
  onClear: () => void;
}) {
  const thumbs = useEffectPreviews(img);
  const none = useNonePreview(img);
  const applied = effects.map((e) => e.id);
  const ids = [...new Set([...applied, ...FEATURED])].slice(0, 3);
  return (
    <div class="grid grid-cols-4 gap-2">
      <button type="button" title="No effects" aria-pressed={effects.length === 0}
        class="flex flex-col items-center gap-1 bg-transparent border-none p-0 cursor-pointer group" onClick={onClear}>
        <span class={`w-full aspect-square rounded-lg overflow-hidden border-2 ${effects.length === 0 ? "border-accent" : "border-transparent group-hover:border-zinc-300"}`}>
          {none ? <img src={none} alt="" class="w-full h-full object-cover block" /> : <span class="block w-full h-full bg-zinc-100" />}
        </span>
        <span class="text-[11px] text-zinc-600">None</span>
      </button>
      {ids.map((id) => {
        const def = findEffect(id);
        if (!def) return null;
        const index = effects.findIndex((e) => e.id === id);
        return <Thumb key={id} def={def} thumb={thumbs[id]} active={index >= 0} onClick={() => (index >= 0 ? onOpen(index) : onAdd(id))} />;
      })}
    </div>
  );
}

/** The picture with no effects, for the "None" tile. */
function useNonePreview(img: fabric.FabricObject) {
  const [url, setUrl] = useState<string | null>(null);
  const src = img instanceof fabric.FabricImage ? img.getSrc() : img;
  useEffect(() => {
    const data = previewSource(img, 120);
    const c = document.createElement("canvas");
    c.width = data.width;
    c.height = data.height;
    c.getContext("2d")!.putImageData(data, 0, 0);
    setUrl(c.toDataURL("image/jpeg", 0.8));
  }, [src]);
  return url;
}
