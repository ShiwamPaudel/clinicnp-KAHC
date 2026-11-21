import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission, can } from "@/lib/session";
import { requireAnyModulePage } from "@/lib/modules";
import { getLabPartner, partnerBalancePaisa } from "@/lib/repos/lab-partners";
import { listPartnerPrices } from "@/lib/repos/lab-sendouts";
import { PartnerPriceList } from "@/components/clinic/partner-price-list";
import { formatPaisa } from "@/lib/money";

export const metadata = { title: "Outside lab" };

/** One outside laboratory: what it charges for each test sent there. */
export default async function LabPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(["clinic.setup", "lab.catalog"]);
  await requireAnyModulePage(["clinic", "lab"]);
  const { id } = await params;
  const partner = await getLabPartner(id);
  if (!partner) notFound();
  const [prices, balance] = await Promise.all([listPartnerPrices(id), partnerBalancePaisa(id)]);

  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <Link href="/settings/lab-partners" className="mb-3 inline-flex items-center gap-1 text-[13px] text-sage-600 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" />
        Outside labs
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[22px] font-bold text-sage-950">{partner.name}</h2>
          {(partner.phone || partner.contactPerson) && (
            <p className="text-[13px] text-sage-500">
              {[partner.contactPerson, partner.phone].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-[12px] text-sage-500">Owed</div>
          <div className="tnum text-[18px] font-semibold text-sage-900">{formatPaisa(balance)}</div>
          {can(user, "reports.all") && (
            <Link href={`/reports/lab-partners?partner=${partner.id}`} className="text-[13px] text-clinic-700 hover:underline">
              Statement
            </Link>
          )}
        </div>
      </div>
      <PartnerPriceList partnerId={partner.id} rows={prices} />
    </main>
  );
}
