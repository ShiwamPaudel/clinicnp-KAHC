/**
 * The bill and report wording the owner asked for (2083-08-08):
 * - bill: Name, Age / Gender, "08-08-2083 / 4:00 PM", Sub Total, Discount
 *   (or "-"), Net Payable with the amount in words under it, Invoice Issued
 *   by, and a package's profiles and tests under the package line;
 * - report: Lab ID No., Name, Gender, Referred by on the left; Invoice No.
 *   and the sample and release dates on the right; one bordered box per
 *   profile with its name as the heading.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { amountInWords, numberInWords, stampNumeric, time12, bsTextNumeric } from "@/lib/print-format";
import { InvoiceA4 } from "@/components/print/invoice-a4";
import { ReportBody, ReportSheet, type ReportViewData } from "@/components/lab/report-sheet";
import type { PrintBill } from "@/lib/print-types";
import type { OrderResult } from "@/lib/repos/lab-orders";

describe("amount in words", () => {
  it("counts in lakh and crore and ends with Only", () => {
    expect(amountInWords(400000)).toBe("Rupees Four Thousand Only");
    expect(amountInWords(12345600)).toBe("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only");
    expect(numberInWords(25_07_00_011)).toBe("Twenty Five Crore Seven Lakh Eleven");
    expect(amountInWords(1050)).toBe("Rupees Ten and Fifty Paisa Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
});

describe("date and time on paper", () => {
  it("is the BS date as day-month-year and a 12-hour Nepal time", () => {
    expect(bsTextNumeric("2083-08-08")).toBe("08-08-2083");
    // 10:15 UTC is 4:00 PM in Nepal, whatever clock the server runs on
    expect(time12("2026-11-24T10:15:00.000Z")).toBe("4:00 PM");
    expect(stampNumeric("2026-11-24T10:15:00.000Z")).toBe("08-08-2083 / 4:00 PM");
    // just after midnight in Nepal is still the next BS day
    expect(stampNumeric("2026-11-24T18:20:00.000Z")).toBe("09-08-2083 / 12:05 AM");
    expect(stampNumeric(null)).toBe("");
  });
});

function bill(o: Partial<PrintBill> = {}): PrintBill {
  return {
    company: { name: "Sample Health Clinic", address: "", phone: "", panNo: "", ddaNo: "", vatRegistered: false, invoiceFooter: "", logoUrl: null },
    invoiceLabel: "000003",
    provisional: false,
    dateTime: "08-08-2083 / 4:00 PM",
    patientName: "Ram Thapa",
    patient: { patientNo: 3, name: "Ram Thapa", ageSex: "52Y / Male" },
    serviceLines: [
      {
        name: "Whole Body Check Up", doctorName: "", qty: 1, ratePaisa: 400000, discountPaisa: 0, amountPaisa: 400000,
        rateOverridden: false, followupNote: "", includes: ["Lipid Profile", "Liver Function Test", "Blood Grouping"],
      },
    ],
    lines: [],
    subtotalPaisa: 400000,
    billDiscountPaisa: 0,
    vatPaisa: 0,
    totalPaisa: 400000,
    paymentMethod: "cash",
    tenderedPaisa: 0,
    changePaisa: 0,
    userName: "Sita Rai",
    ...o,
  };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the printed bill", () => {
  it("names the patient as Name, with Age / Gender and one Date / Time", () => {
    const t = text(renderToStaticMarkup(<InvoiceA4 bill={bill()} />));
    expect(t).toContain("Name P-000003 · Ram Thapa");
    expect(t).toContain("Age / Gender 52Y / Male");
    expect(t).toContain("Date / Time 08-08-2083 / 4:00 PM");
    expect(t).not.toMatch(/\bSex\b|\bPatient\b/);
  });

  it("totals as Sub Total, Discount (- when none) and Net Payable, the amount in words under it", () => {
    const t = text(renderToStaticMarkup(<InvoiceA4 bill={bill()} />));
    expect(t).toMatch(/Sub Total .*Discount - .*Net Payable .*Rupees Four Thousand Only/);
    const withDiscount = text(
      renderToStaticMarkup(<InvoiceA4 bill={bill({ billDiscountPaisa: 40000, totalPaisa: 360000 })} />),
    );
    expect(withDiscount).toContain("Discount − रू 400.00");
    expect(withDiscount).toContain("Rupees Three Thousand Six Hundred Only");
  });

  it("says who issued it", () => {
    expect(text(renderToStaticMarkup(<InvoiceA4 bill={bill()} />))).toContain("Invoice Issued by Sita Rai");
  });

  it("lists a package's profiles and tests under it, one per line", () => {
    const html = renderToStaticMarkup(<InvoiceA4 bill={bill()} />);
    expect(html).toContain("<div>Lipid Profile</div><div>Liver Function Test</div><div>Blood Grouping</div>");
  });
});

let n = 0;
function result(testName: string, groupName = ""): OrderResult {
  return {
    id: `r${++n}`, orderTestId: "", testId: "", testName, shortCode: "", groupName, packageName: "",
    departmentId: null, departmentName: "Biochemistry", departmentOrder: 1, showUnit: true, showRange: true,
    method: "", description: "", status: "approved", sampleStatus: null, technicianRemarks: "",
    interpretation: "", correctionNote: "", enteredByName: "", submittedAt: null, approvedByName: "",
    approvedAt: null, hasAbnormal: false, hasCritical: false, version: 1, fields: [],
    values: [{ id: `v${++n}`, parameterId: null, label: testName, valueText: "1", unit: "", refText: "", flag: "normal", remarks: "" }],
  };
}
function view(results: OrderResult[]): ReportViewData {
  return {
    company: { name: "Sample Health Clinic", address: "", phone: "" },
    headerImage: "", footerImage: "", margins: { topMm: 10, bottomMm: 10, xMm: 10 }, pageNote: "", endNote: "",
    patient: { name: "Ram Thapa", patientNo: "P-000003", age: "52Y", gender: "Male", phone: "", address: "Itahari" },
    order: {
      orderNo: "LAB-000003", invoiceLabel: "000003", referredBy: "Dr. Sample",
      collectedOn: "08-08-2083 / 9:10 AM", receivedOn: "08-08-2083 / 10:00 AM", releasedOn: "08-08-2083 / 4:00 PM",
    },
    sections: [{ departmentName: "Biochemistry", showUnit: true, showRange: true, results }],
    signatories: [], qrDataUrl: "", publicUrl: "", barcodeDataUrl: "",
  };
}

describe("the report header", () => {
  it("has the patient on the left and the numbers and dates on the right, five a side", () => {
    const t = text(renderToStaticMarkup(<ReportBody d={view([result("Uric Acid")])} />));
    expect(t).toMatch(
      /Name: Ram Thapa Age \/ Gender: 52Y \/ Male Referred by: Dr. Sample Patient No.: P-000003 Address: Itahari/,
    );
    expect(t).toMatch(
      /Lab ID No.: LAB-000003 Invoice No.: 000003 Sample Collected on: 08-08-2083 \/ 9:10 AM Sample Received on: 08-08-2083 \/ 10:00 AM Report Released on: 08-08-2083 \/ 4:00 PM/,
    );
  });
});

describe("the report's boxes", () => {
  it("puts each profile in its own bordered box headed by its name, and single tests together in one", () => {
    const html = renderToStaticMarkup(
      <ReportBody
        d={view([
          result("SGPT", "Liver Function Test"),
          result("SGOT", "Liver Function Test"),
          result("Uric Acid"),
          result("Total Cholesterol", "Lipid Profile"),
          result("Calcium"),
        ])}
      />,
    );
    // blocks, not tables: the paged print layout cannot split a table (2083-08-09)
    expect(html).not.toContain("<table");
    const boxes = html.split("data-box=").slice(1);
    expect(boxes).toHaveLength(3);
    for (const b of boxes) expect(b).toMatch(/^"[^"]*" style="[^"]*border:1px solid/);
    expect(boxes[0]).toMatch(/^"Liver Function Test"/);
    expect(boxes[0]).toContain(">SGPT<");
    expect(boxes[0]).toContain(">SGOT<");
    expect(boxes[1]).toMatch(/^"tests"/);
    expect(boxes[1]).toContain(">Uric Acid<");
    expect(boxes[1]).toContain(">Calcium<");
    expect(boxes[2]).toMatch(/^"Lipid Profile"/);
  });
});

describe("the lab's notes (Settings, Lab report)", () => {
  it("prints the end note once, after the results and before End of report", () => {
    const d = { ...view([result("Uric Acid")]), endNote: "Results relate only to the sample tested." };
    const html = renderToStaticMarkup(<ReportBody d={d} />);
    expect(html.match(/Results relate only/g)).toHaveLength(1);
    expect(html.indexOf("Results relate only")).toBeGreaterThan(html.indexOf(">Uric Acid<"));
    expect(html.indexOf("Results relate only")).toBeLessThan(html.indexOf("End of report"));
  });

  it("prints the page note in the footer that repeats on every page, not in the body", () => {
    const d = { ...view([result("Uric Acid")]), pageNote: "Not valid for medico-legal purposes." };
    expect(renderToStaticMarkup(<ReportBody d={d} />)).not.toContain("medico-legal");
    const sheet = renderToStaticMarkup(<ReportSheet d={d} />);
    const foot = sheet.slice(sheet.indexOf("<tfoot"), sheet.indexOf("</tfoot>"));
    expect(foot).toContain("Not valid for medico-legal purposes.");
  });
});
