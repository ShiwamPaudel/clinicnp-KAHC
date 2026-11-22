import { Fragment } from "react";
import { flagSymbol } from "@/lib/lab-flags";
import type { OrderResult, ResultValueView } from "@/lib/repos/lab-orders";

/**
 * report-sheet.tsx — the laboratory report on A4.
 *
 * Plain markup, no hooks, so the in-lab print page, the patient's page and the
 * paginated print view all render exactly the same content. Colours are fixed
 * (not theme tokens) because this is paper.
 */

export interface ReportViewData {
  company: { name: string; address: string; phone: string };
  headerImage: string;
  footerImage: string;
  margins: { topMm: number; bottomMm: number; xMm: number };
  patient: { name: string; patientNo: string; ageSex: string; phone: string; address: string };
  order: { orderNo: string; invoiceLabel: string; referredBy: string; billedOn: string; reportedOn: string };
  sections: { departmentName: string; showUnit: boolean; showRange: boolean; results: OrderResult[] }[];
  signatories: { id: string; name: string; description: string; image: string }[];
  qrDataUrl: string;
  publicUrl: string;
  barcodeDataUrl: string;
  /** shown on the patient's page when some tests are still in the lab */
  pendingNote?: string;
}

const INK = "#16241b";
const MUTED = "#5f6b63";

export function ReportHeader({ d, show = true }: { d: ReportViewData; show?: boolean }) {
  if (!show) return null;
  if (d.headerImage) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={d.headerImage} alt="" style={{ display: "block", width: "100%" }} />;
  }
  return (
    <div style={{ textAlign: "center", padding: "6mm 0 2mm", borderBottom: `1px solid ${INK}` }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{d.company.name}</div>
      <div style={{ fontSize: 12, color: MUTED }}>{[d.company.address, d.company.phone && `Ph: ${d.company.phone}`].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

export function ReportFooter({ d, show = true }: { d: ReportViewData; show?: boolean }) {
  if (!show || !d.footerImage) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={d.footerImage} alt="" style={{ display: "block", width: "100%" }} />;
}

/** The signature row, repeated at the foot of every page. */
export function ReportSignatures({ d }: { d: ReportViewData }) {
  if (d.signatories.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: d.signatories.length <= 2 ? "space-between" : "space-around",
        gap: 24,
        padding: `4mm ${d.margins.xMm + 4}mm 1mm`,
        breakInside: "avoid",
      }}
    >
      {d.signatories.map((s) => (
        <div key={s.id} style={{ textAlign: "center", fontSize: 12 }}>
          {s.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.image} alt="" style={{ height: 44, margin: "0 auto 2px", objectFit: "contain" }} />
          ) : (
            <div style={{ height: 44 }} />
          )}
          <div style={{ borderTop: `1px solid ${INK}`, padding: "2px 18px 0" }}>
            <div style={{ fontWeight: 600 }}>{s.name}</div>
            {s.description && <div style={{ fontSize: 11, color: MUTED, whiteSpace: "pre-line" }}>{s.description}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Line({ label, value, right }: { label: string; value: string; right?: boolean }) {
  return (
    <div style={{ textAlign: right ? "right" : "left" }}>
      <span style={{ color: MUTED }}>{label}: </span>
      <span style={{ fontWeight: 600 }}>{value || "-"}</span>
    </div>
  );
}

function widths(showUnit: boolean, showRange: boolean) {
  if (showUnit && showRange) return { name: "38%", result: "20%", unit: "14%", ref: "28%" };
  if (showRange) return { name: "44%", result: "22%", unit: "0", ref: "34%" };
  if (showUnit) return { name: "52%", result: "28%", unit: "20%", ref: "0" };
  return { name: "62%", result: "38%", unit: "0", ref: "0" };
}

function ValueRow({ v, label, indent, showUnit, showRange }: { v: ResultValueView; label: string; indent: number; showUnit: boolean; showRange: boolean }) {
  const flagged = v.flag !== "normal";
  return (
    <tr style={{ breakInside: "avoid" }}>
      <td style={{ padding: `1px 0 1px ${indent * 4}mm` }}>{label}</td>
      <td style={{ padding: "1px 0", fontWeight: flagged ? 700 : 500 }}>
        {v.valueText || "-"}
        {flagged && <span style={{ marginLeft: 4 }}>{flagSymbol(v.flag)}</span>}
      </td>
      {showUnit && <td style={{ padding: "1px 0", color: MUTED }}>{v.unit}</td>}
      {showRange && <td style={{ padding: "1px 0", color: MUTED }}>{v.refText}</td>}
    </tr>
  );
}

/** Everything between the letterhead header and footer. */
export function ReportBody({ d }: { d: ReportViewData }) {
  const notes = d.sections.flatMap((s) => s.results).filter((r) => r.interpretation.trim());
  return (
    <div style={{ color: INK, fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
        <div style={{ width: "45mm" }} />
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", border: `1px solid ${INK}`, padding: "2px 14px" }}>
          Laboratory report
        </div>
        <div style={{ width: "45mm" }}>
          {d.barcodeDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.barcodeDataUrl} alt={d.patient.patientNo} style={{ display: "block", marginLeft: "auto", height: "12mm", maxWidth: "100%" }} />
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginTop: 8,
          padding: "6px 0",
          borderTop: `1px solid ${INK}33`,
          borderBottom: `1px solid ${INK}33`,
          fontSize: 13,
        }}
      >
        <div>
          <Line label="Patient" value={d.patient.name} />
          <Line label="Patient no." value={d.patient.patientNo} />
          <Line label="Age / Sex" value={d.patient.ageSex} />
          <Line label="Address" value={d.patient.address} />
        </div>
        <div>
          <Line label="Lab no." value={d.order.orderNo} right />
          <Line label="Bill" value={d.order.invoiceLabel} right />
          <Line label="Referred by" value={d.order.referredBy} right />
          <Line label="Billed" value={d.order.billedOn} right />
          <Line label="Reported" value={d.order.reportedOn} right />
        </div>
      </div>

      {d.sections.map((s) => {
        const w = widths(s.showUnit, s.showRange);
        const cols = 2 + (s.showUnit ? 1 : 0) + (s.showRange ? 1 : 0);
        const groups: { key: string; name: string; items: OrderResult[] }[] = [];
        for (const r of s.results) {
          const key = r.groupName || `solo:${r.id}`;
          let g = groups.find((x) => x.key === key);
          if (!g) groups.push((g = { key, name: r.groupName, items: [] }));
          g.items.push(r);
        }
        return (
          <div key={s.departmentName} style={{ marginTop: 10 }}>
            <div style={{ background: "#eef2ee", padding: "3px 6px", fontWeight: 800, fontSize: 13.5, textTransform: "uppercase", letterSpacing: 0.5, breakAfter: "avoid" }}>
              {s.departmentName}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: MUTED, borderBottom: `1px solid ${INK}26` }}>
                  <th style={{ width: w.name, padding: "3px 0", fontWeight: 600 }}>Investigation</th>
                  <th style={{ width: w.result, padding: "3px 0", fontWeight: 600 }}>Result</th>
                  {s.showUnit && <th style={{ width: w.unit, padding: "3px 0", fontWeight: 600 }}>Unit</th>}
                  {s.showRange && <th style={{ width: w.ref, padding: "3px 0", fontWeight: 600 }}>Reference range</th>}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {g.name && (
                      <tr>
                        <td colSpan={cols} style={{ paddingTop: 5, fontWeight: 700, fontSize: 13.5 }}>
                          {g.name}
                        </td>
                      </tr>
                    )}
                    {g.items.map((r) => {
                      const inGroup = Boolean(g.name);
                      const only = r.values.length === 1 ? r.values[0]! : null;
                      const oneLine = only != null && (only.parameterId == null || only.label.trim().toLowerCase() === r.testName.trim().toLowerCase());
                      return (
                        <Fragment key={r.id}>
                          {oneLine ? (
                            <ValueRow v={only!} label={r.testName} indent={inGroup ? 1 : 0} showUnit={s.showUnit} showRange={s.showRange} />
                          ) : (
                            <>
                              <tr>
                                <td colSpan={cols} style={{ paddingTop: 3, paddingLeft: inGroup ? "4mm" : 0, fontWeight: 600, textDecoration: "underline" }}>
                                  {r.testName}
                                </td>
                              </tr>
                              {r.values.map((v) => (
                                <ValueRow key={v.id} v={v} label={v.label} indent={inGroup ? 2 : 1} showUnit={s.showUnit} showRange={s.showRange} />
                              ))}
                            </>
                          )}
                          {r.method && (
                            <tr>
                              <td colSpan={cols} style={{ paddingLeft: inGroup ? "4mm" : 0, fontSize: 10.5, fontStyle: "italic", color: MUTED }}>
                                Method: {r.method}
                              </td>
                            </tr>
                          )}
                          {(r.technicianRemarks || r.description) && (
                            <tr>
                              <td colSpan={cols} style={{ paddingLeft: inGroup ? "4mm" : 0, fontSize: 10.5, fontStyle: "italic", color: MUTED }}>
                                {[r.technicianRemarks, r.description].filter(Boolean).join(" · ")}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {notes.length > 0 && (
        <div style={{ marginTop: 12, border: "1px solid #d9dfda", background: "#f7f9f7", padding: 6, fontSize: 12, breakInside: "avoid" }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Comments</div>
          {notes.map((r) => (
            <div key={r.id}>
              <span style={{ fontWeight: 600 }}>{r.testName}: </span>
              {r.interpretation}
            </div>
          ))}
        </div>
      )}

      {d.pendingNote && (
        <div style={{ marginTop: 12, border: "1px solid #e8c77a", background: "#fdf6e3", padding: 6, fontSize: 11.5, breakInside: "avoid" }}>
          <span style={{ fontWeight: 700 }}>Part of the report · </span>
          {d.pendingNote}
        </div>
      )}

      <p style={{ marginTop: 10, textAlign: "center", fontSize: 10, fontStyle: "italic", color: MUTED }}>
        ** End of report ** · L low · H high · LL / HH critical
      </p>

      {d.qrDataUrl && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 11, breakInside: "avoid" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.qrDataUrl} alt="" style={{ width: 60, height: 60 }} />
          <div>
            <div style={{ fontWeight: 600 }}>Scan to open this report</div>
            <div style={{ wordBreak: "break-all", color: MUTED }}>{d.publicUrl}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The whole sheet as one table, so the browser repeats the header (thead) and
 * the signatures + footer (tfoot) on every printed page. With a band switched
 * off, the configured margin is kept blank instead, for pre-printed pads.
 */
export function ReportSheet({ d, showHeader = true, showFooter = true }: { d: ReportViewData; showHeader?: boolean; showFooter?: boolean }) {
  return (
    <div className="lab-a4" style={{ background: "#fff", color: INK, width: "210mm", margin: "0 auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ display: "table-header-group" }}>
          <tr>
            <td style={{ padding: 0 }}>
              <div style={{ minHeight: `${d.margins.topMm}mm` }}>
                <ReportHeader d={d} show={showHeader} />
              </div>
            </td>
          </tr>
        </thead>
        <tfoot style={{ display: "table-footer-group" }}>
          <tr>
            <td style={{ padding: 0 }}>
              <ReportSignatures d={d} />
              <div style={{ minHeight: `${d.margins.bottomMm}mm` }}>
                <ReportFooter d={d} show={showFooter} />
              </div>
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td style={{ padding: `3mm ${d.margins.xMm}mm` }}>
              <ReportBody d={d} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
