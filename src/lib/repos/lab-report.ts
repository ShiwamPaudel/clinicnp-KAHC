/**
 * lab-report.ts — the printed laboratory report: its letterhead, margins and
 * signature blocks (0024), and everything one report needs in one read.
 */
import "server-only";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/repos/company";
import { getOrder, type OrderDetail, type OrderResult } from "@/lib/repos/lab-orders";

export interface LabSettings {
  headerImage: string;
  footerImage: string;
  marginTopMm: number;
  marginBottomMm: number;
  marginXMm: number;
}

export async function getLabSettings(): Promise<LabSettings> {
  const res = await db().execute("SELECT * FROM lab_settings WHERE id = 1");
  const r = res.rows[0];
  return {
    headerImage: (r?.header_image as string) ?? "",
    footerImage: (r?.footer_image as string) ?? "",
    marginTopMm: Number(r?.margin_top_mm ?? 14),
    marginBottomMm: Number(r?.margin_bottom_mm ?? 14),
    marginXMm: Number(r?.margin_x_mm ?? 12),
  };
}

export async function saveLabSettings(s: LabSettings): Promise<void> {
  await db().execute({
    sql: `INSERT INTO lab_settings (id, header_image, footer_image, margin_top_mm, margin_bottom_mm, margin_x_mm, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET header_image = excluded.header_image, footer_image = excluded.footer_image,
            margin_top_mm = excluded.margin_top_mm, margin_bottom_mm = excluded.margin_bottom_mm,
            margin_x_mm = excluded.margin_x_mm, updated_at = excluded.updated_at`,
    args: [s.headerImage, s.footerImage, s.marginTopMm, s.marginBottomMm, s.marginXMm, new Date().toISOString()],
  });
}

export interface Signatory {
  id: string;
  name: string;
  description: string;
  image: string;
  sortOrder: number;
  active: boolean;
}

export async function listSignatories(activeOnly = false): Promise<Signatory[]> {
  const res = await db().execute(
    `SELECT * FROM lab_signatories ${activeOnly ? "WHERE active = 1" : ""} ORDER BY sort_order, name`,
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    image: (r.image as string) ?? "",
    sortOrder: Number(r.sort_order),
    active: Number(r.active) === 1,
  }));
}

export async function saveSignatory(s: Omit<Signatory, "id"> & { id?: string }): Promise<string> {
  const now = new Date().toISOString();
  if (s.id) {
    await db().execute({
      sql: `UPDATE lab_signatories SET name = ?, description = ?, image = ?, sort_order = ?, active = ?, updated_at = ?
             WHERE id = ?`,
      args: [s.name, s.description, s.image, s.sortOrder, s.active ? 1 : 0, now, s.id],
    });
    return s.id;
  }
  const id = ulid();
  await db().execute({
    sql: `INSERT INTO lab_signatories (id, name, description, image, sort_order, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, s.name, s.description, s.image, s.sortOrder, s.active ? 1 : 0, now, now],
  });
  return id;
}

// ---------------------------------------------------------------------------
// one report
// ---------------------------------------------------------------------------

export interface ReportSection {
  departmentName: string;
  showUnit: boolean;
  showRange: boolean;
  results: OrderResult[];
}

export interface ReportData {
  order: OrderDetail;
  company: { name: string; address: string; phone: string; panNo: string };
  /** the report's own header, else the bill letterhead, else nothing */
  headerImage: string;
  footerImage: string;
  margins: { topMm: number; bottomMm: number; xMm: number };
  sections: ReportSection[];
  signatories: { id: string; name: string; description: string; image: string }[];
  /** the date and person of the latest approval among the printed tests */
  approvedAt: string | null;
}

/**
 * Everything a report prints: only APPROVED (or handed-over) tests, grouped by
 * section in report order, with the signature blocks the approver chose.
 * `onlyResultIds` prints a chosen subset.
 */
export async function getReportData(orderId: string, onlyResultIds?: string[]): Promise<ReportData | null> {
  const order = await getOrder(orderId);
  if (!order) return null;
  const [company, settings, signatories] = await Promise.all([getCompany(), getLabSettings(), listSignatories()]);

  const wanted = onlyResultIds && onlyResultIds.length > 0 ? new Set(onlyResultIds) : null;
  const printable = order.results.filter(
    (r) => (r.status === "approved" || r.status === "dispatched") && (!wanted || wanted.has(r.id)),
  );
  const sections: ReportSection[] = [];
  for (const r of [...printable].sort((a, b) => a.departmentOrder - b.departmentOrder)) {
    const name = r.departmentName || "Other tests";
    let s = sections.find((x) => x.departmentName === name);
    if (!s) {
      s = { departmentName: name, showUnit: r.showUnit, showRange: r.showRange, results: [] };
      sections.push(s);
    }
    s.results.push(r);
  }
  const byId = new Map(signatories.map((s) => [s.id, s]));
  const chosen = order.signatoryIds
    .map((id) => byId.get(id))
    .filter((s): s is Signatory => Boolean(s))
    .map(({ id, name, description, image }) => ({ id, name, description, image }));

  const approvedAt =
    printable
      .map((r) => r.approvedAt)
      .filter((x): x is string => Boolean(x))
      .sort()
      .at(-1) ?? null;

  return {
    order,
    company: { name: company.name, address: company.address, phone: company.phone, panNo: company.panNo },
    headerImage: settings.headerImage || company.logoUrl || "",
    footerImage: settings.footerImage,
    margins: { topMm: settings.marginTopMm, bottomMm: settings.marginBottomMm, xMm: settings.marginXMm },
    sections,
    signatories: chosen,
    approvedAt,
  };
}
