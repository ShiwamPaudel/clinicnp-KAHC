/**
 * lab-orders.ts — all SQL for a lab test's journey from the bill to the signed
 * report (0024, prod-docs/Lab.md).
 *
 *   bill saved  -> openLabOrderForBill (inside ingestBill's transaction)
 *   samples     -> collectSample / rejectSample / resetSample
 *   results     -> saveResults (draft | submit)
 *   approval    -> approveOrder / sendBackResults / reopenResults
 *   sent out    -> lab-sendouts.ts (from Result entry, straight to Reports)
 *   delivery    -> Reports (print), and the patient's QR link (resolvePublicReport)
 *
 * Every change re-derives the order's status from its samples and results
 * (refreshOrderStatus), so no screen can leave it saying something untrue.
 */
import "server-only";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import type { Row, InStatement } from "@/lib/db";
import type { Transaction } from "@libsql/client";
import { DUE_FACTS_SQL, balanceOfRow } from "@/lib/repos/dues";
import { displayAge } from "@/lib/age";
import { adToIso } from "@/lib/bs";
import { isReportToken, mintReportToken } from "@/lib/lab-token";
import { formatDocNo } from "@/lib/invoice-number";
import {
  computeFlag,
  isAbnormal,
  isCritical,
  numericValue,
  parseOverrides,
  rangeText,
  resolveRange,
  type PatientFacts,
  type ResultFlag,
} from "@/lib/lab-flags";

export class LabProblem extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "LabProblem";
    this.userMessage = userMessage;
  }
}

export const MAX_SIGNATORIES = 3;

const nowIso = () => new Date().toISOString();
const todayAd = () => adToIso(new Date());

// ===========================================================================
// opening an order — called from ingestBill, inside its transaction
// ===========================================================================

export interface OpenOrderContext {
  billId: string;
  patientId: string;
  visitId: string | null;
  dateAd: string;
  dateBs: string;
  userId: string;
  /** the code the counter printed on the bill's QR, if it minted one */
  token: string | null | undefined;
  serviceLines: { lineId: string; serviceId: string }[];
}

interface CatalogTest {
  id: string;
  name: string;
  departmentId: string | null;
  sampleTypeId: string | null;
  sampleTypeName: string;
}

/**
 * Open the lab order for a bill that carries lab tests: one order, one row
 * per test (profiles expanded), one sample per sample type, one pending result
 * per test. Does nothing when the Laboratory module is off or no line is a lab
 * test. Idempotent: a bill that already has an order is left alone.
 *
 * Returns the report token, or null when no order was opened.
 */
export async function openLabOrderForBill(tx: Transaction, ctx: OpenOrderContext): Promise<string | null> {
  if (ctx.serviceLines.length === 0) return null;
  const mod = await tx.execute("SELECT module_lab FROM company WHERE id = 1");
  if (Number(mod.rows[0]?.module_lab ?? 0) !== 1) return null;

  const existing = await tx.execute({ sql: "SELECT report_token FROM lab_orders WHERE bill_id = ?", args: [ctx.billId] });
  if (existing.rows[0]) return existing.rows[0].report_token as string;

  const serviceIds = [...new Set(ctx.serviceLines.map((l) => l.serviceId))];
  const marks = serviceIds.map(() => "?").join(",");
  const [singleRes, groupRes, packageProfileRes] = await Promise.all([
    tx.execute({
      sql: `SELECT t.id, t.service_id, t.name, t.department_id, t.sample_type_id, st.name AS sample_type_name
              FROM lab_tests t LEFT JOIN lab_sample_types st ON st.id = t.sample_type_id
             WHERE t.service_id IN (${marks}) AND t.result_type <> 'none'`,
      args: serviceIds,
    }),
    tx.execute({
      sql: `SELECT g.id AS group_id, g.service_id, g.name AS group_name, g.kind,
                   t.id, t.name, t.department_id, t.sample_type_id, st.name AS sample_type_name
              FROM lab_test_groups g
              JOIN lab_test_group_items i ON i.group_id = g.id
              JOIN lab_tests t ON t.id = i.test_id
              LEFT JOIN lab_sample_types st ON st.id = t.sample_type_id
             WHERE g.service_id IN (${marks}) AND t.result_type <> 'none'
             ORDER BY i.sort_order`,
      args: serviceIds,
    }),
    // a package's profiles, each expanded into its tests (0029)
    tx.execute({
      sql: `SELECT pkg.service_id, pg.id AS group_id, pg.name AS group_name,
                   t.id, t.name, t.department_id, t.sample_type_id, st.name AS sample_type_name
              FROM lab_test_groups pkg
              JOIN lab_test_group_profiles gp ON gp.group_id = pkg.id
              JOIN lab_test_groups pg ON pg.id = gp.profile_id
              JOIN lab_test_group_items i ON i.group_id = pg.id
              JOIN lab_tests t ON t.id = i.test_id
              LEFT JOIN lab_sample_types st ON st.id = t.sample_type_id
             WHERE pkg.kind = 'package' AND pkg.service_id IN (${marks}) AND t.result_type <> 'none'
             ORDER BY gp.sort_order, i.sort_order`,
      args: serviceIds,
    }),
  ]);
  const testOf = (r: Row): CatalogTest => ({
    id: r.id as string,
    name: r.name as string,
    departmentId: (r.department_id as string | null) ?? null,
    sampleTypeId: (r.sample_type_id as string | null) ?? null,
    sampleTypeName: (r.sample_type_name as string | null) ?? "",
  });
  const singleByService = new Map(singleRes.rows.map((r) => [r.service_id as string, testOf(r)]));
  // Each grouped line becomes a list of tests, each with the group it prints
  // under. A profile's tests print under the profile. A package's profiles'
  // tests print under those profiles, and its single tests print on their own;
  // a test in a package twice (in a profile and on its own) is done once.
  type GroupedTest = CatalogTest & { groupId: string; groupName: string };
  const groupByService = new Map<string, GroupedTest[]>();
  const push = (key: string, t: GroupedTest) => {
    const list = groupByService.get(key) ?? [];
    if (!list.some((x) => x.id === t.id)) list.push(t);
    groupByService.set(key, list);
  };
  for (const r of packageProfileRes.rows) {
    push(r.service_id as string, { ...testOf(r), groupId: r.group_id as string, groupName: r.group_name as string });
  }
  for (const r of groupRes.rows) {
    const isPackage = (r.kind as string) === "package";
    push(r.service_id as string, {
      ...testOf(r),
      groupId: r.group_id as string,
      groupName: isPackage ? "" : (r.group_name as string),
    });
  }

  type Planned = CatalogTest & { lineId: string; groupId: string | null; groupName: string };
  const planned: Planned[] = [];
  for (const line of ctx.serviceLines) {
    const single = singleByService.get(line.serviceId);
    if (single) {
      planned.push({ ...single, lineId: line.lineId, groupId: null, groupName: "" });
      continue;
    }
    for (const t of groupByService.get(line.serviceId) ?? []) {
      planned.push({ ...t, lineId: line.lineId });
    }
  }
  if (planned.length === 0) return null;

  // the counter's code if it is well-formed and unused, else a fresh one
  let token = isReportToken(ctx.token) ? ctx.token : mintReportToken();
  for (let tries = 0; ; tries++) {
    const clash = await tx.execute({ sql: "SELECT 1 FROM lab_orders WHERE report_token = ?", args: [token] });
    if (!clash.rows[0]) break;
    if (tries > 5) throw new Error("could not mint a unique report token");
    token = mintReportToken();
  }

  const patient = await tx.execute({ sql: "SELECT referred_by FROM patients WHERE id = ?", args: [ctx.patientId] });
  const referredBy = (patient.rows[0]?.referred_by as string | null) ?? "";

  const nextNo = async (name: string): Promise<number> => {
    const r = await tx.execute({
      sql: "UPDATE counters SET next_value = next_value + 1 WHERE name = ? RETURNING next_value",
      args: [name],
    });
    return Number(r.rows[0]!.next_value) - 1;
  };

  const now = nowIso();
  const orderId = ulid();
  const orderNo = await nextNo("lab_order_no");
  await tx.execute({
    sql: `INSERT INTO lab_orders
            (id, order_no, bill_id, patient_id, visit_id, date_ad, date_bs, referred_by, status,
             report_token, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sample_pending', ?, ?, ?, ?)`,
    args: [orderId, orderNo, ctx.billId, ctx.patientId, ctx.visitId, ctx.dateAd, ctx.dateBs, referredBy, token, ctx.userId, now, now],
  });

  // one sample per sample type
  const sampleByType = new Map<string, string>();
  for (const t of planned) {
    if (!t.sampleTypeId || sampleByType.has(t.sampleTypeId)) continue;
    const sampleId = ulid();
    const code = `S-${String(await nextNo("lab_sample_no")).padStart(6, "0")}`;
    await tx.execute({
      sql: `INSERT INTO lab_samples (id, order_id, code, sample_type_id, sample_type_name, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      args: [sampleId, orderId, code, t.sampleTypeId, t.sampleTypeName, now, now],
    });
    sampleByType.set(t.sampleTypeId, sampleId);
  }

  // a test with no sample type has nothing to collect: it waits for its result straight away
  for (const [i, t] of planned.entries()) {
    const orderTestId = ulid();
    const sampleId = t.sampleTypeId ? sampleByType.get(t.sampleTypeId) ?? null : null;
    await tx.execute({
      sql: `INSERT INTO lab_order_tests
              (id, order_id, bill_service_line_id, test_id, test_name, department_id, sample_type_id,
               group_id, group_name, status, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [orderTestId, orderId, t.lineId, t.id, t.name, t.departmentId, t.sampleTypeId, t.groupId, t.groupName,
        sampleId ? "ordered" : "sample_collected", i, now, now],
    });
    await tx.execute({
      sql: `INSERT INTO lab_results (id, order_id, order_test_id, test_id, test_name, sample_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      args: [ulid(), orderId, orderTestId, t.id, t.name, sampleId, now, now],
    });
  }
  if (sampleByType.size === 0) {
    await tx.execute({ sql: "UPDATE lab_orders SET status = 'result_pending' WHERE id = ?", args: [orderId] });
  }
  return token;
}

/**
 * A test switched to result type "none" (billed only) leaves the lab orders
 * where it is still open: its results not yet approved are cancelled, a
 * sample that now serves nothing is cancelled, and each order's status is
 * worked out again. Approved results stay on their reports. Returns how many
 * results were taken off.
 */
export async function dropOpenResultsOfTest(testId: string): Promise<number> {
  const open = await db().execute({
    sql: `SELECT r.id, r.order_id, r.order_test_id, r.sample_id FROM lab_results r
            JOIN lab_orders o ON o.id = r.order_id
           WHERE r.test_id = ? AND o.status <> 'cancelled'
             AND r.status IN ('pending','draft','submitted','correction_required')`,
    args: [testId],
  });
  if (open.rows.length === 0) return 0;
  const now = nowIso();
  const stmts: InStatement[] = [];
  for (const r of open.rows) {
    stmts.push(
      { sql: "UPDATE lab_results SET status = 'cancelled', updated_at = ? WHERE id = ?", args: [now, r.id as string] },
      { sql: "UPDATE lab_order_tests SET status = 'cancelled', updated_at = ? WHERE id = ?", args: [now, r.order_test_id as string] },
    );
  }
  const sampleIds = [...new Set(open.rows.map((r) => r.sample_id as string | null).filter((x): x is string => Boolean(x)))];
  for (const s of sampleIds) {
    stmts.push({
      sql: `UPDATE lab_samples SET status = 'cancelled', updated_at = ?
             WHERE id = ? AND status <> 'collected'
               AND NOT EXISTS (SELECT 1 FROM lab_results x WHERE x.sample_id = lab_samples.id AND x.status <> 'cancelled')`,
      args: [now, s],
    });
  }
  await db().batch(stmts, "write");
  for (const orderId of new Set(open.rows.map((r) => r.order_id as string))) {
    await refreshOrderStatus(orderId);
    await markReleasedIfFinal(orderId);
  }
  return open.rows.length;
}

/** Cancelling a bill cancels its lab order. Called inside cancelBill's transaction. */
export async function cancelLabOrderForBill(tx: Transaction, billId: string, reason: string): Promise<void> {
  const o = await tx.execute({ sql: "SELECT id FROM lab_orders WHERE bill_id = ?", args: [billId] });
  const orderId = o.rows[0]?.id as string | undefined;
  if (!orderId) return;
  const now = nowIso();
  await tx.execute({
    sql: "UPDATE lab_orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?",
    args: [now, reason, now, orderId],
  });
  // A test already sent to another laboratory stays sent: the sample has gone,
  // and what that laboratory charges is still owed (lab-sendouts.ts).
  await tx.execute({
    sql: "UPDATE lab_order_tests SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status <> 'sent_out'",
    args: [now, orderId],
  });
  await tx.execute({
    sql: "UPDATE lab_results SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status NOT IN ('approved','dispatched','sent_out')",
    args: [now, orderId],
  });
  await tx.execute({
    sql: "UPDATE lab_samples SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status <> 'collected'",
    args: [now, orderId],
  });
}

// ===========================================================================
// status
// ===========================================================================

/**
 * The order's status, worked out from what is true of its samples and results.
 * Called after every change; the stored column is only ever this function's
 * answer.
 */
export function deriveOrderStatus(samples: string[], results: string[]): string {
  const live = results.filter((r) => r !== "cancelled");
  if (live.length === 0) return "cancelled";
  // A test sent to another laboratory is finished as far as this lab goes.
  // ("dispatched" is a hand-over stamp from before 0027; it reads as approved.)
  const reported = (r: string) => r === "approved" || r === "dispatched";
  const done = (r: string) => reported(r) || r === "sent_out";
  if (live.every(done)) return live.some(reported) ? "approved" : "sent_out";
  if (live.every((r) => r === "submitted" || done(r))) return "awaiting_approval";
  const waitingSample = samples.some((s) => s === "waiting" || s === "recollection" || s === "rejected");
  if (waitingSample && live.every((r) => r === "pending")) return "sample_pending";
  return "result_pending";
}

export async function refreshOrderStatus(orderId: string): Promise<void> {
  const [s, r, o] = await Promise.all([
    db().execute({ sql: "SELECT status FROM lab_samples WHERE order_id = ?", args: [orderId] }),
    db().execute({ sql: "SELECT status FROM lab_results WHERE order_id = ?", args: [orderId] }),
    db().execute({ sql: "SELECT status FROM lab_orders WHERE id = ?", args: [orderId] }),
  ]);
  if (o.rows[0]?.status === "cancelled") return;
  const status = deriveOrderStatus(
    s.rows.map((x) => x.status as string),
    r.rows.map((x) => x.status as string),
  );
  await db().execute({
    sql: "UPDATE lab_orders SET status = ?, updated_at = ? WHERE id = ?",
    args: [status, nowIso(), orderId],
  });
}

// ===========================================================================
// queues
// ===========================================================================

export interface OrderSummary {
  id: string;
  orderNo: number;
  dateBs: string;
  createdAt: string;
  status: string;
  priority: string;
  patientId: string;
  patientNo: number | null;
  patientName: string;
  ageSex: string;
  phone: string;
  invoiceLabel: string;
  testNames: string;
  counts: { total: number; pending: number; submitted: number; approved: number; correction: number; sentOut: number };
  balancePaisa: number;
}

const SEX_LABEL: Record<string, string> = { m: "M", f: "F", o: "O" };

function ageSexOf(r: Row): string {
  const age = displayAge(
    {
      value: r.age_value == null ? null : Number(r.age_value),
      unit: (r.age_unit as "y" | "m" | "d" | null) ?? null,
      asOfAd: (r.age_as_of_ad as string | null) ?? null,
      dobAd: (r.dob_ad as string | null) ?? null,
    },
    todayAd(),
  );
  return `${age.short} / ${SEX_LABEL[r.sex as string] ?? ""}`;
}

const ORDER_SELECT = `
  SELECT o.*, p.patient_no, p.name AS patient_name, p.sex, p.age_value, p.age_unit, p.age_as_of_ad,
         p.dob_ad, p.phone, b.invoice_no, f.bs_label,
         b.payment_method, b.status AS bill_status, b.credit_settled_at, ${DUE_FACTS_SQL},
         (SELECT group_concat(label, ', ') FROM (
            SELECT DISTINCT CASE WHEN ot.group_name <> '' THEN ot.group_name ELSE ot.test_name END AS label
              FROM lab_order_tests ot WHERE ot.order_id = o.id AND ot.status <> 'cancelled')) AS test_names,
         (SELECT COUNT(*) FROM lab_results r WHERE r.order_id = o.id AND r.status <> 'cancelled') AS n_total,
         (SELECT COUNT(*) FROM lab_results r WHERE r.order_id = o.id AND r.status IN ('pending','draft')) AS n_pending,
         (SELECT COUNT(*) FROM lab_results r WHERE r.order_id = o.id AND r.status = 'submitted') AS n_submitted,
         (SELECT COUNT(*) FROM lab_results r WHERE r.order_id = o.id AND r.status IN ('approved','dispatched')) AS n_approved,
         (SELECT COUNT(*) FROM lab_results r WHERE r.order_id = o.id AND r.status = 'correction_required') AS n_correction,
         (SELECT COUNT(*) FROM lab_results r WHERE r.order_id = o.id AND r.status = 'sent_out') AS n_sent
    FROM lab_orders o
    JOIN patients p ON p.id = o.patient_id
    JOIN bills b ON b.id = o.bill_id
    LEFT JOIN fiscal_years f ON f.id = b.fiscal_year_id`;

function invoiceLabel(r: Row): string {
  if (r.invoice_no == null) return "";
  return formatDocNo("SI", String(r.bs_label ?? ""), Number(r.invoice_no));
}

function mapSummary(r: Row): OrderSummary {
  return {
    id: r.id as string,
    orderNo: Number(r.order_no),
    dateBs: r.date_bs as string,
    createdAt: r.created_at as string,
    status: r.status as string,
    priority: r.priority as string,
    patientId: r.patient_id as string,
    patientNo: r.patient_no == null ? null : Number(r.patient_no),
    patientName: r.patient_name as string,
    ageSex: ageSexOf(r),
    phone: (r.phone as string) ?? "",
    invoiceLabel: invoiceLabel(r),
    testNames: (r.test_names as string | null) ?? "",
    counts: {
      total: Number(r.n_total),
      pending: Number(r.n_pending),
      submitted: Number(r.n_submitted),
      approved: Number(r.n_approved),
      correction: Number(r.n_correction),
      sentOut: Number(r.n_sent),
    },
    balancePaisa: balanceOfRow({ ...r, status: r.bill_status ?? null }),
  };
}

export type OrderQueue = "results" | "approval" | "reports" | "all";

/**
 * A result waiting to be worked on, whose sample has been collected (or that
 * needs none). Result entry shows only these: a test reaches it after
 * Sample collection, never before (owner, 2083-08-04).
 */
const READY_FOR_RESULTS = `r.status IN ('pending','draft','correction_required')
  AND (r.sample_id IS NULL OR EXISTS (SELECT 1 FROM lab_samples s WHERE s.id = r.sample_id AND s.status = 'collected'))`;

/** Orders for one of the work lists, oldest first except Reports (newest first). */
export async function listOrders(
  queue: OrderQueue,
  opts: { search?: string; fromAd?: string; toAd?: string; limit?: number } = {},
): Promise<OrderSummary[]> {
  const where: string[] = ["o.status <> 'cancelled'"];
  const args: (string | number)[] = [];
  if (queue === "results") {
    where.push(`EXISTS (SELECT 1 FROM lab_results r WHERE r.order_id = o.id AND ${READY_FOR_RESULTS})`);
  } else if (queue === "approval") {
    where.push(`EXISTS (SELECT 1 FROM lab_results r WHERE r.order_id = o.id AND r.status = 'submitted')`);
  } else if (queue === "reports") {
    where.push(`EXISTS (SELECT 1 FROM lab_results r WHERE r.order_id = o.id AND r.status IN ('approved','dispatched','sent_out'))`);
  }
  if (opts.search?.trim()) {
    const term = `%${opts.search.trim()}%`;
    where.push("(p.name LIKE ? OR p.phone LIKE ? OR CAST(p.patient_no AS TEXT) LIKE ? OR CAST(o.order_no AS TEXT) LIKE ? OR printf('%06d', b.invoice_no) LIKE ?)");
    args.push(term, term, term, term, term);
  }
  if (opts.fromAd) {
    where.push("o.date_ad >= ?");
    args.push(opts.fromAd);
  }
  if (opts.toAd) {
    where.push("o.date_ad <= ?");
    args.push(opts.toAd);
  }
  const order = queue === "reports" || queue === "all" ? "o.created_at DESC" : "o.priority = 'urgent' DESC, o.created_at ASC";
  const res = await db().execute({
    sql: `${ORDER_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`,
    args: [...args, opts.limit ?? 200],
  });
  return res.rows.map(mapSummary);
}

/** Counts for the menu badges and the lab's day. */
export async function labQueueCounts(): Promise<{ samples: number; results: number; approval: number }> {
  const res = await db().execute(`
    SELECT
      (SELECT COUNT(*) FROM lab_samples s JOIN lab_orders o ON o.id = s.order_id
        WHERE s.status IN ('waiting','recollection') AND o.status <> 'cancelled') AS samples,
      (SELECT COUNT(DISTINCT r.order_id) FROM lab_results r JOIN lab_orders o ON o.id = r.order_id
        WHERE ${READY_FOR_RESULTS} AND o.status <> 'cancelled') AS results,
      (SELECT COUNT(DISTINCT r.order_id) FROM lab_results r JOIN lab_orders o ON o.id = r.order_id
        WHERE r.status = 'submitted' AND o.status <> 'cancelled') AS approval`);
  const r = res.rows[0]!;
  return { samples: Number(r.samples), results: Number(r.results), approval: Number(r.approval) };
}

// ===========================================================================
// samples
// ===========================================================================

export interface SampleRow {
  id: string;
  code: string;
  status: string;
  sampleTypeName: string;
  rejectionReason: string;
  collectedAt: string | null;
  collectedByName: string;
  createdAt: string;
  orderId: string;
  orderNo: number;
  priority: string;
  patientId: string;
  patientNo: number | null;
  patientName: string;
  ageSex: string;
  testNames: string;
}

/** The collection list: what is waiting, and what was handled recently. */
export async function listSamples(opts: { status?: string; search?: string } = {}): Promise<SampleRow[]> {
  const where = ["o.status <> 'cancelled'", "s.status <> 'cancelled'"];
  const args: string[] = [];
  if (opts.status && opts.status !== "all") {
    where.push("s.status = ?");
    args.push(opts.status);
  } else {
    where.push("(s.status IN ('waiting','recollection','rejected') OR s.collected_at >= ?)");
    args.push(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  }
  if (opts.search?.trim()) {
    const term = `%${opts.search.trim()}%`;
    where.push("(s.code LIKE ? OR p.name LIKE ? OR p.phone LIKE ? OR CAST(p.patient_no AS TEXT) LIKE ? OR CAST(o.order_no AS TEXT) LIKE ?)");
    args.push(term, term, term, term, term);
  }
  const res = await db().execute({
    sql: `SELECT s.*, o.order_no, o.priority, o.patient_id, p.patient_no, p.name AS patient_name, p.sex,
                 p.age_value, p.age_unit, p.age_as_of_ad, p.dob_ad,
                 (SELECT group_concat(label, ', ') FROM (
                    SELECT DISTINCT CASE WHEN ot.group_name <> '' THEN ot.group_name ELSE ot.test_name END AS label
                      FROM lab_order_tests ot
                     WHERE ot.order_id = s.order_id AND ot.sample_type_id = s.sample_type_id
                       AND ot.status <> 'cancelled')) AS test_names
            FROM lab_samples s
            JOIN lab_orders o ON o.id = s.order_id
            JOIN patients p ON p.id = o.patient_id
           WHERE ${where.join(" AND ")}
           ORDER BY s.status IN ('waiting','recollection') DESC, o.priority = 'urgent' DESC, s.created_at ASC
           LIMIT 300`,
    args,
  });
  return res.rows.map((r) => ({
    id: r.id as string,
    code: r.code as string,
    status: r.status as string,
    sampleTypeName: (r.sample_type_name as string) ?? "",
    rejectionReason: (r.rejection_reason as string) ?? "",
    collectedAt: (r.collected_at as string | null) ?? null,
    collectedByName: (r.collected_by_name as string) ?? "",
    createdAt: r.created_at as string,
    orderId: r.order_id as string,
    orderNo: Number(r.order_no),
    priority: r.priority as string,
    patientId: r.patient_id as string,
    patientNo: r.patient_no == null ? null : Number(r.patient_no),
    patientName: r.patient_name as string,
    ageSex: ageSexOf(r),
    testNames: (r.test_names as string | null) ?? "",
  }));
}

async function sampleState(sampleId: string): Promise<{ status: string; orderId: string; sampleTypeId: string | null; code: string }> {
  const res = await db().execute({
    sql: `SELECT s.status, s.order_id, s.sample_type_id, s.code, o.status AS order_status
            FROM lab_samples s JOIN lab_orders o ON o.id = s.order_id WHERE s.id = ?`,
    args: [sampleId],
  });
  const r = res.rows[0];
  if (!r) throw new LabProblem("That sample no longer exists.");
  if (r.order_status === "cancelled") throw new LabProblem("This bill was cancelled, so its samples are no longer needed.");
  return { status: r.status as string, orderId: r.order_id as string, sampleTypeId: (r.sample_type_id as string | null) ?? null, code: r.code as string };
}

function eventStmt(sampleId: string, from: string, to: string, note: string, user: { id: string; name: string }, at: string): InStatement {
  return {
    sql: `INSERT INTO lab_sample_events (id, sample_id, from_status, to_status, note, user_id, user_name, at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [ulid(), sampleId, from, to, note, user.id, user.name, at],
  };
}

export async function collectSample(sampleId: string, user: { id: string; name: string }): Promise<{ code: string }> {
  const s = await sampleState(sampleId);
  if (s.status === "collected") throw new LabProblem("This sample is already collected.");
  const at = nowIso();
  await db().batch(
    [
      {
        sql: `UPDATE lab_samples SET status = 'collected', collected_at = ?, collected_by = ?, collected_by_name = ?,
                 rejection_reason = '', updated_at = ? WHERE id = ?`,
        args: [at, user.id, user.name, at, sampleId],
      },
      eventStmt(sampleId, s.status, "collected", "", user, at),
      {
        sql: `UPDATE lab_order_tests SET status = 'sample_collected', updated_at = ?
               WHERE order_id = ? AND sample_type_id IS ? AND status = 'ordered'`,
        args: [at, s.orderId, s.sampleTypeId],
      },
    ],
    "write",
  );
  await refreshOrderStatus(s.orderId);
  return { code: s.code };
}

export async function rejectSample(
  sampleId: string,
  reason: string,
  recollect: boolean,
  user: { id: string; name: string },
): Promise<void> {
  if (reason.trim().length < 3) throw new LabProblem("Say why, in a few words.");
  const s = await sampleState(sampleId);
  const to = recollect ? "recollection" : "rejected";
  const at = nowIso();
  await db().batch(
    [
      {
        sql: "UPDATE lab_samples SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ?",
        args: [to, reason.trim(), at, sampleId],
      },
      eventStmt(sampleId, s.status, to, reason.trim(), user, at),
    ],
    "write",
  );
  await refreshOrderStatus(s.orderId);
}

export async function resetSample(sampleId: string, user: { id: string; name: string }): Promise<void> {
  const s = await sampleState(sampleId);
  const at = nowIso();
  await db().batch(
    [
      { sql: "UPDATE lab_samples SET status = 'waiting', rejection_reason = '', updated_at = ? WHERE id = ?", args: [at, sampleId] },
      eventStmt(sampleId, s.status, "waiting", "Ready to draw again", user, at),
    ],
    "write",
  );
  await refreshOrderStatus(s.orderId);
}

export interface LabelData {
  code: string;
  sampleTypeName: string;
  patientName: string;
  patientNo: number | null;
  ageSex: string;
  orderNo: number;
  createdAt: string;
  testNames: string;
}

export async function getSampleLabel(sampleId: string): Promise<LabelData | null> {
  const rows = await listSamplesByIds([sampleId]);
  return rows[0] ?? null;
}

export async function listSamplesByIds(ids: string[]): Promise<LabelData[]> {
  if (ids.length === 0) return [];
  const res = await db().execute({
    sql: `SELECT s.code, s.sample_type_name, s.created_at, o.order_no, p.patient_no, p.name AS patient_name, p.sex,
                 p.age_value, p.age_unit, p.age_as_of_ad, p.dob_ad,
                 (SELECT group_concat(label, ', ') FROM (
                    SELECT DISTINCT CASE WHEN ot.group_name <> '' THEN ot.group_name ELSE ot.test_name END AS label
                      FROM lab_order_tests ot
                     WHERE ot.order_id = s.order_id AND ot.sample_type_id = s.sample_type_id AND ot.status <> 'cancelled')) AS test_names
            FROM lab_samples s JOIN lab_orders o ON o.id = s.order_id JOIN patients p ON p.id = o.patient_id
           WHERE s.id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  return res.rows.map((r) => ({
    code: r.code as string,
    sampleTypeName: (r.sample_type_name as string) ?? "",
    patientName: r.patient_name as string,
    patientNo: r.patient_no == null ? null : Number(r.patient_no),
    ageSex: ageSexOf(r),
    orderNo: Number(r.order_no),
    createdAt: r.created_at as string,
    testNames: (r.test_names as string | null) ?? "",
  }));
}

// ===========================================================================
// one order, in full
// ===========================================================================

export interface ResultValueView {
  id: string;
  parameterId: string | null;
  label: string;
  valueText: string;
  unit: string;
  refText: string;
  flag: ResultFlag;
  remarks: string;
}

export interface FieldSpec {
  parameterId: string | null;
  label: string;
  unit: string;
  resultType: "numeric" | "text" | "select" | "pos_neg";
  options: string[];
  refText: string;
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  defaultRemarks: string;
}

export interface OrderResult {
  id: string;
  orderTestId: string;
  testId: string;
  testName: string;
  groupName: string;
  /** the package this test was billed in, "" when it was not part of one */
  packageName: string;
  departmentId: string | null;
  departmentName: string;
  departmentOrder: number;
  showUnit: boolean;
  showRange: boolean;
  method: string;
  description: string;
  status: string;
  sampleStatus: string | null;
  technicianRemarks: string;
  interpretation: string;
  correctionNote: string;
  enteredByName: string;
  submittedAt: string | null;
  approvedByName: string;
  approvedAt: string | null;
  hasAbnormal: boolean;
  hasCritical: boolean;
  version: number;
  /** what the entry form shows, with the range that applies to this patient */
  fields: FieldSpec[];
  values: ResultValueView[];
}

export interface OrderDetail {
  id: string;
  orderNo: number;
  billId: string;
  invoiceLabel: string;
  dateBs: string;
  createdAt: string;
  status: string;
  priority: string;
  referredBy: string;
  reportToken: string;
  signatoryIds: string[];
  releasedAt: string | null;
  /** the first time a result was saved in Result entry (0032): "Sample Received on" */
  receivedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  balancePaisa: number;
  billCancelled: boolean;
  patient: {
    id: string;
    patientNo: number | null;
    name: string;
    sex: "m" | "f" | "o";
    ageShort: string;
    ageYears: number | null;
    phone: string;
    address: string;
  };
  samples: { id: string; code: string; status: string; sampleTypeName: string; collectedAt: string | null; collectedByName: string; rejectionReason: string }[];
  results: OrderResult[];
  history: { at: string; userName: string; action: string; testName: string; reason: string }[];
  dispatches: { at: string; userName: string; channel: string; note: string }[];
}

function parseStrList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const n = (v: unknown): number | null => (v == null ? null : Number(v));

export async function getOrder(orderId: string): Promise<OrderDetail | null> {
  const head = await db().execute({ sql: `${ORDER_SELECT} WHERE o.id = ?`, args: [orderId] });
  const o = head.rows[0];
  if (!o) return null;

  const patientRes = await db().execute({ sql: "SELECT * FROM patients WHERE id = ?", args: [o.patient_id as string] });
  const p = patientRes.rows[0]!;
  const age = displayAge(
    {
      value: p.age_value == null ? null : Number(p.age_value),
      unit: (p.age_unit as "y" | "m" | "d" | null) ?? null,
      asOfAd: (p.age_as_of_ad as string | null) ?? null,
      dobAd: (p.dob_ad as string | null) ?? null,
    },
    todayAd(),
  );
  const ageKnown = p.dob_ad != null || p.age_value != null;
  const facts: PatientFacts = { sex: (p.sex as "m" | "f" | "o") ?? "o", ageYears: ageKnown ? age.years : null };

  const [samplesRes, resultsRes, valuesRes, paramsRes, historyRes, dispatchRes] = await Promise.all([
    db().execute({ sql: "SELECT * FROM lab_samples WHERE order_id = ? ORDER BY code", args: [orderId] }),
    db().execute({
      sql: `SELECT r.*, ot.group_name, ot.sort_order, t.method, t.description, t.result_type, t.unit, t.select_options,
                   (SELECT g.name FROM bill_service_lines bsl
                      JOIN lab_test_groups g ON g.service_id = bsl.service_id AND g.kind = 'package'
                     WHERE bsl.id = ot.bill_service_line_id LIMIT 1) AS package_name,
                   t.ref_text, t.ref_low, t.ref_high, t.critical_low, t.critical_high, t.ref_overrides, t.default_remarks,
                   t.department_id, d.name AS department_name, d.sort_order AS department_order,
                   d.show_unit, d.show_range, s.status AS sample_status
              FROM lab_results r
              JOIN lab_order_tests ot ON ot.id = r.order_test_id
              JOIN lab_tests t ON t.id = r.test_id
              LEFT JOIN lab_departments d ON d.id = t.department_id
              LEFT JOIN lab_samples s ON s.id = r.sample_id
             WHERE r.order_id = ? AND r.status <> 'cancelled'
             ORDER BY d.sort_order, ot.sort_order`,
      args: [orderId],
    }),
    db().execute({
      sql: `SELECT v.* FROM lab_result_values v JOIN lab_results r ON r.id = v.result_id
             WHERE r.order_id = ? ORDER BY v.sort_order`,
      args: [orderId],
    }),
    db().execute({
      sql: `SELECT pm.* FROM lab_test_parameters pm
             WHERE pm.active = 1 AND pm.test_id IN (SELECT test_id FROM lab_results WHERE order_id = ?)
             ORDER BY pm.sort_order`,
      args: [orderId],
    }),
    db().execute({
      sql: `SELECT a.at, a.user_name, a.action, a.reason, r.test_name
              FROM lab_result_approvals a JOIN lab_results r ON r.id = a.result_id
             WHERE r.order_id = ? ORDER BY a.at DESC`,
      args: [orderId],
    }),
    db().execute({ sql: "SELECT * FROM lab_report_dispatches WHERE order_id = ? ORDER BY at DESC", args: [orderId] }),
  ]);

  const valuesByResult = new Map<string, ResultValueView[]>();
  for (const v of valuesRes.rows) {
    const list = valuesByResult.get(v.result_id as string) ?? [];
    list.push({
      id: v.id as string,
      parameterId: (v.parameter_id as string | null) ?? null,
      label: v.label as string,
      valueText: (v.value_text as string) ?? "",
      unit: (v.unit as string) ?? "",
      refText: (v.ref_text as string) ?? "",
      flag: (v.flag as ResultFlag) ?? "normal",
      remarks: (v.remarks as string) ?? "",
    });
    valuesByResult.set(v.result_id as string, list);
  }
  const paramsByTest = new Map<string, Row[]>();
  for (const pm of paramsRes.rows) {
    const list = paramsByTest.get(pm.test_id as string) ?? [];
    list.push(pm);
    paramsByTest.set(pm.test_id as string, list);
  }

  const fieldOf = (src: Row, parameterId: string | null, label: string): FieldSpec => {
    const range = resolveRange(
      {
        refText: (src.ref_text as string) ?? "",
        refLow: n(src.ref_low),
        refHigh: n(src.ref_high),
        criticalLow: n(src.critical_low),
        criticalHigh: n(src.critical_high),
        overrides: parseOverrides(src.ref_overrides),
      },
      facts,
    );
    const type = (src.result_type as string) === "multi" ? "numeric" : ((src.result_type as FieldSpec["resultType"]) ?? "numeric");
    return {
      parameterId,
      label,
      unit: (src.unit as string) ?? "",
      resultType: type,
      options: type === "pos_neg" ? ["Positive", "Negative"] : parseStrList(src.select_options),
      refText: rangeText(range),
      refLow: range.refLow,
      refHigh: range.refHigh,
      criticalLow: range.criticalLow,
      criticalHigh: range.criticalHigh,
      defaultRemarks: (src.default_remarks as string) ?? "",
    };
  };

  const results: OrderResult[] = resultsRes.rows.map((r) => {
    const params = paramsByTest.get(r.test_id as string) ?? [];
    const fields =
      (r.result_type as string) === "multi"
        ? params.map((pm) => fieldOf(pm, pm.id as string, pm.name as string))
        : [fieldOf(r, null, r.test_name as string)];
    return {
      id: r.id as string,
      orderTestId: r.order_test_id as string,
      testId: r.test_id as string,
      testName: r.test_name as string,
      groupName: (r.group_name as string) ?? "",
      packageName: (r.package_name as string | null) ?? "",
      departmentId: (r.department_id as string | null) ?? null,
      departmentName: (r.department_name as string | null) ?? "",
      departmentOrder: r.department_order == null ? 9999 : Number(r.department_order),
      showUnit: r.show_unit == null ? true : Number(r.show_unit) === 1,
      showRange: r.show_range == null ? true : Number(r.show_range) === 1,
      method: (r.method as string) ?? "",
      description: (r.description as string) ?? "",
      status: r.status as string,
      sampleStatus: (r.sample_status as string | null) ?? null,
      technicianRemarks: (r.technician_remarks as string) ?? "",
      interpretation: (r.interpretation as string) ?? "",
      correctionNote: (r.correction_note as string) ?? "",
      enteredByName: (r.entered_by_name as string) ?? "",
      submittedAt: (r.submitted_at as string | null) ?? null,
      approvedByName: (r.approved_by_name as string) ?? "",
      approvedAt: (r.approved_at as string | null) ?? null,
      hasAbnormal: Number(r.has_abnormal) === 1,
      hasCritical: Number(r.has_critical) === 1,
      version: Number(r.version),
      fields,
      values: valuesByResult.get(r.id as string) ?? [],
    };
  });

  return {
    id: o.id as string,
    orderNo: Number(o.order_no),
    billId: o.bill_id as string,
    invoiceLabel: invoiceLabel(o),
    dateBs: o.date_bs as string,
    createdAt: o.created_at as string,
    status: o.status as string,
    priority: o.priority as string,
    referredBy: (o.referred_by as string) ?? "",
    reportToken: o.report_token as string,
    signatoryIds: parseStrList(o.signatory_ids),
    releasedAt: (o.released_at as string | null) ?? null,
    receivedAt: (o.received_at as string | null) ?? null,
    viewCount: Number(o.view_count),
    lastViewedAt: (o.last_viewed_at as string | null) ?? null,
    balancePaisa: balanceOfRow({ ...o, status: o.bill_status ?? null }),
    billCancelled: o.bill_status === "cancelled",
    patient: {
      id: p.id as string,
      patientNo: p.patient_no == null ? null : Number(p.patient_no),
      name: p.name as string,
      sex: (p.sex as "m" | "f" | "o") ?? "o",
      ageShort: age.short,
      ageYears: facts.ageYears,
      phone: (p.phone as string) ?? "",
      address: (p.address as string) ?? "",
    },
    samples: samplesRes.rows.map((s) => ({
      id: s.id as string,
      code: s.code as string,
      status: s.status as string,
      sampleTypeName: (s.sample_type_name as string) ?? "",
      collectedAt: (s.collected_at as string | null) ?? null,
      collectedByName: (s.collected_by_name as string) ?? "",
      rejectionReason: (s.rejection_reason as string) ?? "",
    })),
    results,
    history: historyRes.rows.map((h) => ({
      at: h.at as string,
      userName: (h.user_name as string) ?? "",
      action: h.action as string,
      testName: h.test_name as string,
      reason: (h.reason as string) ?? "",
    })),
    dispatches: dispatchRes.rows.map((d) => ({
      at: d.at as string,
      userName: (d.user_name as string) ?? "",
      channel: d.channel as string,
      note: (d.note as string) ?? "",
    })),
  };
}

export async function setOrderDetails(orderId: string, input: { referredBy: string; priority: "normal" | "urgent" }): Promise<void> {
  await db().execute({
    sql: "UPDATE lab_orders SET referred_by = ?, priority = ?, updated_at = ? WHERE id = ? AND status <> 'cancelled'",
    args: [input.referredBy.trim(), input.priority, nowIso(), orderId],
  });
}

// ===========================================================================
// results
// ===========================================================================

export interface ResultInput {
  resultId: string;
  technicianRemarks: string;
  values: { parameterId: string | null; value: string; remarks: string }[];
}

function snapshotOf(values: InStatement[]): string {
  return JSON.stringify(values.map((v) => (v as { args: unknown[] }).args));
}

/**
 * Save the values typed for an order. `draft` keeps them editable; `submit`
 * sends every test that has a value to approval and keeps the empty ones as
 * drafts, so the quick tests can go ahead of the slow ones.
 * Ranges and flags are worked out here, on the server, against this
 * patient's sex and age — what the screen previewed is never trusted.
 */
export async function saveResults(
  orderId: string,
  entries: ResultInput[],
  mode: "draft" | "submit",
  user: { id: string; name: string },
): Promise<{ submitted: number; drafted: number }> {
  const order = await getOrder(orderId);
  if (!order) throw new LabProblem("That order no longer exists.");
  if (order.status === "cancelled") throw new LabProblem("This bill was cancelled.");
  const byId = new Map(order.results.map((r) => [r.id, r]));
  const at = nowIso();
  let submitted = 0;
  let drafted = 0;
  let typedSomething = false;
  const stmts: InStatement[] = [];

  for (const e of entries) {
    const result = byId.get(e.resultId);
    if (!result) continue;
    if (result.status === "approved" || result.status === "dispatched" || result.status === "sent_out") continue;
    if (result.sampleStatus && result.sampleStatus !== "collected") {
      throw new LabProblem(`The sample for ${result.testName} has not been collected yet.`);
    }

    const valueStmts: InStatement[] = [];
    let anyValue = false;
    let abnormal = false;
    let critical = false;
    result.fields.forEach((field, i) => {
      const typed = e.values.find((v) => v.parameterId === field.parameterId);
      const raw = (typed?.value ?? "").trim();
      const num = field.resultType === "numeric" ? numericValue(raw) : null;
      const flag: ResultFlag = num == null ? "normal" : computeFlag(num, field);
      if (raw !== "") anyValue = true;
      if (isAbnormal(flag)) abnormal = true;
      if (isCritical(flag)) critical = true;
      valueStmts.push({
        sql: `INSERT INTO lab_result_values
                (id, result_id, parameter_id, label, value_text, value_num, unit, ref_text, ref_low, ref_high, flag, remarks, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [ulid(), result.id, field.parameterId, field.label, raw, num, field.unit, field.refText,
          field.refLow, field.refHigh, flag, (typed?.remarks ?? "").trim(), i],
      });
    });

    if (anyValue) typedSomething = true;
    const submitThis = mode === "submit" && anyValue;
    const version = submitThis ? result.version + 1 : result.version;
    stmts.push({ sql: "DELETE FROM lab_result_values WHERE result_id = ?", args: [result.id] }, ...valueStmts, {
      sql: `UPDATE lab_results SET status = ?, has_abnormal = ?, has_critical = ?, technician_remarks = ?,
               entered_by = ?, entered_by_name = ?, submitted_at = ?, correction_note = ?, version = ?, updated_at = ?
             WHERE id = ?`,
      args: [submitThis ? "submitted" : "draft", abnormal ? 1 : 0, critical ? 1 : 0, e.technicianRemarks.trim(),
        user.id, user.name, submitThis ? at : result.submittedAt, submitThis ? "" : result.correctionNote, version, at, result.id],
    }, {
      sql: "UPDATE lab_order_tests SET status = ?, updated_at = ? WHERE id = ?",
      args: [submitThis ? "result_submitted" : "result_draft", at, result.orderTestId],
    });
    if (submitThis) {
      stmts.push({
        sql: `INSERT INTO lab_result_versions (id, result_id, version, snapshot, reason, user_id, user_name, at)
              VALUES (?, ?, ?, ?, 'Sent for approval', ?, ?, ?)`,
        args: [ulid(), result.id, version, snapshotOf(valueStmts), user.id, user.name, at],
      });
      submitted++;
    } else if (mode === "submit") {
      drafted++;
    }
  }
  if (stmts.length === 0) throw new LabProblem("Nothing here can be changed any more.");
  // "Sample Received on" on the report: the first save with a value in it, kept from then on (0032)
  if (typedSomething) {
    stmts.push({ sql: "UPDATE lab_orders SET received_at = COALESCE(received_at, ?) WHERE id = ?", args: [at, orderId] });
  }
  await db().batch(stmts, "write");
  await refreshOrderStatus(orderId);
  return { submitted, drafted };
}

// ===========================================================================
// approval
// ===========================================================================

export async function approveOrder(
  orderId: string,
  input: { signatoryIds: string[]; interpretations: Record<string, string> },
  user: { id: string; name: string },
): Promise<{ approved: number; stillPending: number }> {
  // No choosing at approval (owner, 2083-08-08): the active signatures sign
  // every report, in their set order. A list passed in still wins.
  let wanted = [...new Set(input.signatoryIds.filter(Boolean))];
  if (wanted.length === 0) {
    const active = await db().execute("SELECT id FROM lab_signatories WHERE active = 1 ORDER BY sort_order, name");
    wanted = active.rows.map((r) => r.id as string).slice(0, MAX_SIGNATORIES);
  }
  if (wanted.length === 0) throw new LabProblem("No signatures are set up yet. Add them under Settings → Lab report.");
  if (wanted.length > MAX_SIGNATORIES) throw new LabProblem(`A report carries at most ${MAX_SIGNATORIES} signatures.`);
  const valid = await db().execute({
    sql: `SELECT id FROM lab_signatories WHERE active = 1 AND id IN (${wanted.map(() => "?").join(",")})`,
    args: wanted,
  });
  if (valid.rows.length !== wanted.length) {
    throw new LabProblem("One of the chosen signatures is no longer available. Reload and choose again.");
  }
  const submitted = await db().execute({
    sql: "SELECT id, order_test_id, interpretation FROM lab_results WHERE order_id = ? AND status = 'submitted'",
    args: [orderId],
  });
  if (submitted.rows.length === 0) throw new LabProblem("Nothing on this order is waiting for approval.");

  const at = nowIso();
  const sig = JSON.stringify(wanted);
  const stmts: InStatement[] = [];
  for (const r of submitted.rows) {
    const id = r.id as string;
    const interpretation = (input.interpretations[id] ?? (r.interpretation as string) ?? "").trim();
    stmts.push(
      {
        sql: `UPDATE lab_results SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = ?,
                 interpretation = ?, correction_note = '', updated_at = ? WHERE id = ?`,
        args: [user.id, user.name, at, interpretation, at, id],
      },
      { sql: "UPDATE lab_order_tests SET status = 'approved', updated_at = ? WHERE id = ?", args: [at, r.order_test_id as string] },
      {
        sql: `INSERT INTO lab_result_approvals (id, result_id, action, interpretation, signatory_ids, user_id, user_name, at)
              VALUES (?, ?, 'approved', ?, ?, ?, ?, ?)`,
        args: [ulid(), id, interpretation, sig, user.id, user.name, at],
      },
    );
  }
  // One signature row per report: the latest approver's choice (it is what the
  // patient's link shows too, so the two can never disagree).
  stmts.push({ sql: "UPDATE lab_orders SET signatory_ids = ?, updated_at = ? WHERE id = ?", args: [sig, at, orderId] });
  await db().batch(stmts, "write");
  await refreshOrderStatus(orderId);
  await markReleasedIfFinal(orderId);
  const left = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM lab_results WHERE order_id = ? AND status IN ('pending','draft','submitted','correction_required')",
    args: [orderId],
  });
  return { approved: submitted.rows.length, stillPending: Number(left.rows[0]!.n) };
}

/** Send results back to the bench with a reason. `from` decides which may be sent. */
async function sendBack(
  orderId: string,
  resultIds: string[] | null,
  reason: string,
  from: string[],
  action: "sent_back" | "reopened",
  user: { id: string; name: string },
): Promise<number> {
  if (reason.trim().length < 3) throw new LabProblem("Say why, in a few words.");
  const where = [`order_id = ?`, `status IN (${from.map(() => "?").join(",")})`];
  const args: string[] = [orderId, ...from];
  if (resultIds && resultIds.length > 0) {
    where.push(`id IN (${resultIds.map(() => "?").join(",")})`);
    args.push(...resultIds);
  }
  const target = await db().execute({ sql: `SELECT id, order_test_id FROM lab_results WHERE ${where.join(" AND ")}`, args });
  if (target.rows.length === 0) throw new LabProblem("There is nothing here that can be sent back.");
  const at = nowIso();
  const stmts: InStatement[] = [];
  for (const r of target.rows) {
    stmts.push(
      {
        sql: "UPDATE lab_results SET status = 'correction_required', correction_note = ?, updated_at = ? WHERE id = ?",
        args: [reason.trim(), at, r.id as string],
      },
      { sql: "UPDATE lab_order_tests SET status = 'correction_required', updated_at = ? WHERE id = ?", args: [at, r.order_test_id as string] },
      {
        sql: `INSERT INTO lab_result_approvals (id, result_id, action, reason, user_id, user_name, at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [ulid(), r.id as string, action, reason.trim(), user.id, user.name, at],
      },
    );
  }
  if (action === "reopened") {
    // The report is no longer the final one: clear the release so the patient's
    // link waits again until the corrected results are approved.
    stmts.push({ sql: "UPDATE lab_orders SET released_at = NULL, updated_at = ? WHERE id = ?", args: [at, orderId] });
  }
  await db().batch(stmts, "write");
  await refreshOrderStatus(orderId);
  return target.rows.length;
}

export function sendBackResults(orderId: string, resultIds: string[] | null, reason: string, user: { id: string; name: string }) {
  return sendBack(orderId, resultIds, reason, ["submitted"], "sent_back", user);
}

/** Reopen results already approved (or handed over) — a mistake found afterwards. */
export function reopenResults(orderId: string, resultIds: string[], reason: string, user: { id: string; name: string }) {
  if (resultIds.length === 0) return Promise.reject(new LabProblem("Choose the tests to reopen."));
  return sendBack(orderId, resultIds, reason, ["approved", "dispatched"], "reopened", user);
}

/** Stamp the final release once every test is approved and the bill is paid. */
async function markReleasedIfFinal(orderId: string): Promise<void> {
  const o = await getOrder(orderId);
  if (!o || o.releasedAt) return;
  const reported = (s: string) => s === "approved" || s === "dispatched";
  const allDone =
    o.results.some((r) => reported(r.status)) && o.results.every((r) => reported(r.status) || r.status === "sent_out");
  if (allDone && o.balancePaisa <= 0 && !o.billCancelled) {
    await db().execute({ sql: "UPDATE lab_orders SET released_at = ? WHERE id = ?", args: [nowIso(), orderId] });
  }
}

// ===========================================================================
// the patient's link
// ===========================================================================

export type PublicReportState =
  | { status: "invalid" }
  | { status: "not_ready"; orderId: string }
  | { status: "payment_pending"; orderId: string }
  | { status: "ready"; orderId: string; approved: number; total: number; pendingTests: string[] };

/**
 * What the patient may see behind their QR. Derived every time, never read
 * from a stored flag: at least one approved test, and nothing owed on the bill
 * (owner, 2083-08-03). Tests still running appear on the same link later.
 */
export async function resolvePublicReport(token: string): Promise<PublicReportState> {
  if (!isReportToken(token)) return { status: "invalid" };
  const res = await db().execute({
    sql: `SELECT o.id, o.status, b.payment_method, b.status AS bill_status, b.credit_settled_at, ${DUE_FACTS_SQL}
            FROM lab_orders o JOIN bills b ON b.id = o.bill_id WHERE o.report_token = ?`,
    args: [token],
  });
  const r = res.rows[0];
  if (!r || r.status === "cancelled" || r.bill_status === "cancelled") return { status: "invalid" };
  const orderId = r.id as string;
  // A test sent to another laboratory is reported by that laboratory, on
  // paper; it is neither shown here nor listed as still running.
  const results = await db().execute({
    sql: "SELECT status, test_name FROM lab_results WHERE order_id = ? AND status NOT IN ('cancelled','sent_out')",
    args: [orderId],
  });
  const done = results.rows.filter((x) => x.status === "approved" || x.status === "dispatched");
  if (done.length === 0) return { status: "not_ready", orderId };
  if (balanceOfRow({ ...r, status: r.bill_status ?? null }) > 0) return { status: "payment_pending", orderId };
  return {
    status: "ready",
    orderId,
    approved: done.length,
    total: results.rows.length,
    pendingTests: results.rows.filter((x) => x.status !== "approved" && x.status !== "dispatched").map((x) => x.test_name as string),
  };
}

export async function logReportView(orderId: string, outcome: string, ip: string, userAgent: string): Promise<void> {
  const at = nowIso();
  const stmts: InStatement[] = [
    {
      sql: "INSERT INTO lab_report_views (id, order_id, outcome, ip, user_agent, at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [ulid(), orderId, outcome, ip.slice(0, 64), userAgent.slice(0, 200), at],
    },
  ];
  if (outcome === "shown") {
    stmts.push({
      sql: "UPDATE lab_orders SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?",
      args: [at, orderId],
    });
  }
  try {
    await db().batch(stmts, "write");
  } catch {
    // a lost view count never stops the patient seeing their report
  }
}

/** The order behind a bill, for the invoice's QR on a reprint. */
export async function reportTokenForBill(billId: string): Promise<string | null> {
  const res = await db().execute({
    sql: "SELECT report_token FROM lab_orders WHERE bill_id = ? AND status <> 'cancelled'",
    args: [billId],
  });
  return (res.rows[0]?.report_token as string | undefined) ?? null;
}

/** The order for a bill, for links from the bill screen. */
export async function orderIdForBill(billId: string): Promise<string | null> {
  const res = await db().execute({ sql: "SELECT id FROM lab_orders WHERE bill_id = ?", args: [billId] });
  return (res.rows[0]?.id as string | undefined) ?? null;
}

/**
 * A refunded lab line takes its tests off the lab's lists: once a service line
 * is refunded in full, its tests that are not yet approved are cancelled, and
 * a sample nothing live depends on any more is no longer asked for. Called
 * inside createSaleReturn's transaction. Approved results stay — the work was
 * done, and the report already exists — and so does a test already sent to
 * another laboratory, whose charge is still owed.
 */
export async function cancelLabTestsForRefundedLines(tx: Transaction, lineIds: string[]): Promise<void> {
  if (lineIds.length === 0) return;
  const marks = lineIds.map(() => "?").join(",");
  const full = await tx.execute({
    sql: `SELECT sl.id FROM bill_service_lines sl
           WHERE sl.id IN (${marks})
             AND sl.qty <= IFNULL((SELECT SUM(r.qty) FROM sale_return_service_lines r WHERE r.bill_service_line_id = sl.id), 0)`,
    args: lineIds,
  });
  const refunded = full.rows.map((r) => r.id as string);
  if (refunded.length === 0) return;
  const now = nowIso();
  const rMarks = refunded.map(() => "?").join(",");
  const orders = await tx.execute({
    sql: `SELECT DISTINCT order_id FROM lab_order_tests WHERE bill_service_line_id IN (${rMarks})`,
    args: refunded,
  });
  await tx.execute({
    sql: `UPDATE lab_results SET status = 'cancelled', updated_at = ?
           WHERE status NOT IN ('approved','dispatched','cancelled','sent_out')
             AND order_test_id IN (SELECT id FROM lab_order_tests WHERE bill_service_line_id IN (${rMarks}))`,
    args: [now, ...refunded],
  });
  await tx.execute({
    sql: `UPDATE lab_order_tests SET status = 'cancelled', updated_at = ?
           WHERE bill_service_line_id IN (${rMarks}) AND status NOT IN ('approved','sent_out')`,
    args: [now, ...refunded],
  });
  for (const o of orders.rows) {
    const orderId = o.order_id as string;
    await tx.execute({
      sql: `UPDATE lab_samples SET status = 'cancelled', updated_at = ?
             WHERE order_id = ? AND status <> 'collected'
               AND NOT EXISTS (SELECT 1 FROM lab_results r WHERE r.sample_id = lab_samples.id AND r.status <> 'cancelled')`,
      args: [now, orderId],
    });
    const [s, r] = await Promise.all([
      tx.execute({ sql: "SELECT status FROM lab_samples WHERE order_id = ? AND status <> 'cancelled'", args: [orderId] }),
      tx.execute({ sql: "SELECT status FROM lab_results WHERE order_id = ?", args: [orderId] }),
    ]);
    const status = deriveOrderStatus(s.rows.map((x) => x.status as string), r.rows.map((x) => x.status as string));
    await tx.execute({ sql: "UPDATE lab_orders SET status = ?, updated_at = ? WHERE id = ?", args: [status, now, orderId] });
  }
}
