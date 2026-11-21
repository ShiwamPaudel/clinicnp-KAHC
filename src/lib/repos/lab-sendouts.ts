/**
 * lab-sendouts.ts — tests sent to another laboratory (0027, prod-docs/Lab.md).
 *
 * After its sample is collected, a test in Result entry is either done here or
 * sent to another laboratory. Sending it out:
 *   - sets its result to 'sent_out', which takes it off Result entry and puts
 *     it on Reports (no approval: the other laboratory's report is the report);
 *   - writes one lab_sendouts row naming the laboratory;
 *   - puts the test on that laboratory's price list if it is not there yet.
 *
 * What the laboratory charges comes from its price list. A test sent before a
 * price was set has no charge yet; setting the price later fills it in, dated
 * that day — so a fiscal year already closed is never rewritten.
 *
 * Undoing a send-out (it was not really sent) brings the test back to Result
 * entry. The row is kept with cancelled_at, and the books reverse its charge
 * on the day of the undo, the way a cancelled bill or voucher is reversed.
 */
import "server-only";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import type { InStatement } from "@/lib/db";
import { adToIso, bsToDbText, toAD, today } from "@/lib/bs";
import { LabProblem, refreshOrderStatus } from "@/lib/repos/lab-orders";

const nowIso = () => new Date().toISOString();

function todayDates(): { ad: string; bs: string } {
  const bs = today();
  return { ad: adToIso(toAD(bs)), bs: bsToDbText(bs) };
}

/** Results that can still be sent: not started, a draft, or sent back. */
const SENDABLE = ["pending", "draft", "correction_required"];

// ===========================================================================
// the money, as statements and the books read it
// ===========================================================================

/**
 * Every movement a send-out makes on a laboratory's account, one row each:
 * the charge (on the day it became known) and, for an undone send-out that was
 * charged, the reversal (on the day of the undo). Columns:
 *   partner_id, date_ad, date_bs, name, amount (+ owed, − taken off),
 *   billed (what the patient was billed, on the charge row only), id, kind.
 * Partner statements, balances, Payables and the ledger all read this one
 * fragment, so they cannot disagree.
 */
export const SENDOUT_MOVES_SQL = `
  SELECT so.lab_partner_id AS partner_id, so.charged_date_ad AS date_ad, so.charged_date_bs AS date_bs,
         so.test_name AS name, so.cost_paisa AS amount, so.billed_paisa AS billed, so.id, 'charge' AS kind
    FROM lab_sendouts so
   WHERE so.cost_paisa IS NOT NULL
  UNION ALL
  SELECT so.lab_partner_id, so.cancelled_date_ad, so.cancelled_date_bs,
         so.test_name, -so.cost_paisa, -so.billed_paisa, so.id, 'undo'
    FROM lab_sendouts so
   WHERE so.cost_paisa IS NOT NULL AND so.cancelled_at IS NOT NULL`;

// ===========================================================================
// sending, and taking it back
// ===========================================================================

export interface SendOutInput {
  orderId: string;
  resultIds: string[];
  partnerId: string;
  user: { id: string; name: string };
}

/**
 * Send some of an order's tests to another laboratory. Every test named must
 * belong to the order, have its sample collected (or need none) and still be
 * waiting for results; otherwise nothing is sent.
 */
export async function sendOutResults(input: SendOutInput): Promise<{ sent: number; unpriced: number }> {
  const ids = [...new Set(input.resultIds)];
  if (ids.length === 0) throw new LabProblem("Tick at least one test to send.");

  const partner = await db().execute({
    sql: "SELECT id, name, active FROM lab_partners WHERE id = ?",
    args: [input.partnerId],
  });
  const p = partner.rows[0];
  if (!p || Number(p.active) !== 1) throw new LabProblem("Choose the laboratory again.");

  const order = await db().execute({ sql: "SELECT status FROM lab_orders WHERE id = ?", args: [input.orderId] });
  if (!order.rows[0]) throw new LabProblem("That order no longer exists.");
  if (order.rows[0].status === "cancelled") throw new LabProblem("This bill was cancelled.");

  const marks = ids.map(() => "?").join(",");
  const res = await db().execute({
    sql: `SELECT r.id, r.status, r.test_id, r.test_name, r.order_test_id, s.status AS sample_status,
                 ot.group_id, sl.amount_paisa, sl.qty
            FROM lab_results r
            JOIN lab_order_tests ot ON ot.id = r.order_test_id
            LEFT JOIN lab_samples s ON s.id = r.sample_id
            LEFT JOIN bill_service_lines sl ON sl.id = ot.bill_service_line_id
           WHERE r.order_id = ? AND r.id IN (${marks})`,
    args: [input.orderId, ...ids],
  });
  if (res.rows.length !== ids.length) throw new LabProblem("One of those tests is no longer on this order. Reload and try again.");
  for (const r of res.rows) {
    if (!SENDABLE.includes(r.status as string)) {
      throw new LabProblem(`${r.test_name} is no longer waiting for results.`);
    }
    if (r.sample_status != null && r.sample_status !== "collected") {
      throw new LabProblem(`The sample for ${r.test_name} has not been collected yet.`);
    }
  }

  const testIds = [...new Set(res.rows.map((r) => r.test_id as string))];
  const priceRes = await db().execute({
    sql: `SELECT test_id, cost_paisa FROM lab_partner_prices
           WHERE lab_partner_id = ? AND test_id IN (${testIds.map(() => "?").join(",")})`,
    args: [input.partnerId, ...testIds],
  });
  const price = new Map(priceRes.rows.map((r) => [r.test_id as string, r.cost_paisa == null ? null : Number(r.cost_paisa)]));

  const now = nowIso();
  const day = todayDates();
  let unpriced = 0;
  const stmts: InStatement[] = [];
  for (const r of res.rows) {
    const testId = r.test_id as string;
    const cost = price.get(testId) ?? null;
    if (cost == null) unpriced++;
    // billed on its own: the line's own price for one; inside a profile: 0
    const billed = r.group_id == null && r.amount_paisa != null && Number(r.qty) > 0
      ? Math.round(Number(r.amount_paisa) / Number(r.qty))
      : 0;
    stmts.push(
      {
        sql: "UPDATE lab_results SET status = 'sent_out', correction_note = '', updated_at = ? WHERE id = ?",
        args: [now, r.id as string],
      },
      {
        sql: "UPDATE lab_order_tests SET status = 'sent_out', updated_at = ? WHERE id = ?",
        args: [now, r.order_test_id as string],
      },
      {
        sql: `INSERT INTO lab_sendouts
                (id, result_id, order_id, test_id, test_name, lab_partner_id, billed_paisa,
                 sent_date_ad, sent_date_bs, sent_at, sent_by, sent_by_name,
                 cost_paisa, charged_date_ad, charged_date_bs, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          ulid(), r.id as string, input.orderId, testId, r.test_name as string, input.partnerId, billed,
          day.ad, day.bs, now, input.user.id, input.user.name,
          cost, cost == null ? null : day.ad, cost == null ? null : day.bs, now, now,
        ],
      },
      {
        sql: `INSERT INTO lab_partner_prices (lab_partner_id, test_id, cost_paisa, created_at, updated_at)
              VALUES (?, ?, NULL, ?, ?)
              ON CONFLICT (lab_partner_id, test_id) DO NOTHING`,
        args: [input.partnerId, testId, now, now],
      },
    );
  }
  await db().batch(stmts, "write");
  await refreshOrderStatus(input.orderId);
  return { sent: res.rows.length, unpriced };
}

/** It was not really sent: bring the test back to Result entry. */
export async function undoSendOut(
  sendoutId: string,
  reason: string,
  user: { id: string; name: string },
): Promise<{ orderId: string }> {
  const res = await db().execute({
    sql: `SELECT so.id, so.order_id, so.result_id, so.cancelled_at, r.status, r.order_test_id, o.status AS order_status
            FROM lab_sendouts so
            JOIN lab_results r ON r.id = so.result_id
            JOIN lab_orders o ON o.id = so.order_id
           WHERE so.id = ?`,
    args: [sendoutId],
  });
  const so = res.rows[0];
  if (!so || so.cancelled_at) throw new LabProblem("That test is no longer marked as sent.");
  if (so.status !== "sent_out") throw new LabProblem("That test is no longer marked as sent.");
  if (so.order_status === "cancelled") throw new LabProblem("This bill was cancelled.");
  if (!reason.trim()) throw new LabProblem("Say why it is being brought back.");

  const now = nowIso();
  const day = todayDates();
  await db().batch(
    [
      {
        sql: `UPDATE lab_sendouts SET cancelled_at = ?, cancelled_date_ad = ?, cancelled_date_bs = ?,
                 cancelled_by_name = ?, cancel_reason = ?, updated_at = ?
               WHERE id = ? AND cancelled_at IS NULL`,
        args: [now, day.ad, day.bs, user.name, reason.trim(), now, sendoutId],
      },
      {
        sql: "UPDATE lab_results SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'sent_out'",
        args: [now, so.result_id as string],
      },
      {
        sql: "UPDATE lab_order_tests SET status = 'sample_collected', updated_at = ? WHERE id = ?",
        args: [now, so.order_test_id as string],
      },
    ],
    "write",
  );
  await refreshOrderStatus(so.order_id as string);
  return { orderId: so.order_id as string };
}

// ===========================================================================
// reading them
// ===========================================================================

export interface SendoutView {
  id: string;
  resultId: string;
  testName: string;
  partnerId: string;
  partnerName: string;
  sentAt: string;
  sentByName: string;
  costPaisa: number | null;
}

/** The live (not undone) send-outs of one order. */
export async function listOrderSendouts(orderId: string): Promise<SendoutView[]> {
  const res = await db().execute({
    sql: `SELECT so.*, lp.name AS partner_name
            FROM lab_sendouts so JOIN lab_partners lp ON lp.id = so.lab_partner_id
           WHERE so.order_id = ? AND so.cancelled_at IS NULL
           ORDER BY so.sent_at`,
    args: [orderId],
  });
  return res.rows.map((r) => ({
    id: r.id as string,
    resultId: r.result_id as string,
    testName: r.test_name as string,
    partnerId: r.lab_partner_id as string,
    partnerName: r.partner_name as string,
    sentAt: r.sent_at as string,
    sentByName: (r.sent_by_name as string) ?? "",
    costPaisa: r.cost_paisa == null ? null : Number(r.cost_paisa),
  }));
}

/** "Vitamin D → City Lab" for each order, for the Reports list. */
export async function sendoutLabelsFor(orderIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (orderIds.length === 0) return out;
  const res = await db().execute({
    sql: `SELECT so.order_id, so.test_name, lp.name AS partner_name
            FROM lab_sendouts so JOIN lab_partners lp ON lp.id = so.lab_partner_id
           WHERE so.cancelled_at IS NULL AND so.order_id IN (${orderIds.map(() => "?").join(",")})
           ORDER BY so.sent_at`,
    args: orderIds,
  });
  for (const r of res.rows) {
    const list = out.get(r.order_id as string) ?? [];
    list.push(`${r.test_name} → ${r.partner_name}`);
    out.set(r.order_id as string, list);
  }
  return out;
}

// ===========================================================================
// each laboratory's price list
// ===========================================================================

export interface PartnerPriceRow {
  testId: string;
  testName: string;
  shortCode: string;
  departmentName: string;
  costPaisa: number | null;
  timesSent: number;
  /** sent and still waiting for this price */
  unpriced: number;
  lastSentAt: string | null;
}

export async function listPartnerPrices(partnerId: string): Promise<PartnerPriceRow[]> {
  const res = await db().execute({
    sql: `SELECT pp.test_id, pp.cost_paisa, t.name, t.short_code, d.name AS department_name,
                 (SELECT COUNT(*) FROM lab_sendouts so
                   WHERE so.lab_partner_id = pp.lab_partner_id AND so.test_id = pp.test_id
                     AND so.cancelled_at IS NULL) AS times_sent,
                 (SELECT COUNT(*) FROM lab_sendouts so
                   WHERE so.lab_partner_id = pp.lab_partner_id AND so.test_id = pp.test_id
                     AND so.cancelled_at IS NULL AND so.cost_paisa IS NULL) AS unpriced,
                 (SELECT MAX(so.sent_at) FROM lab_sendouts so
                   WHERE so.lab_partner_id = pp.lab_partner_id AND so.test_id = pp.test_id
                     AND so.cancelled_at IS NULL) AS last_sent_at
            FROM lab_partner_prices pp
            JOIN lab_tests t ON t.id = pp.test_id
            LEFT JOIN lab_departments d ON d.id = t.department_id
           WHERE pp.lab_partner_id = ?
           ORDER BY (pp.cost_paisa IS NULL) DESC, t.name`,
    args: [partnerId],
  });
  return res.rows.map((r) => ({
    testId: r.test_id as string,
    testName: r.name as string,
    shortCode: (r.short_code as string) ?? "",
    departmentName: (r.department_name as string | null) ?? "",
    costPaisa: r.cost_paisa == null ? null : Number(r.cost_paisa),
    timesSent: Number(r.times_sent),
    unpriced: Number(r.unpriced),
    lastSentAt: (r.last_sent_at as string | null) ?? null,
  }));
}

/**
 * Set what a laboratory charges for a test. Tests already sent there without a
 * price are charged at it now, dated today. A price that changes later applies
 * to tests sent from then on; what was already charged stays as it was.
 */
export async function setPartnerPrice(partnerId: string, testId: string, costPaisa: number): Promise<{ filled: number }> {
  if (!Number.isInteger(costPaisa) || costPaisa < 0) throw new LabProblem("The price has to be a number.");
  const known = await db().execute({
    sql: `SELECT (SELECT 1 FROM lab_partners WHERE id = ?) AS p, (SELECT 1 FROM lab_tests WHERE id = ?) AS t`,
    args: [partnerId, testId],
  });
  if (!known.rows[0]?.p || !known.rows[0]?.t) throw new LabProblem("That laboratory or test is no longer there.");
  const now = nowIso();
  const day = todayDates();
  const waiting = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM lab_sendouts
           WHERE lab_partner_id = ? AND test_id = ? AND cancelled_at IS NULL AND cost_paisa IS NULL`,
    args: [partnerId, testId],
  });
  await db().batch(
    [
      {
        sql: `INSERT INTO lab_partner_prices (lab_partner_id, test_id, cost_paisa, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (lab_partner_id, test_id) DO UPDATE SET cost_paisa = excluded.cost_paisa, updated_at = excluded.updated_at`,
        args: [partnerId, testId, costPaisa, now, now],
      },
      {
        sql: `UPDATE lab_sendouts SET cost_paisa = ?, charged_date_ad = ?, charged_date_bs = ?, updated_at = ?
               WHERE lab_partner_id = ? AND test_id = ? AND cancelled_at IS NULL AND cost_paisa IS NULL`,
        args: [costPaisa, day.ad, day.bs, now, partnerId, testId],
      },
    ],
    "write",
  );
  return { filled: Number(waiting.rows[0]!.n) };
}

/** Per laboratory: tests sent and still waiting for a price. */
export async function unpricedByPartner(): Promise<Map<string, number>> {
  const res = await db().execute(
    `SELECT lab_partner_id, COUNT(*) AS n FROM lab_sendouts
      WHERE cancelled_at IS NULL AND cost_paisa IS NULL GROUP BY lab_partner_id`,
  );
  return new Map(res.rows.map((r) => [r.lab_partner_id as string, Number(r.n)]));
}
