import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listOrders } from "@/lib/repos/lab-orders";
import { toOrderView } from "@/lib/lab-order-view";
import { OrderList } from "@/components/lab/order-list";

export const metadata = { title: "Result entry" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireModulePage("lab");
  await requirePermission("lab.results");
  const sp = await searchParams;
  const rows = await listOrders("results", { search: sp.q });
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <OrderList rows={rows.map(toOrderView)} mode="results" base="/lab/results" />
    </main>
  );
}
