import { ensureCanvasFonts } from "../lib/google-fonts";
import { OPEN_CONTEXT_MENU, type ContextMenuDetail } from "./object-context-menu";
import { IMPORT_EVENT, readDataTransfer, type ImportDetail } from "../lib/clipboard-import";
import { useRef, useEffect, useState } from "preact/hooks";
import * as fabric from "fabric";
import { useEditor } from "../context";
import type { Page } from "../types";

/** True for the lowest element when it is a shape or image covering (almost) the whole page. */
function isBackdrop(canvas: fabric.Canvas, obj: fabric.FabricObject, width: number, height: number) {
  if (canvas.getObjects()[0] !== obj) return false;
  if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) return false;
  obj.setCoords();
  const pts = Object.values(obj.aCoords);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const slack = 4;
  return minX <= slack && minY <= slack && maxX >= width - slack && maxY >= height - slack;
}

interface PageCanvasProps {
  page: Page;
  isActive: boolean;
  width: number;
  height: number;
  onActivate: () => void;
}

export function PageCanvas({ page, isActive, width, height, onActivate }: PageCanvasProps) {
  const { registerCanvas, unregisterCanvas } = useEditor();
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  // Read by listeners registered once at mount, so they see the current size after a resize.
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  useEffect(() => {
    if (!canvasElRef.current || fabricRef.current) return;

    const c = new fabric.Canvas(canvasElRef.current, {
      width,
      height,
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selection: true,
      controlsAboveOverlay: true,
    });

    // Retina rendering
    const dpr = window.devicePixelRatio || 1;
    c.setDimensions({ width: width * dpr, height: height * dpr }, { cssOnly: false });
    c.setDimensions({ width, height }, { cssOnly: true });
    c.setViewportTransform([dpr, 0, 0, dpr, 0, 0]);

    // Custom control appearance — applied per-object via object:added
    const CONTROL_STYLE = {
      transparentCorners: false,
      borderColor: "#6366f1",
      borderScaleFactor: 1.5,
      padding: 6,
      cornerSize: 14,
      cornerColor: "#ffffff",
      cornerStrokeColor: "#6366f1",
      cornerStyle: "circle" as const,
    };

    // Custom render for corner controls (white circles with accent stroke)
    const renderCircleCorner = (
      ctx: CanvasRenderingContext2D,
      left: number,
      top: number,
      _styleOverride: unknown,
      _fabricObject: fabric.FabricObject,
    ) => {
      const size = 14;
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    // Custom render for side controls (rounded pill handles)
    const renderPillControl = (horizontal: boolean) => {
      return (
        ctx: CanvasRenderingContext2D,
        left: number,
        top: number,
        _styleOverride: unknown,
        _fabricObject: fabric.FabricObject,
      ) => {
        const w = horizontal ? 28 : 8;
        const h = horizontal ? 8 : 28;
        ctx.save();
        ctx.translate(left, top);
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, 4);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
    };

    // Apply custom controls to an object
    const applyCustomControls = (obj: fabric.FabricObject) => {
      obj.set(CONTROL_STYLE);
      // Override corner renders
      if (obj.controls) {
        for (const key of ["tl", "tr", "bl", "br"]) {
          if (obj.controls[key]) {
            obj.controls[key].render = renderCircleCorner;
            obj.controls[key].sizeX = 18;
            obj.controls[key].sizeY = 18;
          }
        }
        for (const key of ["mt", "mb"]) {
          if (obj.controls[key]) {
            obj.controls[key].render = renderPillControl(true);
            obj.controls[key].sizeX = 32;
            obj.controls[key].sizeY = 12;
          }
        }
        for (const key of ["ml", "mr"]) {
          if (obj.controls[key]) {
            obj.controls[key].render = renderPillControl(false);
            obj.controls[key].sizeX = 12;
            obj.controls[key].sizeY = 32;
          }
        }
      }
    };

    // Apply to all existing objects
    c.getObjects().forEach(applyCustomControls);

    // Apply to any newly added objects
    c.on("object:added", (e) => {
      if (e.target) applyCustomControls(e.target);
    });

    // Load page content
    if (page.canvas_json && page.canvas_json !== "{}") {
      try {
        c.loadFromJSON(JSON.parse(page.canvas_json)).then(() => {
          c.requestRenderAll();
          void ensureCanvasFonts(c);
        });
      } catch {
        // ignore parse errors
      }
    }

    // On mouse down, activate this canvas (use ref to avoid stale closure)
    c.on("mouse:down", () => onActivateRef.current());

    // Right-click: select what is under the pointer and open the element menu.
    // `fireRightClick` makes Fabric resolve the target for us; `stopContextMenu`
    // hides the browser's own menu.
    c.fireRightClick = true;
    c.stopContextMenu = true;
    c.on("mouse:down", (opt) => {
      const e = opt.e as MouseEvent;
      if (e.button !== 2) return;
      const hit = opt.target ?? null;
      // A bottom-layer shape filling the whole page is the page's backdrop
      // (templates draw their background that way): show the page menu.
      const backdrop = hit && isBackdrop(c, hit, sizeRef.current.width, sizeRef.current.height) ? hit : null;
      const target = backdrop ? null : hit;
      if (target && c.getActiveObject() !== target) c.setActiveObject(target);
      if (!target) c.discardActiveObject();
      c.requestRenderAll();
      window.dispatchEvent(new CustomEvent<ContextMenuDetail>(OPEN_CONTEXT_MENU, {
        detail: { x: e.clientX, y: e.clientY, canvas: c, target, backdrop },
      }));
    });

    fabricRef.current = c;
    registerCanvas(page.id, c);

    return () => {
      unregisterCanvas(page.id);
      c.dispose();
      fabricRef.current = null;
    };
  }, []);

  // Drop images, image links or text from the desktop or another tab.
  const [dropping, setDropping] = useState(false);
  const accepts = (dt: DataTransfer | null) =>
    !!dt && Array.from(dt.types).some((t) => t === "Files" || t === "text/uri-list" || t === "text/html" || t === "text/plain");

  return (
    <div
      class={`shadow-lg rounded-lg overflow-hidden ${isActive ? "ring-2 ring-[#6366f1]" : ""} ${dropping ? "outline outline-4 outline-[#6366f1] outline-offset-4" : ""}`}
      style={{ width, height }}
      onDragOver={(e) => {
        if (!accepts(e.dataTransfer)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        const item = readDataTransfer(e.dataTransfer);
        if (!item || item.kind === "element") return;
        e.preventDefault();
        onActivateRef.current();
        // Client pixels → page units (the page is CSS-scaled by the zoom).
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const at = {
          x: ((e.clientX - rect.left) / rect.width) * width,
          y: ((e.clientY - rect.top) / rect.height) * height,
        };
        // Let the page become active before the bridge places the item on it.
        requestAnimationFrame(() =>
          window.dispatchEvent(new CustomEvent<ImportDetail>(IMPORT_EVENT, { detail: { item, at, canvas: fabricRef.current ?? undefined } })),
        );
      }}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
}
