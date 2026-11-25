/** print-types.ts — the fully-resolved bill shape handed to print components. */

export interface PrintBatchLine {
  batchNo: string;
  /** As printed: the English month and year, "12/2026" (D-142). */
  expiry: string;
}

export interface PrintLine {
  name: string;
  genericName: string;
  batches: PrintBatchLine[];
  qty: number;
  unitName: string;
  ratePaisa: number;
  discountPaisa: number;
  amountPaisa: number;
  rateOverridden: boolean;
  controlled: boolean;
}

/** A service line as printed. No batch, no expiry — a service has neither. */
export interface PrintServiceLine {
  name: string;
  doctorName: string;
  qty: number;
  ratePaisa: number;
  discountPaisa: number;
  amountPaisa: number;
  rateOverridden: boolean;
  /** "Follow-up within 7 days — no charge." Printed under the line when set. */
  followupNote: string;
  /** a lab package: its profiles and single tests, one per line under it */
  includes?: string[];
}

/** Who the bill is for, when it is for somebody. */
export interface PrintPatient {
  patientNo: number | null;
  name: string;
  /** already formatted, e.g. "34Y / Female"; empty prints "-" */
  ageSex: string;
}

export interface PrintCompany {
  name: string;
  address: string;
  phone: string;
  panNo: string;
  ddaNo: string;
  invoiceFooter: string;
  vatRegistered: boolean;
  /** The shop's letterhead, as a data URL, printed across the top of a bill.
   *  Null falls back to the name and address set as text. */
  logoUrl: string | null;
}

export interface PrintBill {
  company: PrintCompany;
  invoiceLabel: string; // "000123", or "Slip …" when printed before the number came back
  provisional: boolean;
  /** "08-08-2083 / 4:00 PM": BS date, Nepal time (owner, 2083-08-08) */
  dateTime: string;
  patientName: string;
  /** the registered patient, on a clinic or mixed bill */
  patient?: PrintPatient | null;
  /** printed above the medicine block (Design.md §6) */
  serviceLines?: PrintServiceLine[];
  lines: PrintLine[];
  subtotalPaisa: number;
  billDiscountPaisa: number;
  vatPaisa: number;
  totalPaisa: number;
  paymentMethod: "cash" | "qr" | "credit";
  tenderedPaisa: number;
  changePaisa: number;
  /** on a bill on dues: what was paid at the counter, how, and what was left owing */
  paidNowPaisa?: number;
  paidNowMethod?: "cash" | "qr";
  duePaisa?: number;
  /** who issued the bill (the signed-in person at the counter): "Invoice Issued by" */
  userName: string;
  /** a bill with lab tests: where the patient opens the report, and its QR */
  labReport?: { url: string; qrDataUrl: string } | null;
  /**
   * Issued from a pre-booking (0031): the advance taken off the total, its
   * receipt numbers, and what was handed back when it was more than the bill.
   * With it, `duePaisa` is what is still owed after the advance.
   */
  advance?: { usedPaisa: number; labels: string; handBackPaisa: number } | null;
}
