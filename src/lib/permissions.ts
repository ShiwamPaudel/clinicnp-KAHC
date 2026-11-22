/**
 * permissions.ts — what a person may see and do, as a list of plain keys.
 *
 * A role is a name plus a set of these keys, kept in the `roles` table and
 * edited by the Admin under Settings → Roles. Every page, server action and
 * route handler asks for the key it needs (`requirePermission`,
 * `assertPermission` in lib/session.ts); the menu hides what a person cannot
 * open, but hiding is cosmetics — the server check is the boundary, exactly as
 * with the module switches (Rules.md §1.11).
 *
 * Two roles are fixed and cannot be edited or deleted:
 *   - `admin`  — everything, always, including keys added after the role was
 *                created. It ignores its stored list.
 *   - `doctor` — no back office at all: a doctor signs in to their own booked
 *                consultations and nothing else (Rules.md §2.5).
 *
 * Pure and dependency-free so the role editor in the browser can import it.
 */

export const ADMIN_ROLE_ID = "admin";
export const DOCTOR_ROLE_ID = "doctor";

/** The module a permission belongs to; `null` = needed whatever is switched on. */
export type PermissionModule = "pharmacy" | "clinic" | "lab" | null;

export interface PermissionDef {
  key: string;
  label: string;
  module: PermissionModule;
}

export interface PermissionGroup {
  label: string;
  items: readonly PermissionDef[];
}

export const PERMISSION_GROUPS = [
  {
    label: "Everyday",
    items: [
      { key: "dashboard.view", label: "See the dashboard", module: null },
      { key: "counter.use", label: "Use the counter and make bills", module: null },
      { key: "counter.change_rate", label: "Change a price at the counter", module: null },
      { key: "bills.view", label: "See bills", module: null },
      { key: "bills.cancel", label: "Cancel bills, give refunds, clear stuck bills", module: null },
      { key: "dues.view", label: "See who owes money", module: null },
      { key: "dues.collect", label: "Take payment for dues", module: null },
      { key: "dues.undo", label: "Undo a dues payment", module: null },
    ],
  },
  {
    label: "Patients",
    items: [
      { key: "patients.view", label: "See patients", module: null },
      { key: "patients.manage", label: "Register and edit patients, add files", module: null },
      { key: "patients.merge", label: "Merge patients and remove their files", module: null },
    ],
  },
  {
    label: "Clinic",
    items: [
      { key: "visits.view", label: "See visits", module: "clinic" },
      { key: "visits.manage", label: "Record and edit visits", module: "clinic" },
      { key: "visits.cancel", label: "Cancel a visit", module: "clinic" },
      { key: "appointments.manage", label: "Pre-book tests and consultations, take advances", module: "clinic" },
      { key: "clinic.setup", label: "Set up services, doctors and outside laboratories", module: "clinic" },
    ],
  },
  {
    label: "Pharmacy",
    items: [
      { key: "stock.view", label: "See stock", module: "pharmacy" },
      { key: "stock.adjust", label: "Opening stock, stock out, write-offs and shelves", module: "pharmacy" },
      { key: "items.manage", label: "Add and edit medicines", module: "pharmacy" },
      { key: "prices.manage", label: "Set selling prices", module: "pharmacy" },
      { key: "purchases.manage", label: "Record purchases and purchase returns", module: "pharmacy" },
      { key: "suppliers.manage", label: "Suppliers, payables and payments to them", module: "pharmacy" },
    ],
  },
  {
    label: "Laboratory",
    items: [
      { key: "lab.samples", label: "Collect and reject samples, print labels", module: "lab" },
      { key: "lab.results", label: "Enter results, or send tests to another laboratory", module: "lab" },
      { key: "lab.approve", label: "Approve results and sign reports", module: "lab" },
      { key: "lab.reopen", label: "Reopen approved results", module: "lab" },
      { key: "lab.reports", label: "See and print lab reports", module: "lab" },
      { key: "lab.catalog", label: "Set up tests, groups, departments and sample types", module: "lab" },
    ],
  },
  {
    label: "Accounts",
    items: [
      { key: "accounts.view", label: "See the books: ledgers, parties, aging, profit and loss, balance sheet", module: null },
      { key: "accounts.post", label: "Enter and cancel vouchers (expenses, bank, payouts)", module: null },
      { key: "accounts.setup", label: "Chart of accounts, other parties and opening balances", module: null },
    ],
  },
  {
    label: "Reports",
    items: [
      { key: "reports.view", label: "Day close and everyday reports", module: null },
      { key: "reports.all", label: "Every report, every year, and exports", module: null },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "settings.manage", label: "Company, printing, modules, fiscal years and backups", module: null },
      { key: "users.manage", label: "Users and roles", module: null },
      { key: "audit.view", label: "See the audit log", module: null },
    ],
  },
] as const satisfies readonly PermissionGroup[];

export type Permission = (typeof PERMISSION_GROUPS)[number]["items"][number]["key"];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

/** Any one of these opens the Laboratory. */
export const LAB_PERMISSIONS: readonly Permission[] = [
  "lab.samples",
  "lab.results",
  "lab.approve",
  "lab.reports",
  "lab.catalog",
  "lab.reopen",
];

/** Any one of these opens Accounts. */
export const ACCOUNTS_PERMISSIONS: readonly Permission[] = ["accounts.view", "accounts.post", "accounts.setup"];

const KNOWN = new Set<string>(ALL_PERMISSIONS);

export function isPermission(key: string): key is Permission {
  return KNOWN.has(key);
}

/**
 * Read a role's stored list. Unknown keys (a permission since retired) are
 * dropped rather than trusted; a damaged list reads as "nothing", never as
 * "everything".
 */
export function parsePermissions(raw: unknown): Permission[] {
  if (typeof raw !== "string") return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter((k): k is Permission => typeof k === "string" && isPermission(k)))];
  } catch {
    return [];
  }
}

/** The permissions a role actually grants. The Admin role is everything. */
export function effectivePermissions(roleId: string, stored: readonly Permission[]): ReadonlySet<Permission> {
  if (roleId === ADMIN_ROLE_ID) return new Set(ALL_PERMISSIONS);
  if (roleId === DOCTOR_ROLE_ID) return new Set();
  return new Set(stored);
}

/** True when the set holds `need` — or, given a list, any one of it. */
export function hasPermission(
  granted: ReadonlySet<Permission>,
  need: Permission | readonly Permission[],
): boolean {
  if (typeof need === "string") return granted.has(need);
  return need.some((p) => granted.has(p));
}
