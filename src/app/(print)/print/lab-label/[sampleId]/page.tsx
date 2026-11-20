import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { getSampleLabel } from "@/lib/repos/lab-orders";
import { barcodeDataUrl } from "@/lib/lab-codes";
import { orderNoLabel, patientNoLabel, stampAt } from "@/lib/lab-format";
import { PrintNow } from "@/components/lab/print-now";

export const metadata = { title: "Sample label" };

/** A 50 × 25 mm tube label: who, what, and the barcode a scanner reads. */
export default async function LabelPage({ params }: { params: Promise<{ sampleId: string }> }) {
  await requireModulePage("lab");
  await requirePermission("lab.samples");
  const { sampleId } = await params;
  const s = await getSampleLabel(sampleId);
  if (!s) notFound();
  const barcode = await barcodeDataUrl(s.code, { heightMm: 8, scale: 3 });
  return (
    <div className="flex min-h-screen flex-col items-center gap-4 bg-[#eef1ee] py-8">
      <style>{`@page { size: 50mm 25mm; margin: 0; } @media print { body { background:#fff !important; } .no-print { display:none !important; } .label { box-shadow:none !important; } }`}</style>
      <PrintNow />
      <div className="label bg-white shadow" style={{ width: "50mm", height: "25mm", padding: "1.5mm", overflow: "hidden", color: "#000", fontFamily: "Arial, sans-serif" }}>
        <div style={{ fontSize: "8pt", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.patientName}</div>
        <div style={{ fontSize: "6.5pt", whiteSpace: "nowrap", overflow: "hidden" }}>
          {patientNoLabel(s.patientNo)} · {s.ageSex} · {s.sampleTypeName}
        </div>
        <div style={{ fontSize: "6pt", whiteSpace: "nowrap", overflow: "hidden" }}>
          {orderNoLabel(s.orderNo)} · {stampAt(s.createdAt)}
        </div>
        {barcode ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={barcode} alt={s.code} style={{ display: "block", width: "100%", height: "12mm", objectFit: "contain", marginTop: "0.5mm" }} />
        ) : (
          <div style={{ fontSize: "11pt", fontWeight: 700, textAlign: "center", marginTop: "2mm" }}>{s.code}</div>
        )}
      </div>
    </div>
  );
}
