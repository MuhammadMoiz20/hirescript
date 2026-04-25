import { useEffect, useRef } from "react";
import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export default function PdfPreview({ pdfBlob }: { pdfBlob: Blob | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!pdfBlob || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const buf = await pdfBlob.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    })();
    return () => { cancelled = true; };
  }, [pdfBlob]);
  if (!pdfBlob) return <p>Compile to see preview</p>;
  return <canvas ref={canvasRef} style={{ maxWidth: "100%", border: "1px solid var(--rule)" }} />;
}
