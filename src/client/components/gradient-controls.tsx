import { GRADIENT_PRESETS, specToCss, type GradientSpec } from "../lib/gradient";

// Checkerboard under the preview so a transparent end is visible.
const CHECKER =
  "repeating-conic-gradient(#d4d4d8 0% 25%, #ffffff 0% 50%) 0 0 / 10px 10px";

function StopOpacity({ label, value, color, onChange }: {
  label: string; value: number; color: string; onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <label class="text-[11px] text-zinc-400 mb-1 flex justify-between items-center">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-2.5 h-2.5 rounded-sm border border-zinc-300" style={{ background: color }} />
          {label}
        </span>
        <span class="font-mono">{pct}%</span>
      </label>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        aria-label={label}
        class="w-full accent-accent"
        value={pct}
        onInput={(e) => onChange(parseInt((e.target as HTMLInputElement).value) / 100)}
      />
    </div>
  );
}

/**
 * Two colours, an opacity for each end, an angle and a row of presets. Used
 * for backgrounds, text and shapes.
 */
export function GradientControls({ spec, onChange }: { spec: GradientSpec; onChange: (spec: GradientSpec) => void }) {
  const fromOpacity = spec.fromOpacity ?? 1;
  const toOpacity = spec.toOpacity ?? 1;
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <input
          type="color"
          aria-label="Gradient start colour"
          class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
          value={spec.from}
          onInput={(e) => onChange({ ...spec, from: (e.target as HTMLInputElement).value })}
        />
        <div class="flex-1 h-8 rounded border border-zinc-300 overflow-hidden" style={{ background: CHECKER }}>
          <div class="w-full h-full" style={{ background: specToCss({ ...spec, angle: 90 }) }} />
        </div>
        <input
          type="color"
          aria-label="Gradient end colour"
          class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
          value={spec.to}
          onInput={(e) => onChange({ ...spec, to: (e.target as HTMLInputElement).value })}
        />
      </div>
      <button
        type="button"
        class="self-start text-[11px] text-accent bg-transparent border-none cursor-pointer p-0"
        onClick={() => onChange({ ...spec, from: spec.to, to: spec.from, fromOpacity: toOpacity, toOpacity: fromOpacity })}
      >Swap colours</button>
      <StopOpacity label="Start opacity" color={spec.from} value={fromOpacity} onChange={(v) => onChange({ ...spec, fromOpacity: v })} />
      <StopOpacity label="End opacity" color={spec.to} value={toOpacity} onChange={(v) => onChange({ ...spec, toOpacity: v })} />
      <label class="text-[11px] text-zinc-400 flex justify-between">
        Angle<span class="font-mono">{spec.angle}°</span>
      </label>
      <input
        type="range"
        min="0"
        max="360"
        step="5"
        aria-label="Gradient angle"
        class="w-full accent-accent"
        value={spec.angle}
        onInput={(e) => onChange({ ...spec, angle: parseInt((e.target as HTMLInputElement).value) })}
      />
      <div class="grid grid-cols-8 gap-1">
        {GRADIENT_PRESETS.map((preset, i) => (
          <button
            key={i}
            type="button"
            title="Gradient preset"
            aria-label={`Gradient preset ${i + 1}`}
            class="aspect-square rounded border border-zinc-300 cursor-pointer hover:scale-110 hover:border-accent transition-all overflow-hidden"
            style={{ background: CHECKER }}
            onClick={() => onChange(preset)}
          >
            <span class="block w-full h-full" style={{ background: specToCss(preset) }} />
          </button>
        ))}
      </div>
    </div>
  );
}
