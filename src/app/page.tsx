import { redirect } from "next/navigation";
import { getRequestUser, homeFor } from "@/lib/session";

/**
 * The front door.
 *
 * Everyone signing in is sent here rather than straight to the dashboard,
 * because where somebody belongs depends on their role and only the server
 * knows that: a doctor to their own list, a lab technician to the samples
 * waiting, the counter to the counter.
 */
export default async function RootPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  redirect(homeFor(user));
}
