"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Header } from "@/components/app/header";
import { cn } from "@/lib/cn";
import type { Permission } from "@/lib/permissions";

const TABS: { href: string; label: string; perm: Permission[]; exact?: boolean }[] = [
  { href: "/accounts", label: "Overview", perm: ["accounts.view"], exact: true },
  { href: "/accounts/vouchers", label: "Vouchers", perm: ["accounts.view", "accounts.post"] },
  { href: "/accounts/daybook", label: "Day book", perm: ["accounts.view"] },
  { href: "/accounts/parties", label: "Parties", perm: ["accounts.view", "accounts.setup"] },
  { href: "/accounts/aging", label: "Aging", perm: ["accounts.view"] },
  { href: "/accounts/trial-balance", label: "Trial balance", perm: ["accounts.view"] },
  { href: "/accounts/profit-loss", label: "Profit and loss", perm: ["accounts.view"] },
  { href: "/accounts/balance-sheet", label: "Balance sheet", perm: ["accounts.view"] },
  { href: "/accounts/chart", label: "Chart of accounts", perm: ["accounts.view", "accounts.setup"] },
  { href: "/accounts/checks", label: "Checks", perm: ["accounts.view"] },
];

/** The Accounts tab strip. Each tab shows only to a role that may open it. */
export function AccountsTabs({ permissions }: { permissions: Permission[] }) {
  const pathname = usePathname();
  const granted = new Set(permissions);
  const tabs = TABS.filter((t) => t.perm.some((p) => granted.has(p)));
  return (
    <>
      <Header title="Accounts" />
      <div className="no-print border-b border-line bg-cream-50 px-6">
        <div className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = t.exact
              ? pathname === t.href
              : pathname === t.href || pathname.startsWith(t.href + "/") || (t.href === "/accounts/chart" && pathname.startsWith("/accounts/ledger/"));
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
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
