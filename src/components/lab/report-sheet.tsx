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
  /** Settings → Lab report (0034): at the foot of every page, and once at the end */
  pageNote: string;
  endNote: string;
  patient: { name: string; patientNo: string; age: string; gender: string; phone: string; address: string };
  /** dates as printed, "08-08-2083 / 4:00 PM"; empty prints "-" */
  order: { orderNo: string; invoiceLabel: string; referredBy: string; collectedOn: string; receivedOn: string; releasedOn: string };
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

/** The lab's note at the foot of every page (Settings → Lab report). */
export function ReportPageNote({ d }: { d: ReportViewData }) {
  if (!d.pageNote) return null;
  return (
    <div style={{ padding: `1mm ${d.margins.xMm + 4}mm 0`, textAlign: "center", fontSize: 10.5, color: INK, whiteSpace: "pre-line" }}>
      {d.pageNote}
    </div>
  );
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
            <img src={s.image} alt="" style={{ height: 66, margin: "0 auto 2px", objectFit: "contain" }} />
          ) : (
            <div style={{ height: 66 }} />
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

/** The columns of a results box, as grid tracks. */
function columns(showUnit: boolean, showRange: boolean): string {
  if (showUnit && showRange) return "38fr 20fr 14fr 28fr";
  if (showRange) return "44fr 22fr 34fr";
  if (showUnit) return "52fr 28fr 20fr";
  return "62fr 38fr";
}

/*
 * The results are blocks, not tables (2083-08-09): they split cleanly between
 * rows when a box runs onto the next page, and a box split over two pages is
 * drawn as two boxes. The browser lays the pages out now (report-print-view).
 */
function ValueRow({ v, label, indent, showUnit, showRange }: { v: ResultValueView; label: string; indent: number; showUnit: boolean; showRange: boolean }) {
  const flagged = v.flag !== "normal";
  const cols = columns(showUnit, showRange);
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, breakInside: "avoid" }}>
      <div style={{ padding: `1px 6px 1px calc(${indent * 4}mm + 6px)` }}>{label}</div>
      {/* weight, not colour, marks a low or high value: the report is often printed in black and white */}
      <div style={{ padding: "1px 0", fontWeight: flagged ? 800 : 400 }}>
        {v.valueText || "-"}
        {flagged && <span style={{ marginLeft: 4, fontWeight: 800 }}>{flagSymbol(v.flag)}</span>}
      </div>
      {showUnit && <div style={{ padding: "1px 0", color: MUTED }}>{v.unit}</div>}
      {showRange && <div style={{ padding: "1px 6px 1px 0", color: MUTED }}>{v.refText}</div>}
    </div>
  );
}

/** Everything between the letterhead header and footer. */
export function ReportBody({ d }: { d: ReportViewData }) {
  const all = d.sections.flatMap((s) => s.results);
  const notes = all.filter((r) => r.interpretation.trim());
  // A test's note prints after the last test of its group; for tests billed in
  // a package, all of them together at the end of the report, just above the
  // signatures (owner, 2083-08-06).
  const packageNotes = all.filter((r) => r.packageName && r.description.trim());
  return (
    // tighter lines than the app's 1.5, so more tests fit on a page at the same font size
    <div style={{ color: INK, fontSize: 13, lineHeight: 1.3 }}>
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
        {/* owner, 2083-08-08/09: five lines a side; Age / Gender on one line, as on the bill */}
        <div>
          <Line label="Name" value={d.patient.name} />
          <Line label="Age / Gender" value={[d.patient.age, d.patient.gender].filter(Boolean).join(" / ")} />
          <Line label="Referred by" value={d.order.referredBy} />
          <Line label="Patient No." value={d.patient.patientNo} />
          <Line label="Address" value={d.patient.address} />
        </div>
        <div>
          <Line label="Lab ID No." value={d.order.orderNo} right />
          <Line label="Invoice No." value={d.order.invoiceLabel} right />
          <Line label="Sample Collected on" value={d.order.collectedOn} right />
          <Line label="Sample Received on" value={d.order.receivedOn} right />
          <Line label="Report Released on" value={d.order.releasedOn} right />
        </div>
      </div>

      {d.sections.map((s) => {
        const cols = columns(s.showUnit, s.showRange);
        // One bordered box per profile, its name as the heading (owner,
        // 2083-08-08). The department's tests billed on their own share one
        // box, where the first of them stands.
        const boxes: { key: string; name: string; items: OrderResult[] }[] = [];
        for (const r of s.results) {
          const key = r.groupName ? `group:${r.groupName}` : "solo";
          let b = boxes.find((x) => x.key === key);
          if (!b) boxes.push((b = { key, name: r.groupName, items: [] }));
          b.items.push(r);
        }
        const line = { padding: "0 6px", fontSize: 10.5, fontStyle: "italic" as const, color: MUTED };
        return (
          <div key={s.departmentName} style={{ marginTop: 8 }}>
            <div style={{ background: "#eef2ee", padding: "2px 6px", fontWeight: 800, fontSize: 13.5, textTransform: "uppercase", letterSpacing: 0.5, breakAfter: "avoid" }}>
              {s.departmentName}
            </div>
            {boxes.map((b) => {
              const inGroup = Boolean(b.name);
              const noteRow = (r: OrderResult, first: boolean) => (
                <div key={`note-${r.id}`} style={{ ...line, padding: `${first ? 3 : 1}px 6px 1px 6px`, breakInside: "avoid" }}>
                  {inGroup && <span style={{ fontStyle: "normal", fontWeight: 600, color: INK }}>{r.testName}: </span>}
                  {r.description}
                </div>
              );
              const groupNotes = inGroup ? b.items.filter((r) => !r.packageName && r.description.trim()) : [];
              return (
                <div
                  key={b.key}
                  data-box={b.name || "tests"}
                  // split over two pages, each part is drawn as a closed box
                  style={{ fontSize: 12.5, marginTop: 4, border: `1px solid ${INK}`, paddingBottom: 3, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}
                >
                  {b.name && (
                    <div style={{ padding: "3px 6px", fontWeight: 700, fontSize: 13.5, borderBottom: `1px solid ${INK}40`, breakAfter: "avoid" }}>
                      {b.name}
                    </div>
                  )}
                  <div
                    style={{ display: "grid", gridTemplateColumns: cols, color: MUTED, fontWeight: 600, borderBottom: `1px solid ${INK}40`, breakAfter: "avoid" }}
                  >
                    <div style={{ padding: "2px 6px" }}>Investigation</div>
                    <div style={{ padding: "2px 0" }}>Result</div>
                    {s.showUnit && <div style={{ padding: "2px 0" }}>Unit</div>}
                    {s.showRange && <div style={{ padding: "2px 6px 2px 0" }}>Reference range</div>}
                  </div>
                  {b.items.map((r) => {
                    const only = r.values.length === 1 ? r.values[0]! : null;
                    const oneLine = only != null && (only.parameterId == null || only.label.trim().toLowerCase() === r.testName.trim().toLowerCase());
                    return (
                      <Fragment key={r.id}>
                        {oneLine ? (
                          <ValueRow v={only!} label={r.testName} indent={0} showUnit={s.showUnit} showRange={s.showRange} />
                        ) : (
                          <>
                            <div style={{ padding: "2px 6px 0", fontWeight: 600, textDecoration: "underline" }}>{r.testName}</div>
                            {r.values.map((v) => (
                              <ValueRow key={v.id} v={v} label={v.label} indent={1} showUnit={s.showUnit} showRange={s.showRange} />
                            ))}
                          </>
                        )}
                        {r.method && <div style={line}>Method: {r.method}</div>}
                        {/* a test on its own: its note right under it */}
                        {!inGroup && !r.packageName && r.description.trim() && noteRow(r, true)}
                      </Fragment>
                    );
                  })}
                  {/* the lab's note on this box (Result entry keeps one per profile
                      or department), after its last test row (owner, 2083-08-09) */}
                  {b.items
                    .filter((r) => r.technicianRemarks.trim())
                    .map((r) => (
                      <div key={`remark-${r.id}`} style={{ padding: "3px 6px 1px", fontSize: 11.5, whiteSpace: "pre-line", breakInside: "avoid" }}>
                        <span style={{ fontWeight: 700 }}>Note: </span>
                        {r.technicianRemarks.trim()}
                      </div>
                    ))}
                  {/* a profile's notes after its last test */}
                  {groupNotes.map((r, i) => noteRow(r, i === 0))}
                </div>
              );
            })}
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

      {packageNotes.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 10.5, color: MUTED }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: INK, marginBottom: 2 }}>Notes</div>
          {packageNotes.map((r) => (
            <div key={r.id} style={{ fontStyle: "italic", marginBottom: 2, breakInside: "avoid" }}>
              <span style={{ fontStyle: "normal", fontWeight: 600, color: INK }}>{r.testName}: </span>
              {r.description}
            </div>
          ))}
        </div>
      )}

      {d.endNote && (
        <div style={{ marginTop: 12, fontSize: 11.5, whiteSpace: "pre-line", breakInside: "avoid" }}>{d.endNote}</div>
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
              <ReportPageNote d={d} />
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
