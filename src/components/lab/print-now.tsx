"use client";

import { Printer } from "lucide-react";

/** The one button on a print view. */
export function PrintNow({ label = "Print" }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded-[8px] bg-sage-700 px-4 py-2 text-[14px] text-cream-50 hover:bg-sage-900"
    >
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}
