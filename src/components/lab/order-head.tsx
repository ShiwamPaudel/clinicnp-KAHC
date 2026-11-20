import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { OrderDetail } from "@/lib/repos/lab-orders";
import { ORDER_STATUS_LABEL, bsDateLabel, orderNoLabel, orderTone, patientNoLabel } from "@/lib/lab-format";
import { formatPaisa } from "@/lib/money";

const SEX: Record<string, string> = { m: "Male", f: "Female", o: "Other" };

/** Who the order is for, at the top of every order screen. */
export function OrderHead({ order, back }: { order: OrderDetail; back?: { href: string; label: string } }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-[10px] border border-line bg-cream-50 p-4">
      <div>
        {back && (
          <Link href={back.href} className="text-[13px] text-sage-500 hover:underline">
            ← {back.label}
          </Link>
        )}
        <div className="mt-1 text-[18px] font-semibold text-sage-900">{order.patient.name}</div>
        <div className="text-[13px] text-sage-600">
          {patientNoLabel(order.patient.patientNo)} · {order.patient.ageShort} · {SEX[order.patient.sex] ?? ""}
          {order.patient.phone && ` · ${order.patient.phone}`}
        </div>
        {order.referredBy && <div className="text-[13px] text-sage-600">Referred by {order.referredBy}</div>}
      </div>
      <div className="text-right">
        <Link href={`/lab/orders/${order.id}`} className="font-mono text-[14px] font-semibold text-sage-900 hover:underline">
          {orderNoLabel(order.orderNo)}
        </Link>
        <div className="text-[13px] text-sage-600">
          {bsDateLabel(order.dateBs)}
          {order.invoiceLabel && ` · ${order.invoiceLabel}`}
        </div>
        <div className="mt-1 flex justify-end gap-1">
          {order.priority === "urgent" && <Badge tone="danger">Urgent</Badge>}
          <Badge tone={orderTone(order.status)}>{ORDER_STATUS_LABEL[order.status] ?? order.status}</Badge>
          {order.balancePaisa > 0 && <Badge tone="warn">Owes {formatPaisa(order.balancePaisa)}</Badge>}
        </div>
      </div>
    </div>
  );
}
