"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DatePickerBS } from "@/components/ui/date-picker-bs";
import { Button } from "@/components/ui/button";
import { adToIso, bsFromDbText, toAD } from "@/lib/bs";
import { cn } from "@/lib/cn";

const PRESETS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "month", label: "This month" },
  { key: "fy", label: "This fiscal year" },
];

/**
 * The period a book covers: a quick choice, or any two dates. With `asOf`,
 * a single date for statements that stand on one day (balance sheet, aging).
 */
export function RangeBar({
  preset,
  fromBs,
  toBs,
  label,
  asOf = false,
}: {
  preset?: string;
  fromBs: string;
  toBs: string;
  label: string;
  asOf?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [from, setFrom] = useState(fromBs);
  const [to, setTo] = useState(toBs);

  function go(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  const iso = (bs: string) => adToIso(toAD(bsFromDbText(bs)));

  return (
    <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-2">
        {!asOf &&
          PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => go({ preset: p.key, from: null, to: null, fy: null })}
              className={cn(
                "h-9 rounded-[999px] border px-3 text-[13px] transition-colors",
                preset === p.key
                  ? "border-sage-700 bg-sage-700 text-cream-50"
                  : "border-line bg-cream-50 text-sage-700 hover:bg-cream-200",
              )}
            >
              {p.label}
            </button>
          ))}
        {!asOf && (
          <div className="w-[150px]">
            <DatePickerBS value={from} onChange={setFrom} />
          </div>
        )}
        <div className="w-[150px]">
          <DatePickerBS value={to} onChange={setTo} />
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            asOf
              ? go({ asof: iso(to) })
              : go({ from: iso(from), to: iso(to), preset: null, fy: null })
          }
        >
          Show
        </Button>
      </div>
      <span className="text-[13px] text-sage-500">{label}</span>
    </div>
  );
}
