/**
 * The printed lab report (owner, 2083-08-06):
 * - a low or high value is bold, so it shows on a black-and-white print;
 * - a test's note prints after the last test of its group;
 * - for tests billed in a package, the notes print together at the end, just
 *   above the signatures.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportBody, type ReportViewData } from "@/components/lab/report-sheet";
import type { OrderResult, ResultValueView } from "@/lib/repos/lab-orders";
import type { ResultFlag } from "@/lib/lab-flags";

let n = 0;
function value(valueText: string, flag: ResultFlag = "normal"): ResultValueView {
  return { id: `v${++n}`, parameterId: null, label: "", valueText, unit: "", refText: "", flag, remarks: "" };
}
function result(testName: string, o: Partial<OrderResult> & { v?: ResultValueView } = {}): OrderResult {
  const { v, ...rest } = o;
  return {
    id: `r${++n}`, orderTestId: "", testId: "", testName, shortCode: "", groupName: "", packageName: "",
    departmentId: null, departmentName: "Lab", departmentOrder: 1, showUnit: true, showRange: true,
    method: "", description: "", status: "approved", sampleStatus: null, technicianRemarks: "",
    interpretation: "", correctionNote: "", enteredByName: "", submittedAt: null, approvedByName: "",
    approvedAt: null, hasAbnormal: false, hasCritical: false, version: 1, fields: [],
    values: [{ ...(v ?? value("1")), label: testName }],
    ...rest,
  };
}
function view(results: OrderResult[]): ReportViewData {
  return {
    company: { name: "Sample Health Clinic", address: "", phone: "" },
    headerImage: "", footerImage: "", margins: { topMm: 10, bottomMm: 10, xMm: 10 }, pageNote: "", endNote: "",
    patient: { name: "Ram Thapa", patientNo: "P-000001", age: "52 Y", gender: "Male", phone: "", address: "" },
    order: { orderNo: "LAB-000001", invoiceLabel: "000001", referredBy: "", collectedOn: "", receivedOn: "", releasedOn: "" },
    sections: [{ departmentName: "Immunology", showUnit: true, showRange: true, results }],
    signatories: [], qrDataUrl: "", publicUrl: "", barcodeDataUrl: "",
  };
}
const at = (html: string, text: string) => {
  const i = html.indexOf(text);
  if (i < 0) throw new Error(`not on the report: ${text}`);
  return i;
};

describe("a low or high value", () => {
  it("is bold, and a normal value is not", () => {
    const html = renderToStaticMarkup(
      <ReportBody d={view([result("TSH", { v: value("9.8", "high") }), result("FT3", { v: value("3.1") })])} />,
    );
    expect(html).toMatch(/font-weight:800[^>]*>9\.8<span[^>]*font-weight:800[^>]*>H<\/span>/);
    expect(html).toMatch(/font-weight:400[^>]*>3\.1</);
  });
});

describe("a test's note", () => {
  it("prints after the last test of its group, named, before the next group", () => {
    const html = renderToStaticMarkup(
      <ReportBody
        d={view([
          result("Free T3", { groupName: "TFT", description: "T3 note." }),
          result("Free T4", { groupName: "TFT", description: "T4 note." }),
          result("TSH", { groupName: "TFT" }),
          result("Vitamin D", { description: "Vitamin D note." }),
        ])}
      />,
    );
    const lastTft = at(html, ">TSH<");
    expect(at(html, "T3 note.")).toBeGreaterThan(lastTft);
    expect(at(html, "T4 note.")).toBeGreaterThan(at(html, "T3 note."));
    expect(at(html, "T4 note.")).toBeLessThan(at(html, ">Vitamin D<"));
    expect(html).toMatch(/>Free T3: <\/span>T3 note\./);
    // a test on its own: its note sits right under it, after its row
    expect(at(html, "Vitamin D note.")).toBeGreaterThan(at(html, ">Vitamin D<"));
    expect(html).not.toContain(">Notes<");
  });

  it("for tests billed in a package, prints at the end with the others, just before the end of the report", () => {
    const html = renderToStaticMarkup(
      <ReportBody
        d={view([
          result("Free T3", { groupName: "TFT", packageName: "Whole Body Check-up", description: "T3 note." }),
          result("TSH", { groupName: "TFT", packageName: "Whole Body Check-up" }),
          result("HbA1c", { packageName: "Whole Body Check-up", description: "HbA1c note." }),
          result("Vitamin D", { description: "Vitamin D note." }),
        ])}
      />,
    );
    const notes = at(html, ">Notes<");
    expect(notes).toBeGreaterThan(at(html, ">Vitamin D<"));
    expect(at(html, "T3 note.")).toBeGreaterThan(notes);
    expect(at(html, "HbA1c note.")).toBeGreaterThan(at(html, "T3 note."));
    expect(at(html, "End of report")).toBeGreaterThan(at(html, "HbA1c note."));
    expect(html).toMatch(/>HbA1c: <\/span>HbA1c note\./);
    // a test billed on its own keeps its note under it
    expect(at(html, "Vitamin D note.")).toBeLessThan(notes);
    expect(html.match(/T3 note\./g)).toHaveLength(1);
  });
});

describe("the lab's note on a box (owner, 2083-08-09)", () => {
  it("prints once, after the box's last test row, before the next box", () => {
    const html = renderToStaticMarkup(
      <ReportBody
        d={view([
          result("Triglyceride", { groupName: "Lipid Profile" }),
          // Result entry keeps the box's note on one of its tests
          result("HDL", { groupName: "Lipid Profile", technicianRemarks: "Sample slightly lipaemic." }),
          result("LDL", { groupName: "Lipid Profile" }),
          result("Calcium", { technicianRemarks: "Repeated twice." }),
        ])}
      />,
    );
    expect(at(html, "Sample slightly lipaemic.")).toBeGreaterThan(at(html, ">LDL<"));
    expect(at(html, "Sample slightly lipaemic.")).toBeLessThan(at(html, ">Calcium<"));
    expect(at(html, "Repeated twice.")).toBeGreaterThan(at(html, ">Calcium<"));
    expect(html.match(/Sample slightly lipaemic\./g)).toHaveLength(1);
    expect(html).toMatch(/>Note: <\/span>Sample slightly lipaemic\./);
  });
});
