/**
 * Roles and permissions (0022).
 *
 * A misspelt key in a role is the quiet kind of bug: it grants nothing, hides
 * a menu item, and nobody notices until a lab technician can't open the page
 * they were hired to use. So the ready-made roles written into the migration
 * are checked against the real list here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_PERMISSIONS,
  ADMIN_ROLE_ID,
  DOCTOR_ROLE_ID,
  PERMISSION_GROUPS,
  effectivePermissions,
  hasPermission,
  isPermission,
  parsePermissions,
} from "@/lib/permissions";
import { SETTINGS_TABS, visibleSettingsTabs } from "@/lib/settings-tabs";

const migration = readFileSync(join(__dirname, "..", "db", "migrations", "0022_roles.sql"), "utf8");

/** Every JSON permission list in the seeded roles, by role id. */
function seededRoles(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /\('([a-z_]+)',\s*'[^']*',\s*'[^']*',\s*'(\[[^']*\])'/g;
  for (const m of migration.matchAll(re)) out.set(m[1]!, JSON.parse(m[2]!) as string[]);
  return out;
}

describe("the permission list", () => {
  it("has no key twice", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("gives every key a label a person can read", () => {
    for (const g of PERMISSION_GROUPS) {
      for (const i of g.items) {
        expect(i.label.length).toBeGreaterThan(5);
        // "Record" the verb ("Record purchases") is plain English; the noun is not.
        expect(i.label).not.toMatch(/database|\brow\b|\bapi\b|null|\brecords?\b(?! (?:and|purchases|visits))/i);
      }
    }
  });
});

describe("the ready-made roles", () => {
  const roles = seededRoles();

  it("seeds Admin, Doctor and the five starting roles", () => {
    expect([...roles.keys()].sort()).toEqual(
      ["accountant", "admin", "doctor", "front_desk", "lab_technician", "pathologist", "pharmacist"].sort(),
    );
  });

  it("uses only permissions that exist", () => {
    for (const [id, list] of roles) {
      for (const key of list) expect(isPermission(key), `${id}: ${key}`).toBe(true);
    }
  });

  it("keeps the counter away from the lab roles and the lab away from the pharmacist", () => {
    expect(roles.get("lab_technician")).not.toContain("counter.use");
    expect(roles.get("pathologist")).not.toContain("bills.cancel");
    expect(roles.get("pharmacist")).not.toContain("lab.approve");
    expect(roles.get("accountant")).not.toContain("counter.use");
  });
});

describe("what a role actually grants", () => {
  it("gives Admin everything, whatever its stored list says", () => {
    const granted = effectivePermissions(ADMIN_ROLE_ID, []);
    for (const p of ALL_PERMISSIONS) expect(granted.has(p)).toBe(true);
  });

  it("gives Doctor no back office at all, whatever its stored list says", () => {
    expect(effectivePermissions(DOCTOR_ROLE_ID, ["bills.view", "counter.use"]).size).toBe(0);
  });

  it("gives any other role exactly its list", () => {
    const granted = effectivePermissions("x", ["lab.results"]);
    expect(hasPermission(granted, "lab.results")).toBe(true);
    expect(hasPermission(granted, "lab.approve")).toBe(false);
    expect(hasPermission(granted, ["lab.approve", "lab.results"])).toBe(true);
  });

  it("reads a damaged list as nothing, never as everything", () => {
    expect(parsePermissions("not json")).toEqual([]);
    expect(parsePermissions('{"a":1}')).toEqual([]);
    expect(parsePermissions(null)).toEqual([]);
    expect(parsePermissions('["lab.results","made.up",7]')).toEqual(["lab.results"]);
  });
});

describe("Settings tabs", () => {
  const all = { pharmacy: true, clinic: true, lab: true };

  it("offers a person only the tabs their role allows", () => {
    const tabs = visibleSettingsTabs(all, ["users.manage"]).map((t) => t.href);
    expect(tabs).toEqual(["/settings/users", "/settings/roles"]);
  });

  it("hides a module's tabs when that module is off", () => {
    const tabs = visibleSettingsTabs({ pharmacy: true, clinic: false, lab: false }, [...ALL_PERMISSIONS]);
    expect(tabs.some((t) => t.href === "/settings/services")).toBe(false);
    expect(tabs.some((t) => t.href === "/settings/racks")).toBe(true);
  });

  it("guards every tab with a real permission", () => {
    for (const t of SETTINGS_TABS) expect(isPermission(t.perm)).toBe(true);
  });
});
