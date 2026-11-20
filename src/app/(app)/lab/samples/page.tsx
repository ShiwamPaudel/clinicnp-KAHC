import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listSamples } from "@/lib/repos/lab-orders";
import { orderNoLabel, patientNoLabel, stampAt } from "@/lib/lab-format";
import { SampleQueue, type SampleView } from "@/components/lab/sample-queue";

export const metadata = { title: "Sample collection" };

export default async function SamplesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireModulePage("lab");
  await requirePermission("lab.samples");
  const sp = await searchParams;
  const rows = await listSamples({ status: sp.status, search: sp.q });
  const view: SampleView[] = rows.map((s) => ({
    id: s.id,
    code: s.code,
    status: s.status,
    sampleTypeName: s.sampleTypeName,
    rejectionReason: s.rejectionReason,
    collectedLabel: s.collectedAt ? `${stampAt(s.collectedAt)} · ${s.collectedByName}` : "",
    waitingLabel: `Billed ${stampAt(s.createdAt)}`,
    orderId: s.orderId,
    orderLabel: orderNoLabel(s.orderNo),
    urgent: s.priority === "urgent",
    patientLabel: `${patientNoLabel(s.patientNo)} · ${s.patientName}`,
    ageSex: s.ageSex,
    testNames: s.testNames,
  }));
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <SampleQueue rows={view} />
    </main>
  );
}
