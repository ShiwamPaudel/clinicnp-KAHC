/**
 * session.ts — server-side session & permission guards. Use in server
 * components, server actions and route handlers.
 *
 * The sign-in cookie only says WHO someone is. What they may do is read from
 * their role on every request (lib/repos/users.ts getAuthUser), so switching
 * an account off or changing its role takes effect on the next click.
 *
 *   pages / layouts     requirePermission('lab.results')    -> redirects
 *   actions             assertPermission('lab.results')     -> throws NotAuthorizedError
 *   route handlers      getRequestUser() + can(user, …)     -> answer 401/403 yourself
 *
 * Permissions sit on top of the module switches, never instead of them: a
 * page still calls requireModulePage for its module (Rules.md §1.11).
 */
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAuthUser, type AuthUser } from "@/lib/repos/users";
import { hasPermission, type Permission } from "@/lib/permissions";

export type SessionUser = AuthUser;

/**
 * The Doctor role sees exactly one thing: their own booked consultations, on
 * their own phone. Every back-office page sends them to their own screen
 * rather than showing them a stripped one.
 */
export const DOCTOR_HOME = "/my/schedule";

/** Where somebody lands when they have no permission for the page they asked for. */
export const NO_ACCESS = "/no-access";

/** True when the user holds `need` (or any one of a list). Admin holds everything. */
export function can(user: SessionUser, need: Permission | readonly Permission[]): boolean {
  return hasPermission(user.permissions, need);
}

/**
 * The signed-in person for this request, or null. De-duplicated across every
 * guard and component in one render, so a page with five checks reads the
 * database once.
 */
export const getRequestUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return getAuthUser(id);
});

/** Where a person belongs after signing in. */
export function homeFor(user: SessionUser): string {
  if (user.isDoctor) return DOCTOR_HOME;
  if (can(user, "dashboard.view")) return "/dashboard";
  if (can(user, "counter.use")) return "/billing";
  if (can(user, "lab.samples")) return "/lab/samples";
  if (can(user, "lab.results")) return "/lab/results";
  if (can(user, "lab.approve")) return "/lab/approval";
  if (can(user, "lab.reports")) return "/lab/reports";
  return NO_ACCESS;
}

/** Returns the signed-in user or redirects to sign-in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The back office. Everyone signed in belongs here except a doctor, who has
 * their own screen and is sent to it.
 */
export async function requireBackOfficeUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.isDoctor) redirect(DOCTOR_HOME);
  return user;
}

/** A back-office page that needs a permission (or any one of a list). */
export async function requirePermission(
  need: Permission | readonly Permission[],
): Promise<SessionUser> {
  const user = await requireBackOfficeUser();
  if (!can(user, need)) redirect(NO_ACCESS);
  return user;
}

/**
 * The doctor's own screens. Returns both the sign-in and the doctor it belongs
 * to — a Doctor account with no doctor attached to it can see nothing, which
 * is the safe answer rather than an empty list of somebody else's patients.
 */
export async function requireDoctor(): Promise<{
  user: SessionUser;
  doctorId: string;
}> {
  const user = await requireUser();
  if (!user.isDoctor) redirect("/dashboard");
  const { getDoctorByUserId } = await import("@/lib/repos/doctors");
  const doctor = await getDoctorByUserId(user.id);
  if (!doctor) redirect("/my/not-linked");
  return { user, doctorId: doctor.id };
}

/** Thrown by server actions; mapped to plain language by the caller. */
export class NotAuthorizedError extends Error {
  code = "not_authorized" as const;
  userMessage = "You don't have permission to do that.";
  constructor() {
    super("not authorized");
  }
}

/** For server actions: the signed-in back-office user, or throw. */
export async function assertUser(): Promise<SessionUser> {
  const user = await getRequestUser();
  if (!user || user.isDoctor) throw new NotAuthorizedError();
  return user;
}

/** For server actions: the signed-in user holding `need`, or throw. */
export async function assertPermission(
  need: Permission | readonly Permission[],
): Promise<SessionUser> {
  const user = await assertUser();
  if (!can(user, need)) throw new NotAuthorizedError();
  return user;
}

/** For the doctor's own server actions. */
export async function assertDoctor(): Promise<SessionUser> {
  const user = await getRequestUser();
  if (!user || !user.isDoctor) throw new NotAuthorizedError();
  return user;
}
