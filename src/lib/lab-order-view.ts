/**
 * lab-order-view.ts — an order summary as the lab lists show it. Pure.
 */
import type { OrderSummary } from "@/lib/repos/lab-orders";
import type { OrderView } from "@/components/lab/order-list";
import { bsDateLabel, orderNoLabel, patientNoLabel } from "@/lib/lab-format";

export function toOrderView(o: OrderSummary): OrderView {
  const c = o.counts;
  const here = c.total - c.sentOut;
  const parts: string[] = [];
  if (here > 0) parts.push(`${c.approved} of ${here} approved`);
  if (c.submitted) parts.push(`${c.submitted} waiting for approval`);
  if (c.sentOut) parts.push(`${c.sentOut} sent to another lab`);
  return {
    id: o.id,
    orderLabel: orderNoLabel(o.orderNo),
    dateLabel: bsDateLabel(o.dateBs),
    status: o.status,
    urgent: o.priority === "urgent",
    patientLabel: `${patientNoLabel(o.patientNo)} · ${o.patientName}`,
    ageSex: o.ageSex,
    invoiceLabel: o.invoiceLabel,
    testNames: o.testNames,
    progress: parts.join(" · "),
    balancePaisa: o.balancePaisa,
    correction: c.correction,
    canPrint: c.approved > 0,
    sentOut: [],
  };
}
