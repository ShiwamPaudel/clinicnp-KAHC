/**
 * roles.ts — all SQL for the roles table (0022).
 *
 * A role is a name and a list of permission keys. `admin` and `doctor` are
 * fixed (is_system): they cannot be renamed, edited or deleted, because the
 * code gives them their meaning (lib/permissions.ts).
 */
import "server-only";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import type { Row } from "@/lib/db";
import { parsePermissions, type Permission } from "@/lib/permissions";

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  isSystem: boolean;
  userCount: number;
}

/** Thrown for a change the screen should explain in its own words. */
export class RoleProblem extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "RoleProblem";
    this.userMessage = userMessage;
  }
}

function mapRole(r: Row): Role {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    permissions: parsePermissions(r.permissions),
    isSystem: Number(r.is_system) === 1,
    userCount: Number(r.user_count ?? 0),
  };
}

const SELECT_ROLE = `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.active = 1) AS user_count
                       FROM roles r`;

export async function listRoles(): Promise<Role[]> {
  const res = await db().execute(`${SELECT_ROLE} ORDER BY r.sort_order, r.name`);
  return res.rows.map(mapRole);
}

export async function getRole(id: string): Promise<Role | null> {
  const res = await db().execute({ sql: `${SELECT_ROLE} WHERE r.id = ?`, args: [id] });
  return res.rows[0] ? mapRole(res.rows[0]) : null;
}

export async function roleExists(id: string): Promise<boolean> {
  const res = await db().execute({ sql: "SELECT 1 FROM roles WHERE id = ?", args: [id] });
  return res.rows.length > 0;
}

async function nameTaken(name: string, exceptId: string | null): Promise<boolean> {
  const res = await db().execute({
    sql: "SELECT 1 FROM roles WHERE lower(name) = lower(?) AND id <> ? LIMIT 1",
    args: [name, exceptId ?? ""],
  });
  return res.rows.length > 0;
}

export interface RoleInput {
  name: string;
  description: string;
  permissions: Permission[];
}

export async function createRole(input: RoleInput): Promise<string> {
  if (await nameTaken(input.name, null)) {
    throw new RoleProblem("There is already a role with that name.");
  }
  const id = ulid();
  const now = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO roles (id, name, description, permissions, is_system, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, 100, ?, ?)`,
    args: [id, input.name, input.description, JSON.stringify(input.permissions), now, now],
  });
  return id;
}

export async function updateRole(id: string, input: RoleInput): Promise<void> {
  const role = await getRole(id);
  if (!role) throw new RoleProblem("That role no longer exists.");
  if (role.isSystem) throw new RoleProblem("This role is fixed and can't be changed.");
  if (await nameTaken(input.name, id)) {
    throw new RoleProblem("There is already a role with that name.");
  }
  await db().execute({
    sql: "UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?",
    args: [input.name, input.description, JSON.stringify(input.permissions), new Date().toISOString(), id],
  });
}

export async function deleteRole(id: string): Promise<void> {
  const role = await getRole(id);
  if (!role) return;
  if (role.isSystem) throw new RoleProblem("This role is fixed and can't be removed.");
  const res = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM users WHERE role_id = ?",
    args: [id],
  });
  if (Number(res.rows[0]!.n) > 0) {
    throw new RoleProblem("Move everybody off this role before removing it — including people who are switched off.");
  }
  await db().execute({ sql: "DELETE FROM roles WHERE id = ? AND is_system = 0", args: [id] });
}
