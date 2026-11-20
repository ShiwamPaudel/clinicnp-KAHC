"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, ArrowLeft } from "lucide-react";
import { ReportSheet, ReportBody, ReportHeader, ReportFooter, ReportSignatures, type ReportViewData } from "@/components/lab/report-sheet";

const PX_PER_MM = 3.7795275591;

/**
 * The printable report. paged.js lays it out page by page so the letterhead,
 * the signatures and "Page X of Y" repeat on every page. Until it finishes —
 * or if it ever fails — the plain table version shows, which prints correctly
 * on its own (it just has no page numbers).
 */
export function ReportPrintView({ d, backHref, forPatient = false }: { d: ReportViewData; backHref?: string; forPatient?: boolean }) {
  const [showHeader, setShowHeader] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [paged, setPaged] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  // One layout at a time: paged.js breaks if a second starts while the first
  // is still measuring (React runs effects twice in development, and the
  // Header/Footer switches start a new one).
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  // On a phone the A4 page is scaled down to the screen's width rather than
  // scrolling sideways; printing always uses the real size.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 16) / 794));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const contentWidthMm = 210 - 2 * d.margins.xMm;

  useEffect(() => {
    let cancelled = false;
    const source = sourceRef.current;
    const target = targetRef.current;
    if (!source || !target) return;

    async function paginate() {
      if (cancelled) return;
      // Laid out off-screen but displayed (so it can be measured), and only
      // moved into view once finished and still wanted.
      const stage = document.createElement("div");
      stage.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;";
      document.body.appendChild(stage);
      try {
        const imgs = Array.from(source!.querySelectorAll("img"));
        await Promise.all(
          imgs.map((img) =>
            img.complete && img.naturalHeight > 0
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.addEventListener("load", () => res(), { once: true });
                  img.addEventListener("error", () => res(), { once: true });
                }),
          ),
        );
        if (cancelled) return;
        const headerEl = source!.querySelector(".rpt-header") as HTMLElement | null;
        const footerEl = source!.querySelector(".rpt-footer") as HTMLElement | null;
        const headerMm = headerEl?.offsetHeight ? headerEl.offsetHeight / PX_PER_MM + 3 : 0;
        const footerMm = footerEl?.offsetHeight ? footerEl.offsetHeight / PX_PER_MM + 3 : 0;
        const topMm = Math.max(showHeader ? headerMm : 0, d.margins.topMm);
        const bottomMm = Math.max(footerMm, d.margins.bottomMm);
        const css = `
          @page {
            size: A4;
            margin: ${topMm}mm ${d.margins.xMm}mm ${bottomMm}mm ${d.margins.xMm}mm;
            @top-center { content: element(rptHeader); }
            @bottom-center { content: element(rptFooter); }
          }
          .rpt-header { position: running(rptHeader); width: 100%; }
          .rpt-footer { position: running(rptFooter); width: 100%; }
        `;
        const { Previewer } = await import("pagedjs");
        if (cancelled) return;
        await new Previewer().preview(source!.innerHTML, [{ _: css }], stage);
        if (cancelled) return;
        const pages = stage.querySelectorAll(".pagedjs_page");
        pages.forEach((pg, i) => {
          const no = pg.querySelector(".rpt-pageno");
          if (no) no.textContent = `Page ${i + 1} of ${pages.length}`;
        });
        target!.replaceChildren(...Array.from(stage.childNodes));
        setPaged(pages.length > 0);
      } catch (err) {
        // The plain version is already on screen and prints correctly; this
        // only goes to the browser's own console, never to the page.
        console.error("[report pages]", err);
        if (!cancelled) setPaged(false);
      } finally {
        stage.remove();
      }
    }
    chainRef.current = chainRef.current.then(paginate, paginate);
    return () => {
      cancelled = true;
    };
  }, [showHeader, showFooter, d]);

  return (
    <div className="min-h-screen bg-[#eef1ee]">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-cream-50 px-4 py-3">
        {backHref ? (
          <a href={backHref} className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[14px] text-sage-700 hover:bg-cream-200">
            <ArrowLeft className="h-4 w-4" /> Back
          </a>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-4 text-[14px]">
          {!forPatient && (
            <>
              <span className="text-[12px] text-sage-500">Printing on a pre-printed pad? Turn these off.</span>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={showHeader} onChange={(e) => setShowHeader(e.target.checked)} /> Header
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={showFooter} onChange={(e) => setShowFooter(e.target.checked)} /> Footer
              </label>
            </>
          )}
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-sage-700 px-4 py-2 text-cream-50 hover:bg-sage-900"
          >
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      </div>

      <style>{`
        .report-paged .pagedjs_page { background:#fff; margin:0 auto 16px; box-shadow:0 1px 8px rgba(0,0,0,.12); }
        @media print {
          .no-print { display:none !important; }
          body { background:#fff !important; }
          .report-paged .pagedjs_page { box-shadow:none; margin:0; }
          .report-zoom { zoom: 1 !important; }
        }
      `}</style>

      <div
        ref={sourceRef}
        aria-hidden
        className="no-print"
        style={{ position: "absolute", left: -99999, top: 0, width: `${contentWidthMm}mm`, visibility: "hidden" }}
      >
        <div className="rpt-header">
          <ReportHeader d={d} show={showHeader} />
        </div>
        <div className="rpt-footer">
          <ReportSignatures d={{ ...d, margins: { ...d.margins, xMm: 0 } }} />
          <div className="rpt-pageno" style={{ textAlign: "center", fontSize: 10, fontStyle: "italic", color: "#5f6b63" }} />
          <ReportFooter d={d} show={showFooter} />
        </div>
        <div>
          <ReportBody d={d} />
        </div>
      </div>

      <div className="report-zoom" style={{ zoom }}>
        <div ref={targetRef} className="report-paged py-6" style={{ display: paged ? "block" : "none" }} />
        {!paged && (
          <div className="py-6">
            <ReportSheet d={d} showHeader={showHeader} showFooter={showFooter} />
          </div>
        )}
      </div>
    </div>
  );
}
