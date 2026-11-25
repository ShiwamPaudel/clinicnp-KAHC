"use client";

import { useEffect, useState } from "react";
import { Printer, ArrowLeft } from "lucide-react";
import { ReportSheet, type ReportViewData } from "@/components/lab/report-sheet";

/**
 * The printable report, laid out by the browser itself (2083-08-09).
 *
 * The sheet is one table: its header (the letterhead) and its footer (the
 * signatures, the lab's note on every page, the footer image) repeat on every
 * printed page, and "Page X of Y" goes in the page's bottom margin. This
 * replaced paged.js, which could not split some reports across pages and
 * printed the first page two or three times over ("Unable to layout item").
 */
export function ReportPrintView({ d, backHref, forPatient = false }: { d: ReportViewData; backHref?: string; forPatient?: boolean }) {
  const [showHeader, setShowHeader] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  // On a phone the A4 page is scaled down to the screen's width rather than
  // scrolling sideways; printing always uses the real size.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 16) / 794));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div className="lab-print min-h-screen bg-[#eef1ee]">
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
        .report-screen .lab-a4 { box-shadow: 0 1px 8px rgba(0,0,0,.12); }
        @page {
          size: A4;
          margin: 0 0 7mm 0;
          @bottom-center { content: "Page " counter(page) " of " counter(pages); font: italic 9pt sans-serif; color: #5f6b63; }
        }
        @media print {
          /* the app's print sheet shows only a bill's .print-area; this page is the report itself */
          .lab-print, .lab-print * { visibility: visible !important; }
          .no-print { display: none !important; }
          html, body, .lab-print { background: #fff !important; }
          .report-screen { padding: 0 !important; }
          .report-screen .lab-a4 { box-shadow: none; }
          .report-zoom { zoom: 1 !important; }
        }
      `}</style>

      <div className="report-zoom" style={{ zoom }}>
        <div className="report-screen py-6">
          <ReportSheet d={d} showHeader={showHeader} showFooter={showFooter} />
        </div>
      </div>
    </div>
  );
}
