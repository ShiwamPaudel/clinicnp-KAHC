import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listOrders } from "@/lib/repos/lab-orders";
import { sendoutLabelsFor } from "@/lib/repos/lab-sendouts";
import { toOrderView } from "@/lib/lab-order-view";
import { OrderList } from "@/components/lab/order-list";

export const metadata = { title: "Lab reports" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireModulePage("lab");
  await requirePermission("lab.reports");
  const sp = await searchParams;
  const rows = await listOrders("reports", { search: sp.q });
  const sent = await sendoutLabelsFor(rows.filter((r) => r.counts.sentOut > 0).map((r) => r.id));
  const views = rows.map((r) => ({ ...toOrderView(r), sentOut: sent.get(r.id) ?? [] }));
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <OrderList rows={views} mode="reports" base="/lab/reports" />
    </main>
  );
}
