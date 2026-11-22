import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { requireAnyModulePage } from "@/lib/modules";
import { getCompany } from "@/lib/repos/company";
import { getAdvanceReceipt } from "@/lib/repos/prebookings";
import { formatPaisa } from "@/lib/money";
import { formatTime } from "@/lib/appointment-types";
import { stampAt } from "@/lib/lab-format";
import { PrintNow } from "@/components/lab/print-now";

export const metadata = { title: "Advance receipt" };

/** An A5 receipt for money paid on a pre-booking before the bill (0031). */
export default async function AdvanceReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyModulePage(["clinic", "lab"]);
  await requirePermission(["appointments.manage", "counter.use"]);
  const { id } = await params;
  const [r, company] = await Promise.all([getAdvanceReceipt(id), getCompany()]);
  if (!r) notFound();
  const b = r.booking;
  const line = (label: string, value: string) => (
    <div style={{ display: "flex", gap: 8, padding: "2px 0" }}>
      <span style={{ width: 110, color: "#555" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
  return (
    <div className="flex min-h-screen flex-col items-center gap-4 bg-[#eef1ee] py-8">
      <style>{`@page { size: A5; margin: 10mm; } @media print { body { background:#fff !important; } .no-print { display:none !important; } .sheet { box-shadow:none !important; } }`}</style>
      <PrintNow />
      <div className="sheet bg-white shadow" style={{ width: "128mm", padding: "8mm", color: "#111", fontFamily: "Arial, sans-serif", fontSize: "10.5pt" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #ccc", paddingBottom: 8 }}>
          {company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="" style={{ height: 44, maxWidth: 140, objectFit: "contain" }} />
          )}
          <div>
            <div style={{ fontSize: "13pt", fontWeight: 800 }}>{company.name}</div>
            <div style={{ fontSize: "9pt", color: "#444" }}>{[company.address, company.phone, company.panNo ? `PAN ${company.panNo}` : ""].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "10px 0 6px" }}>
          <div style={{ fontSize: "13pt", fontWeight: 800, letterSpacing: 0.5 }}>ADVANCE RECEIPT</div>
          <div style={{ fontWeight: 700 }}>{r.receiptLabel}</div>
        </div>
        {line("Date", `${r.dateBs} · ${stampAt(r.createdAt)}`)}
        {line("Received from", b.name)}
        {b.phone && line("Phone", b.phone)}
        {line("Booked for", `${b.dateBs} · ${formatTime(b.timeHhmm)}${b.doctorName ? ` · ${b.doctorName}` : ""}`)}
        {b.items.length > 0 && line("Tests / services", b.items.map((i) => i.name).join(", "))}
        <div style={{ margin: "10px 0", padding: "8px 10px", border: "1.5px solid #222", borderRadius: 6, display: "flex", justifyContent: "space-between", fontSize: "13pt", fontWeight: 800 }}>
          <span>Amount received</span>
          <span>{formatPaisa(r.amountPaisa)}</span>
        </div>
        {line("Paid by", r.method === "qr" ? "QR / wallet" : "Cash")}
        {r.note && line("Note", r.note)}
        <div style={{ marginTop: 10, fontSize: "9pt", color: "#444" }}>
          This is an advance, not a bill. It is taken off the bill when the patient comes. Bring this receipt.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 26 }}>
          <div style={{ borderTop: "1px solid #555", paddingTop: 3, minWidth: 150, textAlign: "center", fontSize: "9pt" }}>{r.takenBy || "Received by"}</div>
        </div>
      </div>
    </div>
  );
}
