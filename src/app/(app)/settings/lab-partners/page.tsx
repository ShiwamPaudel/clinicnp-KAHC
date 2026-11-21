import { requirePermission } from "@/lib/session";
import { requireAnyModulePage } from "@/lib/modules";
import { listLabPartners, partnerBalancePaisa } from "@/lib/repos/lab-partners";
import { unpricedByPartner } from "@/lib/repos/lab-sendouts";
import { LabPartnersManager } from "@/components/clinic/lab-partners-manager";

export const metadata = { title: "Outside labs" };

export default async function LabPartnersSettingsPage() {
  await requirePermission(["clinic.setup", "lab.catalog"]);
  await requireAnyModulePage(["clinic", "lab"]);
  const [partners, unpriced] = await Promise.all([listLabPartners(true), unpricedByPartner()]);
  const rows = await Promise.all(
    partners.map(async (p) => ({
      ...p,
      balancePaisa: await partnerBalancePaisa(p.id),
      unpriced: unpriced.get(p.id) ?? 0,
    })),
  );

  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <LabPartnersManager initial={rows} />
    </main>
  );
}
