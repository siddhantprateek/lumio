import { useEffect, useMemo, useState } from "preact/hooks";
import { h, render, type ComponentType } from "preact";
import { useEditor } from "../context";
import { DOODLES, DOODLE_GROUPS } from "../lib/doodles";
import { placeSvg } from "../lib/vector";

function usePlace() {
  const { canvas, canvasWidth, canvasHeight } = useEditor();
  return (svg: string, size?: number) => {
    if (!canvas) return;
    void placeSvg(canvas, svg, { width: canvasWidth, height: canvasHeight }, { size });
  };
}

/** Brush strokes, scribbles, sparkles and other drawn graphics. */
export function DoodlesGrid() {
  const place = usePlace();
  return (
    <>
      {DOODLE_GROUPS.map((group) => (
        <div key={group}>
          <p class="text-zinc-400 text-[11px] mt-4 mb-2">{group}</p>
          <div class="grid grid-cols-3 gap-1.5">
            {DOODLES.filter((d) => d.group === group).map((d) => (
              <button key={d.id} type="button" title={d.label} aria-label={`Add ${d.label.toLowerCase()}`}
                class="aspect-square p-2 flex items-center justify-center rounded-md bg-white border border-zinc-200 cursor-pointer hover:border-accent [&_svg]:w-full [&_svg]:h-full [&_svg]:max-h-full"
                onClick={() => place(d.svg)}
                // The tile draws the exact SVG that gets added.
                dangerouslySetInnerHTML={{ __html: d.svg.replace(/#111111/g, "currentColor") }}
                style={{ color: "var(--color-zinc-700)" }} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

type IconModule = Record<string, unknown>;

/** "ArrowBigRightDash" → "arrow big right dash", for searching. */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").toLowerCase();

/** SVG markup of a Lucide icon, with a real colour instead of currentColor. */
function iconSvg(Icon: ComponentType<Record<string, unknown>>) {
  const host = document.createElement("div");
  render(h(Icon, { size: 96, color: "#111111", strokeWidth: 2 }), host);
  const markup = host.innerHTML.replace(/currentColor/g, "#111111");
  render(null, host);
  return markup;
}

/** The full Lucide icon set (~1,500 line icons), searchable; loaded on first open. */
export function IconsBrowser() {
  const place = usePlace();
  const [mod, setMod] = useState<IconModule | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    import("lucide-preact").then((m) => setMod(m as unknown as IconModule)).catch(() => setError(true));
  }, []);

  const icons = useMemo(() => {
    if (!mod) return [];
    return Object.keys(mod)
      .filter((k) => /^[A-Z]/.test(k) && !k.startsWith("Lucide") && !k.endsWith("Icon") && typeof mod[k] === "function")
      .map((k) => ({ name: k, label: words(k) }));
  }, [mod]);

  const q = query.trim().toLowerCase();
  const matches = q ? icons.filter((i) => i.label.includes(q)) : icons;
  const shown = matches.slice(0, 120);

  return (
    <div>
      <p class="text-zinc-400 text-[11px] mt-4 mb-2">Icons</p>
      <input type="search" value={query} placeholder={icons.length ? `Search ${icons.length} icons…` : "Loading icons…"} aria-label="Search icons"
        class="w-full mb-2 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent"
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      {error && <p class="text-[11px] text-red-500">Icons could not be loaded.</p>}
      <div class="grid grid-cols-5 gap-1">
        {shown.map(({ name, label }) => {
          const Icon = mod![name] as ComponentType<Record<string, unknown>>;
          return (
            <button key={name} type="button" title={label} aria-label={`Add ${label} icon`}
              class="aspect-square flex items-center justify-center rounded-md bg-white border border-zinc-200 cursor-pointer text-zinc-600 hover:border-accent hover:text-accent"
              onClick={() => place(iconSvg(Icon), 160)}>
              <Icon size={20} />
            </button>
          );
        })}
      </div>
      {matches.length > shown.length && (
        <p class="text-[10px] text-zinc-400 mt-2 mb-0">Showing {shown.length} of {matches.length}. Type to narrow it down.</p>
      )}
      {q && matches.length === 0 && icons.length > 0 && <p class="text-[11px] text-zinc-400">No icons match “{query}”.</p>}
    </div>
  );
}
