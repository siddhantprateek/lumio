import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronDown, ChevronUp } from "lucide-preact";
import { useEditor } from "../context";
import { FONT_FAMILIES } from "../fonts";
import { fetchGoogleFonts, loadGoogleFont, type GoogleFont } from "../lib/google-fonts";

export function FontPicker({ value, onChange, label }: {
  value: string;
  onChange: (family: string) => void;
  label: string;
}) {
  const { customFonts, importFont } = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [google, setGoogle] = useState<GoogleFont[]>([]);
  const [loadingFamily, setLoadingFamily] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  useEffect(() => {
    if (!open || google.length) return;
    fetchGoogleFonts().then(setGoogle).catch(() => setCatalogError(true));
  }, [open]);

  const id = `font-options-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const fonts = [
    ...FONT_FAMILIES.map((family) => ({ family, name: family })),
    ...customFonts,
  ];
  const q = query.trim().toLowerCase();
  const shown = q ? fonts.filter((f) => f.name.toLowerCase().includes(q)) : fonts;
  const have = new Set(fonts.map((f) => f.family));
  const googleMatches = google.filter((f) => !have.has(f.family) && (!q || f.family.toLowerCase().includes(q)));

  const pickGoogle = async (font: GoogleFont) => {
    setLoadingFamily(font.family);
    setError(null);
    try {
      await loadGoogleFont(font);
      onChange(font.family);
      setOpen(false);
    } catch {
      setError(`Could not load ${font.family}. Check your connection.`);
    } finally {
      setLoadingFamily(null);
    }
  };

  const currentName = fonts.find((font) => font.family === value)?.name ?? value;

  return <div>
    <label class="text-[11px] text-zinc-400 mb-1 block">{label}</label>
    <button
      type="button"
      aria-label={`${label}: ${currentName}`}
      aria-expanded={open}
      aria-controls={id}
      class="w-full flex items-center justify-between bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none cursor-pointer focus:border-accent"
      onClick={() => setOpen(!open)}
    >
      <span style={{ fontFamily: value }}>{currentName}</span>
      {open ? <ChevronUp size={14} class="text-zinc-400" /> : <ChevronDown size={14} class="text-zinc-400" />}
    </button>
    {open && <div id={id} role="group" aria-label="Available fonts" class="mt-1 max-h-72 overflow-y-auto bg-white border border-zinc-200 rounded-md shadow-lg p-1">
      <input
        type="search"
        value={query}
        placeholder={google.length ? `Search ${google.length + fonts.length} fonts…` : "Search fonts…"}
        aria-label="Search fonts"
        class="w-full mb-1 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent"
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      {shown.map((font) => (
        <button
          key={font.family}
          type="button"
          aria-pressed={value === font.family}
          class={`w-full flex items-center justify-between gap-3 text-left px-2 py-1.5 rounded cursor-pointer ${value === font.family ? "bg-accent/10 text-accent" : "bg-transparent text-zinc-700 hover:bg-zinc-50"}`}
          onClick={() => { onChange(font.family); setOpen(false); }}
        >
          <span class="truncate" style={{ fontFamily: font.family }}>{font.name}</span>
          <span class="shrink-0 text-sm" style={{ fontFamily: font.family }}>Aa 123</span>
        </button>
      ))}
      {googleMatches.length > 0 && <p class="text-[10px] uppercase tracking-wider text-zinc-400 px-2 pt-2 pb-1">Google Fonts</p>}
      {googleMatches.slice(0, 80).map((font) => (
        <button
          key={font.id}
          type="button"
          disabled={loadingFamily !== null}
          aria-pressed={value === font.family}
          class={`w-full flex items-center justify-between gap-3 text-left px-2 py-1.5 rounded cursor-pointer disabled:opacity-50 ${value === font.family ? "bg-accent/10 text-accent" : "bg-transparent text-zinc-700 hover:bg-zinc-50"}`}
          onClick={() => pickGoogle(font)}
        >
          <span class="truncate">{font.family}</span>
          <span class="shrink-0 text-[10px] text-zinc-400">{loadingFamily === font.family ? "Loading…" : font.category}</span>
        </button>
      ))}
      {googleMatches.length > 80 && <p class="text-[10px] text-zinc-400 px-2 py-1">Showing 80 of {googleMatches.length}. Type to narrow.</p>}
      {catalogError && <p class="text-[10px] text-zinc-400 px-2 py-1">Google Fonts could not be loaded (offline?).</p>}
    </div>}
    <button
      type="button"
      disabled={busy}
      class="mt-1 text-[11px] text-accent bg-transparent border-none cursor-pointer disabled:opacity-50"
      onClick={() => input.current?.click()}
    >{busy ? "Importing…" : "Import font from computer…"}</button>
    <input
      ref={input}
      type="file"
      accept=".ttf,.otf,.woff,.woff2"
      class="hidden"
      aria-label={`Import ${label.toLowerCase()}`}
      onChange={async (e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!file) return;
        setBusy(true);
        setError(null);
        try {
          onChange(await importFont(file));
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not import the font.");
        } finally {
          setBusy(false);
        }
      }}
    />
    {error && <p role="alert" class="text-[11px] text-red-500 mt-1">{error}</p>}
  </div>;
}
