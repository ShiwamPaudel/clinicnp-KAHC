"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Header } from "@/components/app/header";
import { cn } from "@/lib/cn";
import type { Permission } from "@/lib/permissions";

export interface LabCounts {
  samples: number;
  results: number;
  approval: number;
}

const TABS: { href: string; label: string; perm: Permission[]; count?: keyof LabCounts }[] = [
  { href: "/lab/samples", label: "Sample collection", perm: ["lab.samples"], count: "samples" },
  { href: "/lab/results", label: "Result entry", perm: ["lab.results"], count: "results" },
  { href: "/lab/approval", label: "Approval", perm: ["lab.approve"], count: "approval" },
  { href: "/lab/reports", label: "Reports", perm: ["lab.reports"] },
  { href: "/lab/tests", label: "Tests", perm: ["lab.catalog"] },
  { href: "/lab/profiles", label: "Profiles", perm: ["lab.catalog"] },
];

/** The laboratory's tab strip. Each tab shows only to a role that may open it. */
export function LabTabs({ counts, permissions }: { counts: LabCounts; permissions: Permission[] }) {
  const pathname = usePathname();
  const granted = new Set(permissions);
  const tabs = TABS.filter((t) => t.perm.some((p) => granted.has(p)));
  return (
    <>
      <Header title="Laboratory" />
      <div className="border-b border-line bg-cream-50 px-6">
        <div className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = pathname === t.href || pathname.startsWith(t.href + "/");
            const n = t.count ? counts[t.count] : 0;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[14px]",
                  active
                    ? "border-sage-700 font-semibold text-sage-900"
                    : "border-transparent text-sage-500 hover:text-sage-700",
                )}
              >
                {t.label}
                {n > 0 && (
                  <span className="rounded-[999px] bg-warn-100 px-1.5 text-[11px] font-semibold text-warn-600">{n}</span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
