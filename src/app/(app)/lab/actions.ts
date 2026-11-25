"use server";

/**
 * Laboratory actions (Lab.md). Each one: module, then permission, then the
 * repo. Errors come back as plain sentences; nothing a library said is shown.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, NotAuthorizedError } from "@/lib/session";
import { requireModule, ModuleDisabledError } from "@/lib/modules";
import { recordAudit } from "@/lib/repos/audit";
import {
  collectSample,
  rejectSample,
  resetSample,
  saveResults,
  approveOrder,
  sendBackResults,
  reopenResults,
  setOrderDetails,
  LabProblem,
} from "@/lib/repos/lab-orders";
import {
  saveDepartment,
  saveSampleType,
  saveTest,
  saveProfile,
  LabCatalogProblem,
} from "@/lib/repos/lab-catalog";
import { sendOutResults, undoSendOut, setPartnerPrice } from "@/lib/repos/lab-sendouts";
import type { Permission } from "@/lib/permissions";

export interface LabActionResult {
  ok: boolean;
  userMessage?: string;
  id?: string;
}

function fail(userMessage: string): LabActionResult {
  return { ok: false, userMessage };
}

function handle(err: unknown): LabActionResult {
  if (err instanceof LabProblem || err instanceof LabCatalogProblem) return fail(err.userMessage);
  if (err instanceof NotAuthorizedError) return fail(err.userMessage);
  if (err instanceof ModuleDisabledError) return fail(err.userMessage);
  console.error("[lab action]", err);
  return fail("Something went wrong. Please try again.");
}

async function gate(perm: Permission | Permission[]) {
  await requireModule("lab");
  return assertPermission(perm);
}

function refreshLab(orderId?: string) {
  for (const p of ["/lab/samples", "/lab/results", "/lab/approval", "/lab/reports"]) revalidatePath(p);
  if (orderId) {
    revalidatePath(`/lab/orders/${orderId}`);
    revalidatePath(`/lab/results/${orderId}`);
    revalidatePath(`/lab/approval/${orderId}`);
  }
}

// ---- samples ----

export async function collectSampleAction(sampleId: string): Promise<LabActionResult> {
  try {
    const user = await gate("lab.samples");
    const { code } = await collectSample(sampleId, user);
    refreshLab();
    return { ok: true, userMessage: `Sample ${code} collected` };
  } catch (err) {
    return handle(err);
  }
}

export async function rejectSampleAction(input: { sampleId: string; reason: string; recollect: boolean }): Promise<LabActionResult> {
  try {
    const user = await gate("lab.samples");
    await rejectSample(input.sampleId, input.reason, input.recollect, user);
    refreshLab();
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}

export async function resetSampleAction(sampleId: string): Promise<LabActionResult> {
  try {
    const user = await gate("lab.samples");
    await resetSample(sampleId, user);
    refreshLab();
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}

// ---- results ----

const resultsSchema = z.object({
  orderId: z.string().min(1),
  mode: z.enum(["draft", "submit"]),
  entries: z.array(
    z.object({
      resultId: z.string().min(1),
      technicianRemarks: z.string().max(1000),
      values: z.array(
        z.object({
          parameterId: z.string().nullable(),
          value: z.string().max(500),
          remarks: z.string().max(500),
        }),
      ),
    }),
  ),
});

export async function saveResultsAction(input: unknown): Promise<LabActionResult & { submitted?: number; drafted?: number }> {
  try {
    const user = await gate("lab.results");
    const parsed = resultsSchema.safeParse(input);
    if (!parsed.success) return fail("Please check the values and try again.");
    const out = await saveResults(parsed.data.orderId, parsed.data.entries, parsed.data.mode, user);
    refreshLab(parsed.data.orderId);
    return { ok: true, ...out };
  } catch (err) {
    return handle(err);
  }
}

// ---- approval ----

export async function approveOrderAction(input: {
  orderId: string;
  signatoryIds: string[];
  interpretations: Record<string, string>;
}): Promise<LabActionResult & { stillPending?: number }> {
  try {
    const user = await gate("lab.approve");
    const out = await approveOrder(input.orderId, input, user);
    await recordAudit(user.id, "lab.approved", { orderId: input.orderId, approved: out.approved });
    refreshLab(input.orderId);
    return { ok: true, stillPending: out.stillPending };
  } catch (err) {
    return handle(err);
  }
}

export async function sendBackAction(input: { orderId: string; resultIds: string[]; reason: string }): Promise<LabActionResult> {
  try {
    const user = await gate("lab.approve");
    const n = await sendBackResults(input.orderId, input.resultIds.length ? input.resultIds : null, input.reason, user);
    await recordAudit(user.id, "lab.sent_back", { orderId: input.orderId, count: n, reason: input.reason });
    refreshLab(input.orderId);
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}

export async function reopenAction(input: { orderId: string; resultIds: string[]; reason: string }): Promise<LabActionResult> {
  try {
    const user = await gate("lab.reopen");
    const n = await reopenResults(input.orderId, input.resultIds, input.reason, user);
    await recordAudit(user.id, "lab.reopened", { orderId: input.orderId, count: n, reason: input.reason });
    refreshLab(input.orderId);
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}

// ---- sent to another laboratory ----

const sendOutSchema = z.object({
  orderId: z.string().min(1),
  resultIds: z.array(z.string().min(1)).min(1, "Tick at least one test to send.").max(200),
  partnerId: z.string().min(1, "Choose the laboratory."),
});

export async function sendOutAction(input: unknown): Promise<LabActionResult & { unpriced?: number }> {
  try {
    const user = await gate("lab.results");
    const parsed = sendOutSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
    const { sent, unpriced } = await sendOutResults({ ...parsed.data, user });
    await recordAudit(user.id, "lab.sent_out", {
      orderId: parsed.data.orderId,
      partnerId: parsed.data.partnerId,
      count: sent,
    });
    refreshLab(parsed.data.orderId);
    revalidatePath(`/settings/lab-partners/${parsed.data.partnerId}`);
    return { ok: true, unpriced };
  } catch (err) {
    return handle(err);
  }
}

export async function undoSendOutAction(input: { sendoutId: string; reason: string }): Promise<LabActionResult> {
  try {
    const user = await gate("lab.results");
    const { orderId } = await undoSendOut(String(input.sendoutId), String(input.reason ?? "").slice(0, 300), user);
    await recordAudit(user.id, "lab.send_out_undone", { sendoutId: input.sendoutId, orderId, reason: input.reason });
    refreshLab(orderId);
    return { ok: true, id: orderId };
  } catch (err) {
    return handle(err);
  }
}

const priceSchema = z.object({
  partnerId: z.string().min(1),
  testId: z.string().min(1),
  costPaisa: z.number().int("The price has to be a number.").min(0, "The price can't be below zero."),
});

/** What another laboratory charges for a test (its price list). */
export async function setPartnerPriceAction(input: unknown): Promise<LabActionResult & { filled?: number }> {
  try {
    const user = await assertPermission(["lab.catalog", "clinic.setup"]);
    const parsed = priceSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the price.");
    const { filled } = await setPartnerPrice(parsed.data.partnerId, parsed.data.testId, parsed.data.costPaisa);
    await recordAudit(user.id, "lab_partner.price_set", { ...parsed.data, filled });
    revalidatePath(`/settings/lab-partners/${parsed.data.partnerId}`);
    revalidatePath("/settings/lab-partners");
    revalidatePath("/reports/lab-partners");
    return { ok: true, filled };
  } catch (err) {
    return handle(err);
  }
}

// ---- order details ----

export async function setOrderDetailsAction(input: {
  orderId: string;
  referredBy: string;
  priority: "normal" | "urgent";
}): Promise<LabActionResult> {
  try {
    await gate(["lab.samples", "lab.results", "lab.approve"]);
    await setOrderDetails(input.orderId, {
      referredBy: input.referredBy.slice(0, 120),
      priority: input.priority === "urgent" ? "urgent" : "normal",
    });
    refreshLab(input.orderId);
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}

// ---- catalogue ----

const optNum = z.number().finite().nullable();
const overrideSchema = z.object({
  sex: z.enum(["m", "f"]).optional(),
  minAgeYears: z.number().int().min(0).max(130).optional(),
  maxAgeYears: z.number().int().min(0).max(131).optional(),
  low: optNum.optional(),
  high: optNum.optional(),
  text: z.string().max(120).optional(),
});
const rangeSchema = {
  refText: z.string().max(200),
  refLow: optNum,
  refHigh: optNum,
  criticalLow: optNum,
  criticalHigh: optNum,
  overrides: z.array(overrideSchema).max(20),
};
const paramSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Every value needs a name").max(120),
  unit: z.string().max(40),
  resultType: z.enum(["numeric", "text", "select", "pos_neg"]),
  selectOptions: z.array(z.string().max(80)).max(40),
  defaultRemarks: z.string().max(300),
  ...rangeSchema,
});
const testSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Give the test a name").max(160),
  shortCode: z.string().trim().max(40, "Keep the short code under 40 characters"),
  departmentId: z.string().nullable(),
  sampleTypeId: z.string().nullable(),
  method: z.string().max(160),
  description: z.string().max(1000),
  resultType: z.enum(["numeric", "text", "select", "pos_neg", "multi", "none"]),
  unit: z.string().max(40),
  selectOptions: z.array(z.string().max(80)).max(40),
  defaultRemarks: z.string().max(300),
  tatHours: z.number().int().min(0).max(2000).nullable(),
  sortOrder: z.number().int().min(0).max(9999),
  active: z.boolean(),
  billable: z.boolean(),
  ratePaisa: z.number().int().min(0),
  vatApplicable: z.boolean(),
  parameters: z.array(paramSchema).max(80),
  ...rangeSchema,
});

export async function saveTestAction(input: unknown): Promise<LabActionResult> {
  try {
    const user = await gate("lab.catalog");
    const parsed = testSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const { id, previousRatePaisa } = await saveTest(parsed.data);
    await recordAudit(user.id, parsed.data.id ? "lab_test.updated" : "lab_test.created", { testId: id, name: parsed.data.name });
    if (parsed.data.resultType === "none") {
      // nothing to enter any more: off Result entry on bills already made
      const { dropOpenResultsOfTest } = await import("@/lib/repos/lab-orders");
      const dropped = await dropOpenResultsOfTest(id);
      if (dropped > 0) await recordAudit(user.id, "lab_test.results_dropped", { testId: id, count: dropped });
    }
    if (previousRatePaisa != null && previousRatePaisa !== parsed.data.ratePaisa) {
      await recordAudit(user.id, "service.rate_changed", { labTestId: id, from: previousRatePaisa, to: parsed.data.ratePaisa });
    }
    revalidatePath("/lab/tests");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

const profileSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Give the profile a name").max(160),
  shortCode: z.string().trim().max(40, "Keep the short code under 40 characters"),
  departmentId: z.string().nullable(),
  active: z.boolean(),
  ratePaisa: z.number().int().min(0),
  vatApplicable: z.boolean(),
  testIds: z.array(z.string()).max(80),
});

export async function saveProfileAction(input: unknown): Promise<LabActionResult> {
  try {
    const user = await gate("lab.catalog");
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const { id, previousRatePaisa } = await saveProfile(parsed.data);
    await recordAudit(user.id, parsed.data.id ? "lab_profile.updated" : "lab_profile.created", { profileId: id, name: parsed.data.name });
    if (previousRatePaisa != null && previousRatePaisa !== parsed.data.ratePaisa) {
      await recordAudit(user.id, "service.rate_changed", { labProfileId: id, from: previousRatePaisa, to: parsed.data.ratePaisa });
    }
    revalidatePath("/lab/profiles");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

const packageSchema = profileSchema.extend({
  name: z.string().trim().min(2, "Give the package a name").max(160),
  profileIds: z.array(z.string()).max(60),
});

export async function savePackageAction(input: unknown): Promise<LabActionResult> {
  try {
    const user = await gate("lab.catalog");
    const parsed = packageSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const { id, previousRatePaisa } = await saveProfile({ ...parsed.data, kind: "package" });
    await recordAudit(user.id, parsed.data.id ? "lab_package.updated" : "lab_package.created", { packageId: id, name: parsed.data.name });
    if (previousRatePaisa != null && previousRatePaisa !== parsed.data.ratePaisa) {
      await recordAudit(user.id, "service.rate_changed", { labPackageId: id, from: previousRatePaisa, to: parsed.data.ratePaisa });
    }
    revalidatePath("/lab/packages");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

const deptSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Give it a name").max(80),
  sortOrder: z.number().int().min(0).max(999),
  showUnit: z.boolean(),
  showRange: z.boolean(),
  active: z.boolean(),
});

export async function saveDepartmentAction(input: unknown): Promise<LabActionResult> {
  try {
    await gate("lab.catalog");
    const parsed = deptSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const id = await saveDepartment(parsed.data);
    revalidatePath("/settings/lab");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

const sampleTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Give it a name").max(80),
  colorHex: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, "Pick a colour or leave it blank"),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
});

export async function saveSampleTypeAction(input: unknown): Promise<LabActionResult> {
  try {
    await gate("lab.catalog");
    const parsed = sampleTypeSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const id = await saveSampleType(parsed.data);
    revalidatePath("/settings/lab");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

// ---- the printed report ----

const dataUrl = z
  .string()
  .max(300_000, "That image is too large. Try a smaller one")
  .refine((s) => s === "" || /^data:image\/(png|jpeg|webp);base64,/.test(s), "Use a PNG, JPG or WEBP image");

const labSettingsSchema = z.object({
  headerImage: dataUrl,
  footerImage: dataUrl,
  marginTopMm: z.number().int().min(0).max(120),
  marginBottomMm: z.number().int().min(0).max(120),
  marginXMm: z.number().int().min(0).max(40),
});

export async function saveLabSettingsAction(input: unknown): Promise<LabActionResult> {
  try {
    const user = await gate("lab.catalog");
    const parsed = labSettingsSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const { saveLabSettings } = await import("@/lib/repos/lab-report");
    await saveLabSettings(parsed.data);
    await recordAudit(user.id, "lab.report_settings", {});
    revalidatePath("/settings/lab-report");
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}

const signatorySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter the name as it should print").max(120),
  description: z.string().trim().max(200),
  image: dataUrl,
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
});

export async function saveSignatoryAction(input: unknown): Promise<LabActionResult> {
  try {
    const user = await gate("lab.catalog");
    const parsed = signatorySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const { saveSignatory } = await import("@/lib/repos/lab-report");
    const id = await saveSignatory(parsed.data);
    await recordAudit(user.id, parsed.data.id ? "lab.signature_changed" : "lab.signature_added", { signatoryId: id, name: parsed.data.name });
    revalidatePath("/settings/lab-report");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}
