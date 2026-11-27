import Link from "next/link";
import { requirePermission, can } from "@/lib/session";
import { partyList } from "@/lib/repos/ledger-reports";
import { listParties } from "@/lib/repos/accounts";
import { accountsAsOf } from "@/lib/accounts-range";
import { PARTY_TYPE_LABEL, type PartyType } from "@/lib/accounting";
import { partyHref } from "@/lib/accounts-view";
import { formatPaisa } from "@/lib/money";
import { Statement } from "@/components/accounts/statement";
import { PartiesManager } from "@/components/accounts/parties-manager";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

const ORDER: PartyType[] = ["patient", "walkin", "party", "supplier", "lab_partner", "doctor"];

export default async function PartiesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePermission(["accounts.view", "accounts.setup"]);
  const sp = await searchParams;
  const show = sp.show === "owed" || sp.show === "owing" ? sp.show : "all";
  const today = accountsAsOf({});
  const [rows, parties] = await Promise.all([can(user, "accounts.view") ? partyList(today.iso) : Promise.resolve([]), listParties()]);
  const shown = rows.filter((r) => (show === "owed" ? r.balancePaisa > 0 : show === "owing" ? r.balancePaisa < 0 : true));
  const byType = ORDER.map((t) => ({ t, rows: shown.filter((r) => r.partyType === t) })).filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-8">
      {can(user, "accounts.view") && (
        <Statement title="Who owes" period={today.label}>
          <div className="no-print mb-3 flex gap-1.5">
            {(
              [
                ["all", "Everyone with a balance"],
                ["owed", "Owe the clinic"],
                ["owing", "The clinic owes"],
              ] as const
            ).map(([k, label]) => (
              <Link
                key={k}
                href={`/accounts/parties${k === "all" ? "" : `?show=${k}`}`}
                className={cn(
                  "rounded-[999px] border px-3 py-1.5 text-[13px]",
                  show === k ? "border-sage-700 bg-sage-700 text-cream-50" : "border-line bg-cream-50 text-sage-700 hover:bg-cream-200",
                )}
              >
                {label}
              </Link>
            ))}
          </div>
          {byType.length === 0 ? (
            <EmptyState message="Nobody has a balance with the clinic." />
          ) : (
            <div className="flex flex-col gap-5">
              {byType.map((g) => (
                <section key={g.t}>
                  <h3 className="mb-2 text-[14px] font-semibold text-sage-900">
                    {g.t === "walkin" ? "Customers on dues (not registered)" : g.t === "party" ? "Other people and companies" : `${PARTY_TYPE_LABEL[g.t]}s`}
                  </h3>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Name</TH>
                        <TH numeric>Owes the clinic</TH>
                        <TH numeric>The clinic owes</TH>
                      </TR>
                    </THead>
                    <tbody>
                      {g.rows.map((r) => (
                        <TR key={r.partyId}>
                          <TD>
                            <Link href={partyHref(r.partyType, r.partyId)} className="font-medium text-sage-900 hover:underline">
                              {r.name || "No name"}
                            </Link>
                          </TD>
                          <TD numeric>{r.balancePaisa > 0 ? formatPaisa(r.balancePaisa, false) : ""}</TD>
                          <TD numeric>{r.balancePaisa < 0 ? formatPaisa(-r.balancePaisa, false) : ""}</TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </section>
              ))}
            </div>
          )}
        </Statement>
      )}

      <section className="no-print">
        <h2 className="mb-1 text-[16px] font-semibold text-sage-900">Other people and companies</h2>
        <PartiesManager parties={parties} canEdit={can(user, "accounts.setup")} />
      </section>
    </div>
  );
}
