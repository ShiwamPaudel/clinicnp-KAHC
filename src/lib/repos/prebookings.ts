/**
 * prebookings.ts — tests and consultations booked ahead, and the advances
 * paid on them (0031, prod-docs/Prebooking.md).
 *
 * A booking is not a bill. It becomes one when the person arrives and the
 * counter issues it; until then it can be moved, cancelled or missed. An
 * advance is money owed back to the patient until a bill uses it: held in
 * Advances from patients, refunded when the booking is cancelled or missed,
 * and handed back as change when it is more than the bill.
 *
 * Nothing here is deleted. A cancelled booking keeps its advance rows; an
 * advance a bill used is a dues payment on that bill.
 */
import "server-only";
import { ulid } from "ulid";
import type { Transaction } from "@libsql/client";
import { db } from "@/lib/db";
import type { Row, InStatement } from "@/lib/db";
import { ClosedFiscalYearError } from "@/lib/repos/fiscal";
import {
  advanceAgainst,
  advanceReceiptLabel,
  type PrebookingKind,
  type PrebookingStatus,
} from "@/lib/prebooking-format";

export class PrebookingProblem extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "PrebookingProblem";
    this.userMessage = userMessage;
  }
}

export interface PrebookingItem {
  serviceId: string;
  name: string;
}

export interface AdvanceMove {
  id: string;
  kind: "received" | "refunded" | "used";
  /** AR-000001 for money received; empty otherwise */
  receiptLabel: string;
  amountPaisa: number;
  method: string;
  dateBs: string;
  dateAd: string;
  note: string;
  billId: string | null;
  createdAt: string;
}

export interface Prebooking {
  id: string;
  kind: PrebookingKind;
  appointmentId: string | null;
  patientId: string | null;
  patientNo: number | null;
  name: string;
  phone: string;
  dateAd: string;
  dateBs: string;
  timeHhmm: string;
  note: string;
  status: PrebookingStatus;
  billId: string | null;
  billNo: number | null;
  cancelReason: string;
  doctorName: string;
  items: PrebookingItem[];
  moves: AdvanceMove[];
  receivedPaisa: number;
  refundedPaisa: number;
  usedPaisa: number;
  /** received − refunded − used: what the clinic is holding for them now */
  inHandPaisa: number;
}

const BASE = `
  SELECT p.*, pt.patient_no, b.invoice_no AS bill_no, d.name AS doctor_name
    FROM prebookings p
    LEFT JOIN patients pt ON pt.id = p.patient_id
    LEFT JOIN bills b ON b.id = p.bill_id
    LEFT JOIN appointments a ON a.id = p.appointment_id
    LEFT JOIN doctors d ON d.id = a.doctor_id`;

async function hydrate(rows: Row[]): Promise<Prebooking[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  const marks = ids.map(() => "?").join(",");
  const [items, moves, used] = await Promise.all([
    db().execute({
      sql: `SELECT prebooking_id, service_id, name FROM prebooking_items WHERE prebooking_id IN (${marks}) ORDER BY sort_order`,
      args: ids,
    }),
    db().execute({
      sql: `SELECT * FROM advance_moves WHERE prebooking_id IN (${marks}) ORDER BY created_at, rowid`,
      args: ids,
    }),
    db().execute({
      sql: `SELECT id, prebooking_id, bill_id, amount_paisa, date_ad, date_bs, created_at
              FROM due_payments WHERE prebooking_id IN (${marks}) AND voided_at IS NULL ORDER BY created_at`,
      args: ids,
    }),
  ]);
  const itemsBy = new Map<string, PrebookingItem[]>();
  for (const i of items.rows) {
    const list = itemsBy.get(i.prebooking_id as string) ?? [];
    list.push({ serviceId: i.service_id as string, name: i.name as string });
    itemsBy.set(i.prebooking_id as string, list);
  }
  const movesBy = new Map<string, AdvanceMove[]>();
  const push = (id: string, m: AdvanceMove) => {
    const list = movesBy.get(id) ?? [];
    list.push(m);
    movesBy.set(id, list);
  };
  for (const m of moves.rows) {
    push(m.prebooking_id as string, {
      id: m.id as string,
      kind: (m.kind as string) === "refunded" ? "refunded" : "received",
      receiptLabel: (m.kind as string) === "received" ? advanceReceiptLabel(m.receipt_no as number | null) : "",
      amountPaisa: Number(m.amount_paisa),
      method: m.method as string,
      dateBs: m.date_bs as string,
      dateAd: m.date_ad as string,
      note: (m.note as string) ?? "",
      billId: (m.bill_id as string | null) ?? null,
      createdAt: m.created_at as string,
    });
  }
  for (const u of used.rows) {
    push(u.prebooking_id as string, {
      id: u.id as string,
      kind: "used",
      receiptLabel: "",
      amountPaisa: Number(u.amount_paisa),
      method: "advance",
      dateBs: u.date_bs as string,
      dateAd: u.date_ad as string,
      note: "",
      billId: u.bill_id as string,
      createdAt: u.created_at as string,
    });
  }
  return rows.map((r) => {
    const id = r.id as string;
    // the same moment (a bill using the advance and handing back the rest): used first
    const rank = { received: 0, used: 1, refunded: 2 } as const;
    const mv = (movesBy.get(id) ?? []).sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : rank[a.kind] - rank[b.kind],
    );
    const sum = (k: AdvanceMove["kind"]) => mv.filter((m) => m.kind === k).reduce((s, m) => s + m.amountPaisa, 0);
    const received = sum("received");
    const refunded = sum("refunded");
    const usedP = sum("used");
    return {
      id,
      kind: (r.kind as string) === "consultation" ? "consultation" : "tests",
      appointmentId: (r.appointment_id as string | null) ?? null,
      patientId: (r.patient_id as string | null) ?? null,
      patientNo: r.patient_no != null ? Number(r.patient_no) : null,
      name: r.name as string,
      phone: (r.phone as string) ?? "",
      dateAd: r.date_ad as string,
      dateBs: r.date_bs as string,
      timeHhmm: r.time_hhmm as string,
      note: (r.note as string) ?? "",
      status: r.status as PrebookingStatus,
      billId: (r.bill_id as string | null) ?? null,
      billNo: r.bill_no != null ? Number(r.bill_no) : null,
      cancelReason: (r.cancel_reason as string) ?? "",
      doctorName: (r.doctor_name as string | null) ?? "",
      items: itemsBy.get(id) ?? [],
      moves: mv,
      receivedPaisa: received,
      refundedPaisa: refunded,
      usedPaisa: usedP,
      inHandPaisa: received - refunded - usedP,
    };
  });
}

/** Every booking on a day, tests and consultations, in time order. */
export async function listPrebookingsOn(dateAd: string): Promise<Prebooking[]> {
  const res = await db().execute({
    sql: `${BASE} WHERE p.date_ad = ? ORDER BY p.time_hhmm, p.created_at`,
    args: [dateAd],
  });
  return hydrate(res.rows);
}

export async function getPrebooking(id: string): Promise<Prebooking | null> {
  const res = await db().execute({ sql: `${BASE} WHERE p.id = ?`, args: [id] });
  return (await hydrate(res.rows))[0] ?? null;
}

/** The booking a doctor's appointment has, when an advance or bill made one. */
export async function prebookingsForAppointments(appointmentIds: string[]): Promise<Map<string, Prebooking>> {
  if (appointmentIds.length === 0) return new Map();
  const res = await db().execute({
    sql: `${BASE} WHERE p.appointment_id IN (${appointmentIds.map(() => "?").join(",")})`,
    args: appointmentIds,
  });
  return new Map((await hydrate(res.rows)).map((p) => [p.appointmentId as string, p]));
}

/** A booking's advance in hand, read inside a transaction. */
export async function advanceInHandTx(tx: Transaction, prebookingId: string): Promise<number> {
  const r = await tx.execute({
    sql: `SELECT
            COALESCE((SELECT SUM(amount_paisa) FROM advance_moves WHERE prebooking_id = ? AND kind = 'received'), 0)
          - COALESCE((SELECT SUM(amount_paisa) FROM advance_moves WHERE prebooking_id = ? AND kind = 'refunded'), 0)
          - COALESCE((SELECT SUM(amount_paisa) FROM due_payments WHERE prebooking_id = ? AND voided_at IS NULL), 0) AS n`,
    args: [prebookingId, prebookingId, prebookingId],
  });
  return Number(r.rows[0]?.n ?? 0);
}

/** The open year a date falls in, or a ClosedFiscalYearError. */
async function assertDateOpen(dateAd: string): Promise<void> {
  const res = await db().execute({
    sql: "SELECT status FROM fiscal_years WHERE ? BETWEEN start_ad AND end_ad",
    args: [dateAd],
  });
  const status = res.rows[0]?.status as string | undefined;
  if (status && status !== "open") throw new ClosedFiscalYearError();
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface TestBookingInput {
  name: string;
  phone: string;
  patientId: string | null;
  dateAd: string;
  dateBs: string;
  timeHhmm: string;
  note: string;
  serviceIds: string[];
  userId: string;
}

async function itemStatements(prebookingId: string, serviceIds: string[]): Promise<InStatement[]> {
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) throw new PrebookingProblem("Choose at least one test or service.");
  const res = await db().execute({
    sql: `SELECT id, name FROM services WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  const names = new Map(res.rows.map((r) => [r.id as string, r.name as string]));
  if (names.size !== ids.length) throw new PrebookingProblem("One of those tests or services is no longer billed. Choose again.");
  return [
    { sql: "DELETE FROM prebooking_items WHERE prebooking_id = ?", args: [prebookingId] },
    ...ids.map((sid, i) => ({
      sql: "INSERT INTO prebooking_items (id, prebooking_id, service_id, name, sort_order) VALUES (?, ?, ?, ?, ?)",
      args: [ulid(), prebookingId, sid, names.get(sid)!, i],
    })),
  ];
}

function checkBooking(input: TestBookingInput) {
  if (input.name.trim().length < 2) throw new PrebookingProblem("Enter the patient's name.");
  if (!HHMM.test(input.timeHhmm)) throw new PrebookingProblem("Choose the time they will come.");
}

export async function createTestBooking(input: TestBookingInput): Promise<string> {
  checkBooking(input);
  const id = ulid();
  const now = new Date().toISOString();
  await db().batch(
    [
      {
        sql: `INSERT INTO prebookings (id, kind, patient_id, name, phone, date_ad, date_bs, time_hhmm, note, status, booked_by, created_at, updated_at)
              VALUES (?, 'tests', ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?)`,
        args: [id, input.patientId, input.name.trim(), input.phone.trim(), input.dateAd, input.dateBs, input.timeHhmm, input.note.trim(), input.userId, now, now],
      },
      ...(await itemStatements(id, input.serviceIds)),
    ],
    "write",
  );
  return id;
}

export async function updateTestBooking(id: string, input: TestBookingInput): Promise<void> {
  checkBooking(input);
  const current = await getPrebooking(id);
  if (!current) throw new PrebookingProblem("That booking is no longer there.");
  if (current.kind !== "tests") throw new PrebookingProblem("Change a consultation from the doctor's day.");
  if (current.status !== "booked") throw new PrebookingProblem("Only a booking still waiting can be changed.");
  await db().batch(
    [
      {
        sql: `UPDATE prebookings SET patient_id = ?, name = ?, phone = ?, date_ad = ?, date_bs = ?, time_hhmm = ?, note = ?, updated_at = ?
               WHERE id = ? AND status = 'booked'`,
        args: [input.patientId, input.name.trim(), input.phone.trim(), input.dateAd, input.dateBs, input.timeHhmm, input.note.trim(), new Date().toISOString(), id],
      },
      ...(await itemStatements(id, input.serviceIds)),
    ],
    "write",
  );
}

/**
 * The booking for a doctor's appointment, made the first time it is needed
 * (an advance is taken on it, or a bill issued from it).
 */
export async function bookingForAppointment(appointmentId: string, userId: string): Promise<string> {
  const existing = await db().execute({ sql: "SELECT id FROM prebookings WHERE appointment_id = ?", args: [appointmentId] });
  if (existing.rows[0]) return existing.rows[0].id as string;
  const a = await db().execute({
    sql: `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone
            FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?`,
    args: [appointmentId],
  });
  const r = a.rows[0];
  if (!r) throw new PrebookingProblem("That consultation is no longer there.");
  const status = r.status as string;
  if (status === "cancelled" || status === "missed") throw new PrebookingProblem("That consultation was cancelled.");
  const id = ulid();
  const now = new Date().toISOString();
  await db().execute({
    sql: `INSERT OR IGNORE INTO prebookings
            (id, kind, appointment_id, patient_id, name, phone, date_ad, date_bs, time_hhmm, note, status, booked_by, created_at, updated_at)
          VALUES (?, 'consultation', ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?)`,
    args: [id, appointmentId, r.patient_id as string, r.patient_name as string, (r.patient_phone as string) ?? "", r.date_ad as string,
      r.date_bs as string, r.time_hhmm as string, (r.reason as string) ?? "", userId, now, now],
  });
  // a racing request may have made it first; either way there is one
  const again = await db().execute({ sql: "SELECT id FROM prebookings WHERE appointment_id = ?", args: [appointmentId] });
  return again.rows[0]!.id as string;
}

/** Money paid on a booking before the bill. Returns the receipt's id and number. */
export async function receiveAdvance(input: {
  prebookingId: string;
  amountPaisa: number;
  method: "cash" | "qr";
  dateAd: string;
  dateBs: string;
  note: string;
  userId: string;
}): Promise<{ id: string; receiptLabel: string }> {
  if (!Number.isInteger(input.amountPaisa) || input.amountPaisa <= 0) throw new PrebookingProblem("Enter how much they paid.");
  if (input.method !== "cash" && input.method !== "qr") throw new PrebookingProblem("Choose Cash or QR.");
  await assertDateOpen(input.dateAd);
  const id = ulid();
  const tx = await db().transaction("write");
  try {
    const p = await tx.execute({ sql: "SELECT status FROM prebookings WHERE id = ?", args: [input.prebookingId] });
    if (!p.rows[0]) throw new PrebookingProblem("That booking is no longer there.");
    if ((p.rows[0].status as string) !== "booked") throw new PrebookingProblem("An advance is taken only on a booking still waiting.");
    const seq = await tx.execute("UPDATE counters SET next_value = next_value + 1 WHERE name = 'advance_receipt_no' RETURNING next_value");
    const no = Number(seq.rows[0]!.next_value) - 1;
    await tx.execute({
      sql: `INSERT INTO advance_moves (id, prebooking_id, kind, receipt_no, amount_paisa, method, note, date_ad, date_bs, user_id, created_at)
            VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, input.prebookingId, no, input.amountPaisa, input.method, input.note.trim(), input.dateAd, input.dateBs, input.userId, new Date().toISOString()],
    });
    await tx.commit();
    return { id, receiptLabel: advanceReceiptLabel(no) };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * Close a booking that will not be billed: cancelled, or they did not come.
 * Whatever advance is still held is refunded the same day, by the method
 * chosen. A consultation's appointment closes with it.
 */
export async function closePrebooking(input: {
  id: string;
  status: "cancelled" | "missed";
  reason: string;
  refundMethod: "cash" | "qr";
  dateAd: string;
  dateBs: string;
  userId: string;
}): Promise<{ refundedPaisa: number }> {
  if (input.status === "cancelled" && input.reason.trim() === "") throw new PrebookingProblem("Say why it is cancelled.");
  const current = await getPrebooking(input.id);
  if (!current) throw new PrebookingProblem("That booking is no longer there.");
  if (current.status !== "booked") throw new PrebookingProblem("Only a booking still waiting can be closed.");
  if (current.inHandPaisa > 0) await assertDateOpen(input.dateAd);
  const now = new Date().toISOString();
  const tx = await db().transaction("write");
  try {
    const inHand = await advanceInHandTx(tx, input.id);
    if (inHand > 0) {
      await tx.execute({
        sql: `INSERT INTO advance_moves (id, prebooking_id, kind, amount_paisa, method, note, date_ad, date_bs, user_id, created_at)
              VALUES (?, ?, 'refunded', ?, ?, ?, ?, ?, ?, ?)`,
        args: [ulid(), input.id, inHand, input.refundMethod, input.status === "missed" ? "Did not come" : "Booking cancelled",
          input.dateAd, input.dateBs, input.userId, now],
      });
    }
    const upd = await tx.execute({
      sql: "UPDATE prebookings SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'booked'",
      args: [input.status, input.reason.trim(), now, input.id],
    });
    if (Number(upd.rowsAffected) === 0) throw new PrebookingProblem("That booking has just changed. Reload and try again.");
    if (current.appointmentId) {
      await tx.execute({
        sql: "UPDATE appointments SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status IN ('booked','arrived')",
        args: [input.status, input.reason.trim(), now, current.appointmentId],
      });
    }
    await tx.commit();
    return { refundedPaisa: inHand };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/** The advance a doctor's appointment still holds, so it is not cancelled from elsewhere unrefunded. */
export async function appointmentAdvanceInHand(appointmentId: string): Promise<number> {
  const res = await db().execute({ sql: "SELECT id FROM prebookings WHERE appointment_id = ?", args: [appointmentId] });
  if (!res.rows[0]) return 0;
  return (await getPrebooking(res.rows[0].id as string))?.inHandPaisa ?? 0;
}

export interface AdvanceReceiptView {
  id: string;
  receiptLabel: string;
  amountPaisa: number;
  method: string;
  dateBs: string;
  createdAt: string;
  note: string;
  takenBy: string;
  booking: Prebooking;
}

/** One advance receipt, for printing. */
export async function getAdvanceReceipt(id: string): Promise<AdvanceReceiptView | null> {
  const res = await db().execute({
    sql: `SELECT am.*, u.name AS user_name FROM advance_moves am LEFT JOIN users u ON u.id = am.user_id
           WHERE am.id = ? AND am.kind = 'received'`,
    args: [id],
  });
  const r = res.rows[0];
  if (!r) return null;
  const booking = await getPrebooking(r.prebooking_id as string);
  if (!booking) return null;
  return {
    id,
    receiptLabel: advanceReceiptLabel(r.receipt_no as number | null),
    amountPaisa: Number(r.amount_paisa),
    method: r.method as string,
    dateBs: r.date_bs as string,
    createdAt: r.created_at as string,
    note: (r.note as string) ?? "",
    takenBy: (r.user_name as string | null) ?? "",
    booking,
  };
}

/** What a bill took from a pre-booking's advance, for its reprint. Null when nothing. */
export async function advanceOnBill(billId: string): Promise<{ usedPaisa: number; labels: string; handBackPaisa: number } | null> {
  const [used, back] = await Promise.all([
    db().execute({
      sql: `SELECT dp.prebooking_id, SUM(dp.amount_paisa) AS s FROM due_payments dp
             WHERE dp.bill_id = ? AND dp.method = 'advance' AND dp.voided_at IS NULL GROUP BY dp.prebooking_id`,
      args: [billId],
    }),
    db().execute({ sql: "SELECT IFNULL(SUM(amount_paisa),0) AS s FROM advance_moves WHERE bill_id = ? AND kind = 'refunded'", args: [billId] }),
  ]);
  const row = used.rows[0];
  if (!row) return null;
  const receipts = await db().execute({
    sql: "SELECT receipt_no FROM advance_moves WHERE prebooking_id = ? AND kind = 'received' ORDER BY created_at",
    args: [row.prebooking_id as string],
  });
  return {
    usedPaisa: Number(row.s),
    labels: receipts.rows.map((r) => advanceReceiptLabel(r.receipt_no as number | null)).join(", "),
    handBackPaisa: Number(back.rows[0]!.s),
  };
}

// ---------------------------------------------------------------------------
// at the counter (called inside ingestBill's and cancelBill's transactions)
// ---------------------------------------------------------------------------

export interface BillingTerms {
  /** the booking may be billed: still waiting, and real */
  live: boolean;
  advancePaisa: number;
}

/** What a booking brings to the bill being saved. A booking already billed brings nothing. */
export async function bookingTermsTx(tx: Transaction, prebookingId: string): Promise<BillingTerms> {
  const p = await tx.execute({ sql: "SELECT status FROM prebookings WHERE id = ?", args: [prebookingId] });
  if (!p.rows[0] || (p.rows[0].status as string) !== "booked") return { live: false, advancePaisa: 0 };
  return { live: true, advancePaisa: Math.max(0, await advanceInHandTx(tx, prebookingId)) };
}

/**
 * The bill is saved: the booking is billed, the advance it held clears the
 * part of the bill left on dues for it, and anything over the bill is handed
 * back as change, in cash.
 */
export async function settleBookingOnBillTx(
  tx: Transaction,
  input: {
    prebookingId: string;
    billId: string;
    invoiceLabel: string;
    totalPaisa: number;
    advancePaisa: number;
    patientId: string | null;
    dateAd: string;
    dateBs: string;
    fiscalYearId: number;
    userId: string;
    now: string;
  },
): Promise<{ usedPaisa: number; handBackPaisa: number }> {
  const { usedPaisa, handBackPaisa } = advanceAgainst(input.totalPaisa, input.advancePaisa);
  if (usedPaisa > 0) {
    await tx.execute({
      sql: `INSERT INTO due_payments
              (id, receipt_id, bill_id, amount_paisa, method, note, date_ad, date_bs, fiscal_year_id, user_id, created_at, prebooking_id)
            VALUES (?, ?, ?, ?, 'advance', 'Paid from the advance', ?, ?, ?, ?, ?, ?)`,
      args: [ulid(), ulid(), input.billId, usedPaisa, input.dateAd, input.dateBs, input.fiscalYearId, input.userId, input.now, input.prebookingId],
    });
  }
  if (handBackPaisa > 0) {
    await tx.execute({
      sql: `INSERT INTO advance_moves (id, prebooking_id, kind, amount_paisa, method, bill_id, note, date_ad, date_bs, user_id, created_at)
            VALUES (?, ?, 'refunded', ?, 'cash', ?, ?, ?, ?, ?, ?)`,
      args: [ulid(), input.prebookingId, handBackPaisa, input.billId, `Change from bill ${input.invoiceLabel}`, input.dateAd, input.dateBs, input.userId, input.now],
    });
  }
  await tx.execute({
    sql: `UPDATE prebookings SET status = 'billed', bill_id = ?, patient_id = COALESCE(patient_id, ?), updated_at = ?
           WHERE id = ? AND status = 'booked'`,
    args: [input.billId, input.patientId, input.now, input.prebookingId],
  });
  // a consultation's appointment: they came
  await tx.execute({
    sql: `UPDATE appointments SET status = 'arrived', updated_at = ?
           WHERE id = (SELECT appointment_id FROM prebookings WHERE id = ?) AND status = 'booked'`,
    args: [input.now, input.prebookingId],
  });
  return { usedPaisa, handBackPaisa };
}

/**
 * A bill issued from a booking is cancelled: the advance it used goes back on
 * the booking (its dues payment undone the same day), and the booking is
 * waiting again, to be billed again or closed with a refund.
 */
export async function releaseBookingOnBillCancelTx(tx: Transaction, billId: string, userId: string, now: string): Promise<void> {
  await tx.execute({
    sql: "UPDATE due_payments SET voided_at = ?, voided_by = ? WHERE bill_id = ? AND method = 'advance' AND voided_at IS NULL",
    args: [now, userId, billId],
  });
  await tx.execute({
    sql: "UPDATE prebookings SET status = 'booked', bill_id = NULL, updated_at = ? WHERE bill_id = ? AND status = 'billed'",
    args: [now, billId],
  });
}
