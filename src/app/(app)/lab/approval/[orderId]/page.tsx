import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { getOrder } from "@/lib/repos/lab-orders";
import { listSignatories } from "@/lib/repos/lab-report";
import { OrderHead } from "@/components/lab/order-head";
import { ApprovalPanel } from "@/components/lab/approval-panel";

export const metadata = { title: "Approve results" };

export default async function ApprovalPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireModulePage("lab");
  await requirePermission("lab.approve");
  const { orderId } = await params;
  const [order, signatories] = await Promise.all([getOrder(orderId), listSignatories(true)]);
  if (!order) notFound();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <OrderHead order={order} back={{ href: "/lab/approval", label: "Approval" }} />
      <ApprovalPanel
        orderId={order.id}
        results={order.results}
        signatories={signatories.map((s) => ({ id: s.id, name: s.name, description: s.description }))}
      />
    </main>
  );
}
