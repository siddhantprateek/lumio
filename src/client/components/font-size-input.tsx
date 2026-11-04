import { useState } from "preact/hooks";
import { ChevronDown, Minus, Plus } from "lucide-preact";

export const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 120, 144, 200];
const MIN = 1;
const MAX = 800;

/** Size field with − / + steppers and a list of common sizes. */
export function FontSizeInput({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  const [open, setOpen] = useState(false);
  const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n)));
  const step = (dir: 1 | -1) => {
    const next = dir === 1 ? FONT_SIZES.find((s) => s > value) : [...FONT_SIZES].reverse().find((s) => s < value);
    onChange(clamp(next ?? value + dir));
  };

  return (
    <div class="relative">
      <label class="text-[11px] text-zinc-400 mb-1 block">Font size</label>
      <div class="flex items-stretch gap-1">
        <button type="button" aria-label="Decrease font size" class="px-2 rounded-md border border-zinc-300 bg-white text-zinc-500 cursor-pointer hover:text-zinc-900" onClick={() => step(-1)}>
          <Minus size={12} />
        </button>
        <input
          type="number"
          min={MIN}
          max={MAX}
          aria-label="Font size"
          class="w-full min-w-0 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent text-center"
          value={value}
          onInput={(e) => {
            const n = parseInt((e.target as HTMLInputElement).value);
            if (n >= MIN) onChange(clamp(n));
          }}
        />
        <button type="button" aria-label="Increase font size" class="px-2 rounded-md border border-zinc-300 bg-white text-zinc-500 cursor-pointer hover:text-zinc-900" onClick={() => step(1)}>
          <Plus size={12} />
        </button>
        <button
          type="button"
          aria-label="Common font sizes"
          aria-expanded={open}
          class="px-2 rounded-md border border-zinc-300 bg-white text-zinc-500 cursor-pointer hover:text-zinc-900"
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={12} />
        </button>
      </div>
      {open && (
        <div role="listbox" aria-label="Common font sizes" class="absolute z-20 right-0 mt-1 w-24 max-h-56 overflow-y-auto bg-white border border-zinc-200 rounded-md shadow-lg p-1">
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="option"
              aria-selected={size === value}
              class={`w-full text-left px-2 py-1 rounded text-xs cursor-pointer ${size === value ? "bg-accent/10 text-accent" : "bg-transparent text-zinc-700 hover:bg-zinc-50"}`}
              onClick={() => { onChange(size); setOpen(false); }}
            >{size}</button>
          ))}
        </div>
      )}
    </div>
  );
}
