"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Header } from "@/components/app/header";
import { cn } from "@/lib/cn";
import type { Permission } from "@/lib/permissions";

// Basic accounting (owner, 2083-08-11): six tabs in plain words. Aging, Trial
// balance, Balance sheet and Checks are hidden, not deleted: their pages still
// open by address (/accounts/aging, /accounts/trial-balance,
// /accounts/balance-sheet, /accounts/checks), and a line here brings one back.
const TABS: { href: string; label: string; perm: Permission[]; exact?: boolean }[] = [
  { href: "/accounts", label: "Summary", perm: ["accounts.view"], exact: true },
  { href: "/accounts/vouchers", label: "Entries", perm: ["accounts.view", "accounts.post"] },
  { href: "/accounts/daybook", label: "Daily list", perm: ["accounts.view"] },
  { href: "/accounts/parties", label: "Who owes", perm: ["accounts.view", "accounts.setup"] },
  { href: "/accounts/profit-loss", label: "Profit and loss", perm: ["accounts.view"] },
  { href: "/accounts/chart", label: "Account heads", perm: ["accounts.view", "accounts.setup"] },
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
