import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Printer, PenLine, ClipboardCheck } from "lucide-react";
import { requirePermission, can } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { LAB_PERMISSIONS } from "@/lib/permissions";
import { getOrder } from "@/lib/repos/lab-orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrderHead } from "@/components/lab/order-head";
import { ResultValues } from "@/components/lab/approval-panel";
import { OrderDetailsForm, ReopenButton } from "@/components/lab/order-tools";
import { RESULT_STATUS_LABEL, SAMPLE_STATUS_LABEL, resultTone, stampAt } from "@/lib/lab-format";
import { reportUrl } from "@/lib/lab-token";

export const metadata = { title: "Lab order" };

const ACTION: Record<string, string> = { approved: "Approved", sent_back: "Sent back", reopened: "Reopened" };
const CHANNEL: Record<string, string> = { printed: "Printed", collected: "Collected by the patient" };

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireModulePage("lab");
  const user = await requirePermission([...LAB_PERMISSIONS]);
  const { orderId } = await params;
  const order = await getOrder(orderId);
  if (!order) notFound();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const approved = order.results.filter((r) => r.status === "approved" || r.status === "dispatched");
  const active = order.status !== "cancelled";

  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <OrderHead order={order} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {active && can(user, "lab.results") && order.results.some((r) => !["approved", "dispatched"].includes(r.status)) && (
          <Link href={`/lab/results/${order.id}`}>
            <Button>
              <PenLine className="h-4 w-4" />
              Enter results
            </Button>
          </Link>
        )}
        {active && can(user, "lab.approve") && order.results.some((r) => r.status === "submitted") && (
          <Link href={`/lab/approval/${order.id}`}>
            <Button>
              <ClipboardCheck className="h-4 w-4" />
              Review
            </Button>
          </Link>
        )}
        {approved.length > 0 && can(user, "lab.reports") && (
          <a href={`/print/lab-report/${order.id}`} target="_blank" rel="noreferrer">
            <Button variant="secondary">
              <Printer className="h-4 w-4" />
              Print report
            </Button>
          </a>
        )}
        {active && can(user, "lab.reopen") && (
          <ReopenButton orderId={order.id} results={approved.map((r) => ({ id: r.id, testName: r.testName }))} />
        )}
      </div>

      {active && (
        <section className="mb-4 rounded-[10px] border border-line bg-cream-50 p-4">
          <OrderDetailsForm orderId={order.id} referredBy={order.referredBy} priority={order.priority} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {order.results.map((r) => (
            <section key={r.id} className="rounded-[10px] border border-line bg-cream-50">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div>
                  <span className="text-[15px] font-semibold text-sage-900">{r.testName}</span>
                  {r.groupName && <span className="ml-2 text-[12px] text-sage-500">{r.groupName}</span>}
                </div>
                <Badge tone={resultTone(r.status)}>{RESULT_STATUS_LABEL[r.status] ?? r.status}</Badge>
              </header>
              <ResultValues result={r} />
              <div className="border-t border-line px-4 py-2 text-[12px] text-sage-500">
                {r.enteredByName && `Entered by ${r.enteredByName}${r.submittedAt ? ` · ${stampAt(r.submittedAt)}` : ""}`}
                {r.approvedByName && ` · Approved by ${r.approvedByName} · ${stampAt(r.approvedAt)}`}
                {r.correctionNote && <span className="text-danger-600"> · Sent back: {r.correctionNote}</span>}
              </div>
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-[10px] border border-line bg-cream-50 p-4">
            <h3 className="text-[14px] font-semibold text-sage-900">Samples</h3>
            <ul className="mt-2 flex flex-col gap-2 text-[13px]">
              {order.samples.map((s) => (
                <li key={s.id}>
                  <span className="font-mono font-semibold">{s.code}</span> · {s.sampleTypeName}{" "}
                  <Badge tone={s.status === "collected" ? "ok" : "warn"}>{SAMPLE_STATUS_LABEL[s.status] ?? s.status}</Badge>
                  {s.collectedAt && (
                    <div className="text-sage-500">
                      {stampAt(s.collectedAt)} · {s.collectedByName}
                    </div>
                  )}
                  {s.rejectionReason && <div className="text-danger-600">{s.rejectionReason}</div>}
                </li>
              ))}
              {order.samples.length === 0 && <li className="text-sage-500">Nothing to collect.</li>}
            </ul>
          </section>

          <section className="rounded-[10px] border border-line bg-cream-50 p-4 text-[13px]">
            <h3 className="text-[14px] font-semibold text-sage-900">Patient&apos;s report link</h3>
            <div className="mt-1 break-all font-mono text-sage-700">{reportUrl(origin, order.reportToken)}</div>
            <div className="mt-1 text-sage-500">
              Opened {order.viewCount} time{order.viewCount === 1 ? "" : "s"}
              {order.lastViewedAt && `, last ${stampAt(order.lastViewedAt)}`}.
              {order.balancePaisa > 0 && " It stays closed until the bill is paid."}
            </div>
          </section>

          <section className="rounded-[10px] border border-line bg-cream-50 p-4 text-[13px]">
            <h3 className="text-[14px] font-semibold text-sage-900">History</h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {order.dispatches.map((d, i) => (
                <li key={`d${i}`}>
                  {CHANNEL[d.channel] ?? d.channel} · {d.userName} · <span className="text-sage-500">{stampAt(d.at)}</span>
                </li>
              ))}
              {order.history.map((h2, i) => (
                <li key={`h${i}`}>
                  {ACTION[h2.action] ?? h2.action}: {h2.testName} · {h2.userName}
                  {h2.reason && <span className="text-sage-600"> — {h2.reason}</span>}{" "}
                  <span className="text-sage-500">{stampAt(h2.at)}</span>
                </li>
              ))}
              {order.dispatches.length + order.history.length === 0 && <li className="text-sage-500">Nothing yet.</li>}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
