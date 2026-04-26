import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import Glyph from "./ui/Glyph";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;
const DEFAULT_ZOOM = 1.0;
const PAGE_PADDING = 32; // matches the 16px padding on the scroll container, both sides

/**
 * Custom PDF preview rendered via pdf.js so we get:
 *  - Real selectable text (canvas + text-layer overlay), no browser PDF chrome.
 *  - Our own zoom controls (no dependency on the browser's PDF viewer).
 *  - Fullscreen mode via the Fullscreen API.
 * We render every page (resumes are usually 1 page but variants might grow).
 */
export default function PdfPreview({ pdfBlob }: { pdfBlob: Blob | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const pagesInnerRef = useRef<HTMLDivElement>(null);
  const pageNativeWidthRef = useRef<number | null>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  // zoom = the user-facing target scale; renderedZoom = the scale the canvases
  // were last rasterized at. While they differ we apply a CSS transform on the
  // pages wrapper so dragging cmd+wheel feels smooth, then re-rasterize on
  // idle for crisp text.
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [renderedZoom, setRenderedZoom] = useState(DEFAULT_ZOOM);
  const [autoFit, setAutoFit] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  // Compute the zoom that fits the current page width inside the scroll
  // container. Returns null if we don't yet know the native page width.
  const computeFitZoom = useCallback(() => {
    const node = pagesRef.current;
    const w = pageNativeWidthRef.current;
    if (!node || !w) return null;
    const available = node.clientWidth - PAGE_PADDING;
    if (available <= 0) return null;
    return clampZoom(available / w);
  }, []);

  const setUserZoom = useCallback((updater: (z: number) => number) => {
    setAutoFit(false);
    setZoom((z) => clampZoom(updater(z)));
  }, []);

  // Trackpad pinch-zoom on macOS sends ctrlKey=true wheel events; the same
  // works for Ctrl/Cmd + scroll on a regular mouse. We hook them on the scroll
  // container so it works in both windowed and fullscreen modes.
  useEffect(() => {
    const node = pagesRef.current;
    if (!node) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setAutoFit(false);
      // deltaY > 0 means scrolling down / pinch-in; sensitivity tuned by /200.
      setZoom((z) => clampZoom(+(z * (1 - e.deltaY / 200)).toFixed(3)));
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [pdfBlob, error]);

  // Two-finger pinch on touchscreens: track the distance between the two
  // pointers and scale zoom proportionally. Uses Pointer Events for
  // cross-browser support.
  useEffect(() => {
    const node = pagesRef.current;
    if (!node) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let startDist = 0;
    let startZoom = zoom;

    function distance() {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return 0;
      const [a, b] = pts;
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    function onDown(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        startDist = distance();
        startZoom = zoom;
      }
    }
    function onMove(e: PointerEvent) {
      if (e.pointerType !== "touch" || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && startDist > 0) {
        e.preventDefault();
        const ratio = distance() / startDist;
        setAutoFit(false);
        setZoom(clampZoom(+(startZoom * ratio).toFixed(3)));
      }
    }
    function onUp(e: PointerEvent) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) startDist = 0;
    }
    node.addEventListener("pointerdown", onDown);
    node.addEventListener("pointermove", onMove, { passive: false });
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
    node.addEventListener("pointerleave", onUp);
    return () => {
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      node.removeEventListener("pointerleave", onUp);
    };
  }, [zoom, pdfBlob, error]);

  // Load the document whenever the blob changes.
  useEffect(() => {
    if (!pdfBlob) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    let loaded: pdfjs.PDFDocumentProxy | null = null;
    (async () => {
      try {
        const buf = await pdfBlob.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        loaded = pdf;
        setDoc(pdf);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load PDF");
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) loaded.destroy();
    };
  }, [pdfBlob]);

  // Capture the natural page width (at scale=1) so we can compute fit-to-width.
  useEffect(() => {
    if (!doc) {
      pageNativeWidthRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(1);
      if (cancelled) return;
      pageNativeWidthRef.current = page.getViewport({ scale: 1 }).width;
      if (autoFit) {
        const fit = computeFitZoom();
        if (fit != null) {
          setZoom(fit);
          setRenderedZoom(fit);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, autoFit, computeFitZoom]);

  // Refit on container resize while in autoFit mode.
  useEffect(() => {
    const node = pagesRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      if (!autoFit) return;
      const fit = computeFitZoom();
      if (fit != null) {
        setZoom(fit);
        setRenderedZoom(fit);
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [autoFit, computeFitZoom]);

  // Debounce rasterization: while the user is mid-zoom, only the CSS transform
  // updates (cheap, GPU-accelerated). Once they stop briefly, snap renderedZoom
  // to the target and re-rasterize so text stays crisp.
  useEffect(() => {
    if (zoom === renderedZoom) return;
    const t = setTimeout(() => setRenderedZoom(zoom), 140);
    return () => clearTimeout(t);
  }, [zoom, renderedZoom]);

  // Render all pages on doc/zoom change.
  useEffect(() => {
    if (!doc || !pagesInnerRef.current) return;
    const host = pagesInnerRef.current;
    let cancelled = false;
    (async () => {
      host.innerHTML = "";
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: renderedZoom });

        const pageWrap = document.createElement("div");
        pageWrap.style.position = "relative";
        pageWrap.style.margin = "0 auto 12px";
        pageWrap.style.width = `${viewport.width}px`;
        pageWrap.style.height = `${viewport.height}px`;
        pageWrap.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)";
        pageWrap.style.background = "white";

        const canvas = document.createElement("canvas");
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.style.display = "block";
        pageWrap.appendChild(canvas);

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        try {
          await renderTask.promise;
        } catch {
          continue;
        }
        if (cancelled) return;

        // Text layer overlay — invisible glyphs aligned to the canvas, used
        // for selection/copy. pdfjs's TextLayer class lays them out for us.
        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer";
        textLayerDiv.style.position = "absolute";
        textLayerDiv.style.left = "0";
        textLayerDiv.style.top = "0";
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.width = `${viewport.width}px`;
        // CSS variable used by pdfjs's text-layer stylesheet to scale glyphs.
        textLayerDiv.style.setProperty("--scale-factor", String(renderedZoom));
        pageWrap.appendChild(textLayerDiv);

        const textContent = await page.getTextContent();
        const TextLayerCtor = (pdfjs as unknown as { TextLayer: any }).TextLayer;
        if (TextLayerCtor) {
          const tl = new TextLayerCtor({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
          });
          await tl.render();
        }

        if (cancelled) return;
        host.appendChild(pageWrap);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, renderedZoom]);

  // Track fullscreen state so the button label updates if the user exits via Esc.
  useEffect(() => {
    function onChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const zoomIn = useCallback(
    () => setUserZoom((z) => +(z + ZOOM_STEP).toFixed(2)),
    [setUserZoom],
  );
  const zoomOut = useCallback(
    () => setUserZoom((z) => +(z - ZOOM_STEP).toFixed(2)),
    [setUserZoom],
  );
  // Reset = re-enable auto fit-to-width.
  const zoomReset = useCallback(() => {
    setAutoFit(true);
    const fit = computeFitZoom();
    if (fit != null) {
      setZoom(fit);
      setRenderedZoom(fit);
    } else {
      setZoom(DEFAULT_ZOOM);
    }
  }, [computeFitZoom]);
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      await document.exitFullscreen();
    } else {
      await el.requestFullscreen();
    }
  }, []);

  if (!pdfBlob) {
    return <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Compile to see preview</p>;
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 600,
        background: isFullscreen ? "var(--paper)" : "var(--paper-2)",
        border: "1px solid var(--rule)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 8px",
          borderBottom: "1px solid var(--rule)",
          background: "var(--paper)",
          fontSize: 12,
          color: "var(--ink-2)",
        }}
      >
        <ToolbarButton onClick={zoomOut} disabled={zoom <= MIN_ZOOM} label="Zoom out">
          <span style={{ fontSize: 16, lineHeight: 1 }}>−</span>
        </ToolbarButton>
        <button
          type="button"
          onClick={zoomReset}
          title="Fit to width"
          style={{
            minWidth: 52,
            padding: "4px 6px",
            border: "1px solid transparent",
            background: "transparent",
            color: "var(--ink-2)",
            cursor: "pointer",
            fontVariantNumeric: "tabular-nums",
            fontSize: 12,
            borderRadius: 3,
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolbarButton onClick={zoomIn} disabled={zoom >= MAX_ZOOM} label="Zoom in">
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
        </ToolbarButton>
        <span style={{ flex: 1 }} />
        <ToolbarButton
          onClick={toggleFullscreen}
          label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          <Glyph name={isFullscreen ? "x" : "panel"} size={13} />
        </ToolbarButton>
      </div>
      {error ? (
        <p style={{ padding: 16, color: "var(--accent)", fontSize: 13 }}>{error}</p>
      ) : (
        <div
          ref={pagesRef}
          style={{
            flex: 1,
            overflow: "auto",
            padding: 16,
            background: "var(--paper-2)",
          }}
        >
          <div
            ref={pagesInnerRef}
            style={{
              transform: zoom !== renderedZoom ? `scale(${zoom / renderedZoom})` : undefined,
              transformOrigin: "top center",
              willChange: zoom !== renderedZoom ? "transform" : undefined,
            }}
          />
        </div>
      )}
    </div>
  );
}

interface ToolbarButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
}

function ToolbarButton({ onClick, children, disabled, label }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 26,
        border: "1px solid transparent",
        background: "transparent",
        color: "var(--ink-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        borderRadius: 3,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "var(--paper-2)";
          e.currentTarget.style.borderColor = "var(--rule)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      {children}
    </button>
  );
}
