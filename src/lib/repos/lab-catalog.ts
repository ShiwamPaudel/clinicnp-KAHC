/**
 * lab-catalog.ts — all SQL for what the laboratory can test (0024).
 *
 * Every test and every profile owns one row in `services`, created and kept
 * in step here, so the counter bills it like any other service and its price
 * lives where every other price lives. The lab catalogue itself holds no money.
 *
 * Reference ranges are the lab in-charge's own; nothing here supplies one.
 */
import "server-only";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import type { Row, InStatement } from "@/lib/db";
import { parseOverrides, type RangeOverride } from "@/lib/lab-flags";

export type LabResultType = "numeric" | "text" | "select" | "pos_neg" | "multi";
export type LabParamType = Exclude<LabResultType, "multi">;

export class LabCatalogProblem extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "LabCatalogProblem";
    this.userMessage = userMessage;
  }
}

// ---------------------------------------------------------------------------
// departments and sample types
// ---------------------------------------------------------------------------

export interface LabDepartment {
  id: string;
  name: string;
  sortOrder: number;
  showUnit: boolean;
  showRange: boolean;
  active: boolean;
}

export interface LabSampleType {
  id: string;
  name: string;
  colorHex: string;
  sortOrder: number;
  active: boolean;
}

export async function listDepartments(includeInactive = true): Promise<LabDepartment[]> {
  const res = await db().execute(
    `SELECT * FROM lab_departments ${includeInactive ? "" : "WHERE active = 1"} ORDER BY sort_order, name`,
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    sortOrder: Number(r.sort_order),
    showUnit: Number(r.show_unit) === 1,
    showRange: Number(r.show_range) === 1,
    active: Number(r.active) === 1,
  }));
}

export async function saveDepartment(input: Omit<LabDepartment, "id"> & { id?: string }): Promise<string> {
  const now = new Date().toISOString();
  if (input.id) {
    await db().execute({
      sql: `UPDATE lab_departments SET name = ?, sort_order = ?, show_unit = ?, show_range = ?, active = ?, updated_at = ?
             WHERE id = ?`,
      args: [input.name, input.sortOrder, input.showUnit ? 1 : 0, input.showRange ? 1 : 0, input.active ? 1 : 0, now, input.id],
    });
    return input.id;
  }
  const id = ulid();
  await db().execute({
    sql: `INSERT INTO lab_departments (id, name, sort_order, show_unit, show_range, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, input.name, input.sortOrder, input.showUnit ? 1 : 0, input.showRange ? 1 : 0, input.active ? 1 : 0, now, now],
  });
  return id;
}

export async function listSampleTypes(includeInactive = true): Promise<LabSampleType[]> {
  const res = await db().execute(
    `SELECT * FROM lab_sample_types ${includeInactive ? "" : "WHERE active = 1"} ORDER BY sort_order, name`,
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    colorHex: (r.color_hex as string) ?? "",
    sortOrder: Number(r.sort_order),
    active: Number(r.active) === 1,
  }));
}

export async function saveSampleType(input: Omit<LabSampleType, "id"> & { id?: string }): Promise<string> {
  const now = new Date().toISOString();
  if (input.id) {
    await db().execute({
      sql: `UPDATE lab_sample_types SET name = ?, color_hex = ?, sort_order = ?, active = ?, updated_at = ? WHERE id = ?`,
      args: [input.name, input.colorHex, input.sortOrder, input.active ? 1 : 0, now, input.id],
    });
    return input.id;
  }
  const id = ulid();
  await db().execute({
    sql: `INSERT INTO lab_sample_types (id, name, color_hex, sort_order, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, input.name, input.colorHex, input.sortOrder, input.active ? 1 : 0, now, now],
  });
  return id;
}

// ---------------------------------------------------------------------------
// the counter group lab services are billed under
// ---------------------------------------------------------------------------

/**
 * The service group lab tests and profiles are billed under, made the first
 * time a test is saved and remembered in lab_settings. Renaming it under
 * Settings → Services is fine; the link is by id.
 */
async function labServiceGroupId(): Promise<string> {
  const res = await db().execute("SELECT service_group_id FROM lab_settings WHERE id = 1");
  const existing = res.rows[0]?.service_group_id as string | null | undefined;
  if (existing) {
    const g = await db().execute({ sql: "SELECT id FROM service_groups WHERE id = ?", args: [existing] });
    if (g.rows[0]) return existing;
  }
  const id = ulid();
  const now = new Date().toISOString();
  await db().batch(
    [
      {
        sql: `INSERT INTO service_groups (id, name, sort_order, is_consultation, active, created_at)
              VALUES (?, 'Laboratory', 50, 0, 1, ?)`,
        args: [id, now],
      },
      {
        sql: "UPDATE lab_settings SET service_group_id = ?, updated_at = ? WHERE id = 1",
        args: [id, now],
      },
    ],
    "write",
  );
  return id;
}

/** The statements that create or update a lab item's service row. */
function serviceStatements(
  serviceId: string,
  isNew: boolean,
  groupId: string,
  p: { name: string; code: string; ratePaisa: number; sampleType: string; vatApplicable: boolean; active: boolean },
  now: string,
): InStatement {
  if (isNew) {
    return {
      sql: `INSERT INTO services
              (id, name, code, group_id, rate_paisa, doctor_required, default_doctor_id,
               outsourced, default_lab_partner_id, partner_cost_paisa, sample_type,
               followup_days, followup_rate_paisa, vat_applicable, sample_rate,
               active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, NULL, 0, NULL, 0, ?, 0, 0, ?, 0, ?, ?, ?)`,
      args: [serviceId, p.name, p.code || null, groupId, p.ratePaisa, p.sampleType, p.vatApplicable ? 1 : 0, p.active ? 1 : 0, now, now],
    };
  }
  return {
    sql: `UPDATE services SET name = ?, code = ?, rate_paisa = ?, sample_type = ?, vat_applicable = ?, active = ?, updated_at = ?
           WHERE id = ?`,
    args: [p.name, p.code || null, p.ratePaisa, p.sampleType, p.vatApplicable ? 1 : 0, p.active ? 1 : 0, now, serviceId],
  };
}

// ---------------------------------------------------------------------------
// tests and their parameters
// ---------------------------------------------------------------------------

export interface RangeFields {
  refText: string;
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  overrides: RangeOverride[];
}

export interface LabParameter extends RangeFields {
  id: string;
  name: string;
  unit: string;
  resultType: LabParamType;
  selectOptions: string[];
  defaultRemarks: string;
  sortOrder: number;
}

export interface LabTest extends RangeFields {
  id: string;
  serviceId: string;
  name: string;
  shortCode: string;
  departmentId: string | null;
  departmentName: string;
  sampleTypeId: string | null;
  sampleTypeName: string;
  method: string;
  description: string;
  resultType: LabResultType;
  unit: string;
  selectOptions: string[];
  defaultRemarks: string;
  tatHours: number | null;
  sortOrder: number;
  active: boolean;
  /** billed on its own at the counter (the service is active) */
  billable: boolean;
  ratePaisa: number;
  vatApplicable: boolean;
  parameters: LabParameter[];
}

function parseList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function rangeOf(r: Row): RangeFields {
  return {
    refText: (r.ref_text as string) ?? "",
    refLow: num(r.ref_low),
    refHigh: num(r.ref_high),
    criticalLow: num(r.critical_low),
    criticalHigh: num(r.critical_high),
    overrides: parseOverrides(r.ref_overrides),
  };
}

function mapParam(r: Row): LabParameter {
  return {
    id: r.id as string,
    name: r.name as string,
    unit: (r.unit as string) ?? "",
    resultType: (r.result_type as LabParamType) ?? "numeric",
    selectOptions: parseList(r.select_options),
    defaultRemarks: (r.default_remarks as string) ?? "",
    sortOrder: Number(r.sort_order),
    ...rangeOf(r),
  };
}

const TEST_SELECT = `
  SELECT t.*, s.rate_paisa, s.active AS service_active, s.vat_applicable,
         d.name AS department_name, st.name AS sample_type_name
    FROM lab_tests t
    JOIN services s ON s.id = t.service_id
    LEFT JOIN lab_departments d ON d.id = t.department_id
    LEFT JOIN lab_sample_types st ON st.id = t.sample_type_id`;

function mapTest(r: Row, params: LabParameter[]): LabTest {
  return {
    id: r.id as string,
    serviceId: r.service_id as string,
    name: r.name as string,
    shortCode: (r.short_code as string) ?? "",
    departmentId: (r.department_id as string | null) ?? null,
    departmentName: (r.department_name as string | null) ?? "",
    sampleTypeId: (r.sample_type_id as string | null) ?? null,
    sampleTypeName: (r.sample_type_name as string | null) ?? "",
    method: (r.method as string) ?? "",
    description: (r.description as string) ?? "",
    resultType: (r.result_type as LabResultType) ?? "numeric",
    unit: (r.unit as string) ?? "",
    selectOptions: parseList(r.select_options),
    defaultRemarks: (r.default_remarks as string) ?? "",
    tatHours: r.tat_hours == null ? null : Number(r.tat_hours),
    sortOrder: Number(r.sort_order),
    active: Number(r.active) === 1,
    billable: Number(r.service_active) === 1,
    ratePaisa: Number(r.rate_paisa),
    vatApplicable: Number(r.vat_applicable) === 1,
    parameters: params,
    ...rangeOf(r),
  };
}

/** Every test with its parameters, in report order. */
export async function listTests(): Promise<LabTest[]> {
  const [tests, params] = await Promise.all([
    db().execute(`${TEST_SELECT} ORDER BY d.sort_order, t.sort_order, t.name`),
    db().execute("SELECT * FROM lab_test_parameters WHERE active = 1 ORDER BY sort_order, name"),
  ]);
  const byTest = new Map<string, LabParameter[]>();
  for (const p of params.rows) {
    const list = byTest.get(p.test_id as string) ?? [];
    list.push(mapParam(p));
    byTest.set(p.test_id as string, list);
  }
  return tests.rows.map((r) => mapTest(r, byTest.get(r.id as string) ?? []));
}

export async function getTest(id: string): Promise<LabTest | null> {
  const res = await db().execute({ sql: `${TEST_SELECT} WHERE t.id = ?`, args: [id] });
  const r = res.rows[0];
  if (!r) return null;
  const params = await db().execute({
    sql: "SELECT * FROM lab_test_parameters WHERE test_id = ? AND active = 1 ORDER BY sort_order, name",
    args: [id],
  });
  return mapTest(r, params.rows.map(mapParam));
}

export interface ParameterInput extends RangeFields {
  /** present for a parameter that already exists */
  id?: string;
  name: string;
  unit: string;
  resultType: LabParamType;
  selectOptions: string[];
  defaultRemarks: string;
}

export interface TestInput extends RangeFields {
  id?: string;
  name: string;
  shortCode: string;
  departmentId: string | null;
  sampleTypeId: string | null;
  method: string;
  description: string;
  resultType: LabResultType;
  unit: string;
  selectOptions: string[];
  defaultRemarks: string;
  tatHours: number | null;
  sortOrder: number;
  active: boolean;
  billable: boolean;
  ratePaisa: number;
  vatApplicable: boolean;
  parameters: ParameterInput[];
}

const json = (v: unknown) => JSON.stringify(v);

/**
 * Save a test, its service row and its parameters in one transaction.
 * Parameters no longer in the list are switched off rather than deleted — a
 * past result still points at them.
 * Returns the test id and, for an existing test, the price it had before.
 */
export async function saveTest(input: TestInput): Promise<{ id: string; previousRatePaisa: number | null }> {
  if (input.resultType === "multi" && input.parameters.length === 0) {
    throw new LabCatalogProblem("A test with several values needs at least one of them listed.");
  }
  const groupId = await labServiceGroupId();
  const now = new Date().toISOString();
  const existing = input.id ? await getTest(input.id) : null;
  if (input.id && !existing) throw new LabCatalogProblem("That test no longer exists. Reload and try again.");

  const id = existing?.id ?? ulid();
  const serviceId = existing?.serviceId ?? ulid();
  const sampleTypeName = input.sampleTypeId
    ? (((await db().execute({ sql: "SELECT name FROM lab_sample_types WHERE id = ?", args: [input.sampleTypeId] })).rows[0]?.name as string | undefined) ?? "")
    : "";

  const stmts: InStatement[] = [
    serviceStatements(
      serviceId,
      !existing,
      groupId,
      {
        name: input.name,
        code: input.shortCode,
        ratePaisa: input.ratePaisa,
        sampleType: sampleTypeName,
        vatApplicable: input.vatApplicable,
        active: input.active && input.billable,
      },
      now,
    ),
  ];

  const testArgs = [
    input.name,
    input.shortCode,
    input.departmentId,
    input.sampleTypeId,
    input.method,
    input.description,
    input.resultType,
    input.unit,
    json(input.selectOptions),
    input.refText,
    input.refLow,
    input.refHigh,
    input.criticalLow,
    input.criticalHigh,
    json(input.overrides),
    input.defaultRemarks,
    input.tatHours,
    input.sortOrder,
    input.active ? 1 : 0,
    now,
  ];
  if (existing) {
    stmts.push({
      sql: `UPDATE lab_tests SET name = ?, short_code = ?, department_id = ?, sample_type_id = ?, method = ?,
               description = ?, result_type = ?, unit = ?, select_options = ?, ref_text = ?, ref_low = ?,
               ref_high = ?, critical_low = ?, critical_high = ?, ref_overrides = ?, default_remarks = ?,
               tat_hours = ?, sort_order = ?, active = ?, updated_at = ?
             WHERE id = ?`,
      args: [...testArgs, id],
    });
  } else {
    stmts.push({
      sql: `INSERT INTO lab_tests
              (name, short_code, department_id, sample_type_id, method, description, result_type, unit,
               select_options, ref_text, ref_low, ref_high, critical_low, critical_high, ref_overrides,
               default_remarks, tat_hours, sort_order, active, updated_at, id, service_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [...testArgs, id, serviceId, now],
    });
  }

  // parameters: update the ones kept, add the new, switch off the dropped
  const params = input.resultType === "multi" ? input.parameters : [];
  const keep = new Set(params.filter((p) => p.id).map((p) => p.id as string));
  for (const old of existing?.parameters ?? []) {
    if (!keep.has(old.id)) {
      stmts.push({ sql: "UPDATE lab_test_parameters SET active = 0, updated_at = ? WHERE id = ?", args: [now, old.id] });
    }
  }
  params.forEach((p, i) => {
    const args = [
      p.name,
      p.unit,
      p.resultType,
      json(p.selectOptions),
      p.refText,
      p.refLow,
      p.refHigh,
      p.criticalLow,
      p.criticalHigh,
      json(p.overrides),
      p.defaultRemarks,
      i,
      now,
    ];
    if (p.id && existing?.parameters.some((x) => x.id === p.id)) {
      stmts.push({
        sql: `UPDATE lab_test_parameters SET name = ?, unit = ?, result_type = ?, select_options = ?, ref_text = ?,
                 ref_low = ?, ref_high = ?, critical_low = ?, critical_high = ?, ref_overrides = ?,
                 default_remarks = ?, sort_order = ?, updated_at = ?, active = 1
               WHERE id = ? AND test_id = ?`,
        args: [...args, p.id, id],
      });
    } else {
      stmts.push({
        sql: `INSERT INTO lab_test_parameters
                (name, unit, result_type, select_options, ref_text, ref_low, ref_high, critical_low,
                 critical_high, ref_overrides, default_remarks, sort_order, updated_at, id, test_id, created_at, active)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [...args, ulid(), id, now],
      });
    }
  });

  await db().batch(stmts, "write");
  return { id, previousRatePaisa: existing ? existing.ratePaisa : null };
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

export interface LabProfile {
  id: string;
  serviceId: string;
  name: string;
  shortCode: string;
  departmentId: string | null;
  departmentName: string;
  active: boolean;
  ratePaisa: number;
  vatApplicable: boolean;
  testIds: string[];
  testNames: string[];
}

export async function listProfiles(): Promise<LabProfile[]> {
  const [groups, items] = await Promise.all([
    db().execute(
      `SELECT g.*, s.rate_paisa, s.vat_applicable, d.name AS department_name
         FROM lab_test_groups g
         JOIN services s ON s.id = g.service_id
         LEFT JOIN lab_departments d ON d.id = g.department_id
        ORDER BY g.name`,
    ),
    db().execute(
      `SELECT i.group_id, i.test_id, t.name
         FROM lab_test_group_items i JOIN lab_tests t ON t.id = i.test_id
        ORDER BY i.sort_order`,
    ),
  ]);
  const members = new Map<string, { ids: string[]; names: string[] }>();
  for (const i of items.rows) {
    const m = members.get(i.group_id as string) ?? { ids: [], names: [] };
    m.ids.push(i.test_id as string);
    m.names.push(i.name as string);
    members.set(i.group_id as string, m);
  }
  return groups.rows.map((r) => ({
    id: r.id as string,
    serviceId: r.service_id as string,
    name: r.name as string,
    shortCode: (r.short_code as string) ?? "",
    departmentId: (r.department_id as string | null) ?? null,
    departmentName: (r.department_name as string | null) ?? "",
    active: Number(r.active) === 1,
    ratePaisa: Number(r.rate_paisa),
    vatApplicable: Number(r.vat_applicable) === 1,
    testIds: members.get(r.id as string)?.ids ?? [],
    testNames: members.get(r.id as string)?.names ?? [],
  }));
}

export interface ProfileInput {
  id?: string;
  name: string;
  shortCode: string;
  departmentId: string | null;
  active: boolean;
  ratePaisa: number;
  vatApplicable: boolean;
  testIds: string[];
}

export async function saveProfile(input: ProfileInput): Promise<{ id: string; previousRatePaisa: number | null }> {
  const testIds = [...new Set(input.testIds)];
  if (testIds.length === 0) throw new LabCatalogProblem("Put at least one test in the profile.");
  const known = await db().execute({
    sql: `SELECT id FROM lab_tests WHERE id IN (${testIds.map(() => "?").join(",")})`,
    args: testIds,
  });
  if (known.rows.length !== testIds.length) {
    throw new LabCatalogProblem("One of the tests in this profile no longer exists. Reload and try again.");
  }
  const groupId = await labServiceGroupId();
  const now = new Date().toISOString();
  const existing = input.id ? (await listProfiles()).find((p) => p.id === input.id) ?? null : null;
  if (input.id && !existing) throw new LabCatalogProblem("That profile no longer exists. Reload and try again.");
  const id = existing?.id ?? ulid();
  const serviceId = existing?.serviceId ?? ulid();

  const stmts: InStatement[] = [
    serviceStatements(
      serviceId,
      !existing,
      groupId,
      { name: input.name, code: input.shortCode, ratePaisa: input.ratePaisa, sampleType: "", vatApplicable: input.vatApplicable, active: input.active },
      now,
    ),
    existing
      ? {
          sql: "UPDATE lab_test_groups SET name = ?, short_code = ?, department_id = ?, active = ?, updated_at = ? WHERE id = ?",
          args: [input.name, input.shortCode, input.departmentId, input.active ? 1 : 0, now, id],
        }
      : {
          sql: `INSERT INTO lab_test_groups (id, service_id, name, short_code, department_id, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [id, serviceId, input.name, input.shortCode, input.departmentId, input.active ? 1 : 0, now, now],
        },
    { sql: "DELETE FROM lab_test_group_items WHERE group_id = ?", args: [id] },
    ...testIds.map((t, i) => ({
      sql: "INSERT INTO lab_test_group_items (id, group_id, test_id, sort_order) VALUES (?, ?, ?, ?)",
      args: [ulid(), id, t, i],
    })),
  ];
  await db().batch(stmts, "write");
  return { id, previousRatePaisa: existing ? existing.ratePaisa : null };
}

// ---------------------------------------------------------------------------
// what the bill ingest needs
// ---------------------------------------------------------------------------

export interface BillableLabTest {
  testId: string;
  name: string;
  departmentId: string | null;
  sampleTypeId: string | null;
  sampleTypeName: string;
  sortOrder: number;
}

export type LabBillable =
  | { kind: "test"; test: BillableLabTest }
  | { kind: "group"; groupId: string; groupName: string; tests: BillableLabTest[] };

/** Service ids that are lab tests or profiles, for the counter's catalogue. */
export async function labServiceKinds(): Promise<Map<string, "test" | "group">> {
  const res = await db().execute(
    `SELECT service_id, 'test' AS kind FROM lab_tests
     UNION ALL SELECT service_id, 'group' AS kind FROM lab_test_groups`,
  );
  return new Map(res.rows.map((r) => [r.service_id as string, r.kind as "test" | "group"]));
}
