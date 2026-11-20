import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { bookChecks } from "@/lib/repos/ledger-reports";
import { formatPaisa } from "@/lib/money";
import { cn } from "@/lib/cn";

export default async function ChecksPage() {
  await requirePermission("accounts.view");
  const checks = await bookChecks();
  return (
    <div className="flex flex-col gap-3">
      {checks.map((c) => {
        const Icon = c.ok ? CheckCircle2 : c.info ? Info : AlertTriangle;
        return (
          <div
            key={c.key}
            className={cn(
              "flex gap-3 rounded-[10px] border p-4",
              c.ok ? "border-line bg-cream-50" : c.info ? "border-info-100 bg-info-100/40" : "border-danger-100 bg-danger-100/50",
            )}
          >
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", c.ok ? "text-ok-600" : c.info ? "text-info-600" : "text-danger-600")} />
            <div className="flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-sage-900">{c.label}</span>
                <span className="text-[13px] text-sage-600 tnum">
                  {c.booksPaisa !== null && <>Books {formatPaisa(c.booksPaisa)}</>}
                  {c.screenPaisa !== null && <> · Screen {formatPaisa(c.screenPaisa)}</>}
                </span>
              </div>
              {!c.ok && <p className="mt-1 text-[13px] text-sage-700">{c.help}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
