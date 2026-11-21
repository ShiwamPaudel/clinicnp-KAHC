import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { getOrder } from "@/lib/repos/lab-orders";
import { listOrderSendouts } from "@/lib/repos/lab-sendouts";
import { listLabPartners } from "@/lib/repos/lab-partners";
import { OrderHead } from "@/components/lab/order-head";
import { ResultEntry } from "@/components/lab/result-entry";

export const metadata = { title: "Enter results" };

export default async function ResultEntryPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireModulePage("lab");
  const user = await requirePermission("lab.results");
  const { orderId } = await params;
  const order = await getOrder(orderId);
  if (!order) notFound();
  const [sendouts, partners] = await Promise.all([listOrderSendouts(orderId), listLabPartners()]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <OrderHead order={order} back={{ href: "/lab/results", label: "Result entry" }} />
      {order.status === "cancelled" ? (
        <p className="text-[14px] text-sage-600">This bill was cancelled, so no results are needed.</p>
      ) : (
        <ResultEntry
          orderId={order.id}
          results={order.results}
          partners={partners.map((p) => ({ id: p.id, name: p.name }))}
          sentOut={sendouts.map((so) => ({
            id: so.id,
            resultId: so.resultId,
            partnerName: so.partnerName,
            sentAt: so.sentAt,
            sentByName: so.sentByName,
          }))}
          canAddPartner={can(user, ["lab.catalog", "clinic.setup"])}
        />
      )}
    </main>
  );
}
