/**
 * users.ts — all SQL for the users table. No SQL lives outside lib/repos (Rules.md §6).
 *
 * A user signs in with a username and password and holds exactly one role
 * (0022). What the role allows lives in lib/repos/roles.ts and
 * lib/permissions.ts; this file only knows which role a person has.
 */
import "server-only";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import type { Row } from "@/lib/db";
import {
  ADMIN_ROLE_ID,
  DOCTOR_ROLE_ID,
  effectivePermissions,
  parsePermissions,
  type Permission,
} from "@/lib/permissions";

export interface User {
  id: string;
  name: string;
  username: string;
  roleId: string;
  roleName: string;
  active: boolean;
  createdAt: string;
}

/** A signed-in person as the server checks them on every request. */
export interface AuthUser {
  id: string;
  name: string;
  roleId: string;
  roleName: string;
  isAdmin: boolean;
  isDoctor: boolean;
  permissions: ReadonlySet<Permission>;
}

const SELECT_USER = `SELECT u.*, r.name AS role_name, r.permissions AS role_permissions
                       FROM users u JOIN roles r ON r.id = u.role_id`;

function mapUser(r: Row): User {
  return {
    id: r.id as string,
    name: r.name as string,
    username: r.username as string,
    roleId: r.role_id as string,
    roleName: (r.role_name as string) ?? "",
    active: Number(r.active) === 1,
    createdAt: r.created_at as string,
  };
}

export async function listUsers(): Promise<User[]> {
  const res = await db().execute(`${SELECT_USER} ORDER BY u.active DESC, u.name ASC`);
  return res.rows.map(mapUser);
}

export async function getUserById(id: string): Promise<User | null> {
  const res = await db().execute({ sql: `${SELECT_USER} WHERE u.id = ?`, args: [id] });
  return res.rows[0] ? mapUser(res.rows[0]) : null;
}

export async function countUsers(): Promise<number> {
  const res = await db().execute("SELECT COUNT(*) AS n FROM users");
  return Number(res.rows[0]!.n);
}

/**
 * The person behind a session, read fresh: an account switched off, or moved
 * to another role, takes effect on their very next click rather than when
 * their sign-in expires. Null when the account is gone or inactive.
 */
export async function getAuthUser(id: string): Promise<AuthUser | null> {
  const res = await db().execute({
    sql: `${SELECT_USER} WHERE u.id = ? AND u.active = 1`,
    args: [id],
  });
  const r = res.rows[0];
  if (!r) return null;
  const roleId = r.role_id as string;
  return {
    id: r.id as string,
    name: r.name as string,
    roleId,
    roleName: (r.role_name as string) ?? "",
    isAdmin: roleId === ADMIN_ROLE_ID,
    isDoctor: roleId === DOCTOR_ROLE_ID,
    permissions: effectivePermissions(roleId, parsePermissions(r.role_permissions)),
  };
}

/** Verify username + password; returns the user on success, else null. */
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<User | null> {
  const res = await db().execute({
    sql: `${SELECT_USER} WHERE u.username = ? AND u.active = 1`,
    args: [username],
  });
  const row = res.rows[0];
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash as string)) return null;
  return mapUser(row);
}

export interface NewUser {
  name: string;
  username: string;
  password: string;
  roleId: string;
}

export async function createUser(input: NewUser): Promise<User> {
  const id = ulid();
  await db().execute({
    sql: `INSERT INTO users (id, name, username, password_hash, role_id, active, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)`,
    args: [
      id,
      input.name,
      input.username,
      hashPassword(input.password),
      input.roleId,
      new Date().toISOString(),
    ],
  });
  const u = await getUserById(id);
  if (!u) throw new Error("failed to create user");
  return u;
}

export interface UpdateUser {
  name?: string;
  roleId?: string;
  active?: boolean;
  password?: string;
}

export async function updateUser(id: string, patch: UpdateUser): Promise<void> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name);
  }
  if (patch.roleId !== undefined) {
    sets.push("role_id = ?");
    args.push(patch.roleId);
  }
  if (patch.active !== undefined) {
    sets.push("active = ?");
    args.push(patch.active ? 1 : 0);
  }
  if (patch.password) {
    sets.push("password_hash = ?");
    args.push(hashPassword(patch.password));
  }
  if (sets.length === 0) return;
  args.push(id);
  await db().execute({
    sql: `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function usernameExists(username: string): Promise<boolean> {
  const res = await db().execute({
    sql: "SELECT 1 FROM users WHERE username = ? LIMIT 1",
    args: [username],
  });
  return res.rows.length > 0;
}

/** How many active Admins there are — the last one may never be lost. */
export async function countActiveAdmins(): Promise<number> {
  const res = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND active = 1",
    args: [ADMIN_ROLE_ID],
  });
  return Number(res.rows[0]!.n);
}

/** Active Doctor logins, for linking a doctor to their sign-in. */
export async function listDoctorLogins(): Promise<User[]> {
  const res = await db().execute({
    sql: `${SELECT_USER} WHERE u.role_id = ? AND u.active = 1 ORDER BY u.name`,
    args: [DOCTOR_ROLE_ID],
  });
  return res.rows.map(mapUser);
}
