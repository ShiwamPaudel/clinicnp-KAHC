import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { getOrder } from "@/lib/repos/lab-orders";
import { OrderHead } from "@/components/lab/order-head";
import { ResultEntry } from "@/components/lab/result-entry";

export const metadata = { title: "Enter results" };

export default async function ResultEntryPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireModulePage("lab");
  await requirePermission("lab.results");
  const { orderId } = await params;
  const order = await getOrder(orderId);
  if (!order) notFound();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <OrderHead order={order} back={{ href: "/lab/results", label: "Result entry" }} />
      {order.status === "cancelled" ? (
        <p className="text-[14px] text-sage-600">This bill was cancelled, so no results are needed.</p>
      ) : (
        <ResultEntry orderId={order.id} results={order.results} />
      )}
    </main>
  );
}
