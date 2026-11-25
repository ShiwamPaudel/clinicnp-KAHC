"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, NotAuthorizedError } from "@/lib/session";
import { requireAnyModule, ModuleDisabledError } from "@/lib/modules";
import { adToIso, toAD, bsFromDbText, bsToDbText, today } from "@/lib/bs";
import { recordAudit } from "@/lib/repos/audit";
import { createPatient, getPatient, type Patient } from "@/lib/repos/patients";
import { isSaneAge } from "@/lib/age";
import type { DraftPatient } from "@/components/clinic/patient-picker";
import { ClosedFiscalYearError } from "@/lib/repos/fiscal";
import {
  FOLLOWUP_REASON,
  PrebookingProblem,
  bookingForAppointment,
  checkTestBooking,
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
  /** a registered patient's id, or "new" with the details alongside */
  patientId: z.string().min(1, "Find the patient, or register them"),
  dateBs: DATE,
  timeHhmm: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose the time they will come"),
  note: z.string().trim().max(300),
  // at least one, except on a follow-up booking (the repo checks which)
  serviceIds: z.array(z.string()).max(60),
});

/**
 * Every booking is for a registered patient, so "Issue bill" opens the counter
 * with them already on it. The front desk searches first; someone who has
 * never been here is registered from the booking dialog itself.
 */
export async function saveTestBookingAction(input: unknown, newPatient?: DraftPatient): Promise<PrebookingActionResult> {
  try {
    const user = await guard();
    const parsed = bookingSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const d = parsed.data;

    let patient: Patient;
    if (d.patientId === "new") {
      if (!newPatient || newPatient.name.trim().length < 2) return fail("Enter the patient's name.");
      if (newPatient.ageValue != null && newPatient.ageUnit != null && !isSaneAge(newPatient.ageValue, newPatient.ageUnit)) {
        return fail("Check the age.");
      }
      // the booking must be sure to save before anyone is registered for it
      await checkTestBooking(d);
      const todayAd = adToIso(new Date());
      patient = await createPatient({
        name: newPatient.name.trim(),
        sex: newPatient.sex,
        ageValue: newPatient.ageValue,
        ageUnit: newPatient.ageUnit,
        ageAsOfAd: newPatient.ageValue != null ? todayAd : null,
        dobAd: null,
        phone: newPatient.phone.trim(),
        address: newPatient.address.trim(),
        userId: user.id,
      });
    } else {
      const found = await getPatient(d.patientId);
      if (!found) return fail("That patient record is no longer there. Search again.");
      patient = found;
    }

    const data = {
      name: patient.name,
      phone: patient.phone,
      patientId: patient.id,
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
      await recordAudit(user.id, "prebooking.updated", { entity: "prebooking", entityId: id, detail: patient.name });
    } else {
      id = await createTestBooking(data);
      await recordAudit(user.id, "prebooking.created", { entity: "prebooking", entityId: id, detail: patient.name });
    }
    revalidatePath("/prebooking");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

const followupSchema = z.object({
  patientId: z.string().min(1, "Choose the patient"),
  dateBs: DATE,
  timeHhmm: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose the time they will come"),
  /** a doctor books that doctor's consultation; none books a follow-up with no tests yet */
  doctorId: z.string().nullable(),
  note: z.string().trim().max(250),
});

/**
 * Next follow-up, from the patient's page (owner, 2083-08-09). With a doctor it
 * is that doctor's consultation, reason "Follow-up", under Doctors'
 * consultations; without one it is a booking with no tests yet, marked
 * Follow-up, under Tests and services booked. Both show on Pre-Booking.
 */
export async function bookFollowupAction(input: unknown): Promise<PrebookingActionResult> {
  try {
    const parsed = followupSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const d = parsed.data;
    const dateAd = toIso(d.dateBs);
    if (dateAd < toIso(bsToDbText(today()))) return fail("Choose today or a later day.");

    if (d.doctorId) {
      const { bookConsultationAction } = await import("@/app/(app)/doctors/actions");
      const res = await bookConsultationAction({
        doctorId: d.doctorId,
        patientId: d.patientId,
        dateBs: d.dateBs,
        timeHhmm: d.timeHhmm,
        durationMin: 15,
        reason: d.note ? `${FOLLOWUP_REASON}: ${d.note}` : FOLLOWUP_REASON,
      });
      if (res.ok) revalidatePath(`/patients/${d.patientId}`);
      return { ok: res.ok, userMessage: res.userMessage, id: res.id };
    }

    const user = await guard();
    const patient = await getPatient(d.patientId);
    if (!patient) return fail("That patient record is no longer there.");
    const id = await createTestBooking({
      name: patient.name,
      phone: patient.phone,
      patientId: patient.id,
      dateAd,
      dateBs: d.dateBs,
      timeHhmm: d.timeHhmm,
      note: d.note,
      serviceIds: [],
      userId: user.id,
      isFollowup: true,
    });
    await recordAudit(user.id, "prebooking.created", { entity: "prebooking", entityId: id, detail: `${patient.name} · follow-up` });
    revalidatePath("/prebooking");
    revalidatePath(`/patients/${patient.id}`);
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
