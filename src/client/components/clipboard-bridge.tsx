import { useEffect, useRef, useState } from "preact/hooks";
import * as fabric from "fabric";
import { useEditor } from "../context";
import { hasClipboard, pasteObject } from "../lib/object-actions";
import {
  IMPORT_EVENT,
  importImageUrl,
  readDataTransfer,
  uploadImageBlob,
  type ImportDetail,
  type Incoming,
} from "../lib/clipboard-import";
import { placeSvg } from "../lib/vector";

/**
 * Black or white, whichever reads better on the page: judged from the bottom
 * shape when it fills the page (how templates paint backgrounds), else the
 * page's own background colour.
 */
function readableOn(canvas: fabric.Canvas): string {
  const bottom = canvas.getObjects()[0];
  const zoom = canvas.viewportTransform[0] || 1;
  const fillsPage = !!bottom
    && bottom.getScaledWidth() >= (canvas.getWidth() / zoom) * 0.95
    && bottom.getScaledHeight() >= (canvas.getHeight() / zoom) * 0.95;
  const candidates = [fillsPage ? bottom.fill : undefined, canvas.backgroundColor];
  for (const value of candidates) {
    if (typeof value !== "string" || !value) continue;
    const [r, g, b] = new fabric.Color(value).getSource();
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5 ? "#ffffff" : "#000000";
  }
  return "#000000";
}

function isTypingTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
}

/**
 * Puts outside content on the active page: Ctrl+V / Cmd+V anywhere in the
 * editor, drops onto a page, and the page menu's Paste. Shows a short status
 * while an image uploads and says why when something cannot be added.
 */
export function ClipboardBridge() {
  const { canvas, addImage, canvasWidth, canvasHeight } = useEditor();
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ canvas, addImage, canvasWidth, canvasHeight });
  latest.current = { canvas, addImage, canvasWidth, canvasHeight };

  const flash = (text: string, error = false) => {
    window.clearTimeout(timer.current);
    setStatus({ text, error });
    timer.current = window.setTimeout(() => setStatus(null), error ? 4000 : 1500);
  };

  const place = async (item: Incoming, at?: { x: number; y: number }, target?: fabric.Canvas) => {
    const { addImage, canvasWidth, canvasHeight } = latest.current;
    const canvas = target ?? latest.current.canvas;
    if (!canvas) return;
    try {
      if (item.kind === "element") {
        if (hasClipboard()) await pasteObject(canvas);
        return;
      }
      if (item.kind === "text") {
        const width = Math.min(800, canvasWidth * 0.8);
        const text = new fabric.Textbox(item.text.slice(0, 5000), {
          width,
          fontSize: 40,
          fontFamily: "Inter",
          fill: readableOn(canvas),
          textAlign: "center",
        });
        const cx = at?.x ?? canvasWidth / 2;
        const cy = at?.y ?? canvasHeight / 2;
        text.set({ left: cx - width / 2, top: cy - (text.height ?? 0) / 2 });
        canvas.add(text);
        canvas.setActiveObject(text);
        canvas.requestRenderAll();
        return;
      }
      // Pasted or dropped SVG files become editable vectors.
      if (item.kind === "image-file" && item.file.type === "image/svg+xml") {
        await placeSvg(canvas, await item.file.text(), { width: canvasWidth, height: canvasHeight }, { at });
        return;
      }
      setStatus({ text: "Adding image…" });
      const url = item.kind === "image-file" ? await uploadImageBlob(item.file) : await importImageUrl(item.url);
      await addImage(url, at);
      setStatus(null);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not add that.", true);
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const active = latest.current.canvas?.getActiveObject() as fabric.Textbox | undefined;
      if (active?.isEditing) return;
      const item = readDataTransfer(e.clipboardData);
      if (!item) {
        // Nothing usable from outside: fall back to Lumio's own clipboard.
        if (hasClipboard()) {
          e.preventDefault();
          void place({ kind: "element" });
        }
        return;
      }
      e.preventDefault();
      void place(item);
    };
    const onImport = (e: Event) => {
      const { item, at, canvas } = (e as CustomEvent<ImportDetail>).detail;
      void place(item, at, canvas);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener(IMPORT_EVENT, onImport);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener(IMPORT_EVENT, onImport);
    };
  }, []);

  if (!status) return null;
  return (
    <div role="status" aria-live="polite"
      class={`fixed bottom-16 left-1/2 -translate-x-1/2 z-50 px-3 py-2 rounded-lg shadow-lg text-xs ${status.error ? "bg-[#dc2626] text-[#ffffff]" : "bg-[#18181b] text-[#fafafa]"}`}>
      {status.text}
    </div>
  );
}
