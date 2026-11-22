"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, NotAuthorizedError } from "@/lib/session";
import { requireAnyModule, ModuleDisabledError } from "@/lib/modules";
import { db } from "@/lib/db";
import { adToIso, toAD, bsFromDbText, bsToDbText, today } from "@/lib/bs";
import { recordAudit } from "@/lib/repos/audit";
import { ClosedFiscalYearError } from "@/lib/repos/fiscal";
import {
  PrebookingProblem,
  bookingForAppointment,
  closePrebooking,
  createTestBooking,
  receiveAdvance,
  updateTestBooking,
} from "@/lib/repos/prebookings";

export interface PrebookingActionResult {
  ok: boolean;
  userMessage?: string;
  id?: string;
  receiptId?: string;
  receiptLabel?: string;
  refundedPaisa?: number;
}

function fail(userMessage: string): PrebookingActionResult {
  return { ok: false, userMessage };
}

function handle(err: unknown): PrebookingActionResult {
  if (err instanceof PrebookingProblem) return fail(err.userMessage);
  if (err instanceof ClosedFiscalYearError) return fail(err.userMessage);
  if (err instanceof NotAuthorizedError) return fail(err.userMessage);
  if (err instanceof ModuleDisabledError) return fail(err.userMessage);
  console.error("[prebooking action]", err);
  return fail("Something went wrong. Please try again.");
}

async function guard() {
  await requireAnyModule(["clinic", "lab"]);
  return assertPermission("appointments.manage");
}

const toIso = (bs: string) => adToIso(toAD(bsFromDbText(bs)));
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const bookingSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter the patient's name").max(120),
  phone: z.string().trim().max(30),
  dateBs: DATE,
  timeHhmm: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose the time they will come"),
  note: z.string().trim().max(300),
  serviceIds: z.array(z.string()).min(1, "Choose at least one test or service").max(60),
});

/**
 * A registered patient with this phone and name, if there is exactly one —
 * so a returning patient's booking is already theirs at the counter.
 */
async function matchPatient(name: string, phone: string): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  const res = await db().execute({
    sql: "SELECT id FROM patients WHERE phone = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 2",
    args: [phone.trim(), name],
  });
  return res.rows.length === 1 ? (res.rows[0]!.id as string) : null;
}

export async function saveTestBookingAction(input: unknown): Promise<PrebookingActionResult> {
  try {
    const user = await guard();
    const parsed = bookingSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const d = parsed.data;
    const data = {
      name: d.name,
      phone: d.phone,
      patientId: await matchPatient(d.name, d.phone),
      dateAd: toIso(d.dateBs),
      dateBs: d.dateBs,
      timeHhmm: d.timeHhmm,
      note: d.note,
      serviceIds: d.serviceIds,
      userId: user.id,
    };
    let id = d.id;
    if (id) {
      await updateTestBooking(id, data);
      await recordAudit(user.id, "prebooking.updated", { entity: "prebooking", entityId: id, detail: d.name });
    } else {
      id = await createTestBooking(data);
      await recordAudit(user.id, "prebooking.created", { entity: "prebooking", entityId: id, detail: d.name });
    }
    revalidatePath("/prebooking");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

const advanceSchema = z
  .object({
    prebookingId: z.string().optional(),
    appointmentId: z.string().optional(),
    amountPaisa: z.number().int().min(1, "Enter how much they paid").max(100_000_000),
    method: z.enum(["cash", "qr"]),
    note: z.string().trim().max(200),
  })
  .refine((v) => Boolean(v.prebookingId || v.appointmentId), "Choose the booking again.");

export async function takeAdvanceAction(input: unknown): Promise<PrebookingActionResult> {
  try {
    const user = await guard();
    const parsed = advanceSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const d = parsed.data;
    const prebookingId = d.prebookingId ?? (await bookingForAppointment(d.appointmentId!, user.id));
    const dateBs = bsToDbText(today());
    const res = await receiveAdvance({
      prebookingId,
      amountPaisa: d.amountPaisa,
      method: d.method,
      dateAd: toIso(dateBs),
      dateBs,
      note: d.note,
      userId: user.id,
    });
    await recordAudit(user.id, "prebooking.advance", {
      entity: "prebooking",
      entityId: prebookingId,
      detail: `${res.receiptLabel}: ${d.amountPaisa} paisa by ${d.method}`,
    });
    revalidatePath("/prebooking");
    revalidatePath("/accounts", "layout");
    return { ok: true, id: prebookingId, receiptId: res.id, receiptLabel: res.receiptLabel };
  } catch (err) {
    return handle(err);
  }
}

const closeSchema = z
  .object({
    prebookingId: z.string().optional(),
    appointmentId: z.string().optional(),
    status: z.enum(["cancelled", "missed"]),
    reason: z.string().trim().max(200),
    refundMethod: z.enum(["cash", "qr"]),
  })
  .refine((v) => Boolean(v.prebookingId || v.appointmentId), "Choose the booking again.");

export async function closeBookingAction(input: unknown): Promise<PrebookingActionResult> {
  try {
    const user = await guard();
    const parsed = closeSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const d = parsed.data;
    const id = d.prebookingId ?? (await bookingForAppointment(d.appointmentId!, user.id));
    const dateBs = bsToDbText(today());
    const res = await closePrebooking({
      id,
      status: d.status,
      reason: d.reason,
      refundMethod: d.refundMethod,
      dateAd: toIso(dateBs),
      dateBs,
      userId: user.id,
    });
    await recordAudit(user.id, `prebooking.${d.status}`, {
      entity: "prebooking",
      entityId: id,
      detail: res.refundedPaisa > 0 ? `refunded ${res.refundedPaisa} paisa by ${d.refundMethod}` : d.reason,
    });
    revalidatePath("/prebooking");
    revalidatePath("/accounts", "layout");
    return { ok: true, id, refundedPaisa: res.refundedPaisa };
  } catch (err) {
    return handle(err);
  }
}

/** A doctor's appointment, ready for the counter: its booking, made if needed. */
export async function consultationBookingAction(input: unknown): Promise<PrebookingActionResult> {
  try {
    const user = await guard();
    const parsed = z.object({ appointmentId: z.string().min(1) }).safeParse(input);
    if (!parsed.success) return fail("Choose the consultation again.");
    const id = await bookingForAppointment(parsed.data.appointmentId, user.id);
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}
