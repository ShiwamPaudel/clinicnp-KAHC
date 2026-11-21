/**
 * lab-report-view.ts — a report's data shaped for the sheet, with its QR and
 * barcode drawn. Server-only.
 */
import "server-only";
import type { ReportData } from "@/lib/repos/lab-report";
import type { ReportViewData } from "@/components/lab/report-sheet";
import { qrDataUrl, barcodeDataUrl } from "@/lib/lab-codes";
import { bsDateLabel, orderNoLabel, patientNoLabel, stampAtLong } from "@/lib/lab-format";
import { reportUrl } from "@/lib/lab-token";

const SEX: Record<string, string> = { m: "Male", f: "Female", o: "Other" };

export async function toReportView(data: ReportData, origin: string, pendingNote?: string): Promise<ReportViewData> {
  const o = data.order;
  const url = reportUrl(origin, o.reportToken);
  const patientNo = patientNoLabel(o.patient.patientNo);
  const [qr, barcode] = await Promise.all([qrDataUrl(url, 140), barcodeDataUrl(patientNo, { heightMm: 7, scale: 2 })]);
  return {
    company: { name: data.company.name, address: data.company.address, phone: data.company.phone },
    headerImage: data.headerImage,
    footerImage: data.footerImage,
    margins: data.margins,
    patient: {
      name: o.patient.name,
      patientNo,
      ageSex: `${o.patient.ageShort} / ${SEX[o.patient.sex] ?? ""}`,
      phone: o.patient.phone,
      address: o.patient.address,
    },
    order: {
      orderNo: orderNoLabel(o.orderNo),
      invoiceLabel: o.invoiceLabel,
      referredBy: o.referredBy,
      billedOn: bsDateLabel(o.dateBs),
      reportedOn: stampAtLong(data.approvedAt),
    },
    sections: data.sections,
    signatories: data.signatories,
    qrDataUrl: qr,
    publicUrl: url,
    barcodeDataUrl: barcode,
    pendingNote,
  };
}

/**
 * The address a report's QR points at. PUBLIC_APP_URL (the clinic's own
 * domain) wins, so a QR printed while someone happened to open the app on
 * another address (the hosting provider's *.vercel.app, say) still points at
 * the clinic. Without it, the address this request came in on.
 */
export function originOf(h: Headers): string {
  const pinned = publicAppOrigin();
  if (pinned) return pinned;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** PUBLIC_APP_URL as an origin, or null when it is unset or not an http(s) address. */
export function publicAppOrigin(): string | null {
  const raw = process.env.PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}
