import { redirect } from "next/navigation";
import { requireBackOfficeUser, can, NO_ACCESS } from "@/lib/session";
import type { Permission } from "@/lib/permissions";

const ORDER: [string, Permission][] = [
  ["/lab/samples", "lab.samples"],
  ["/lab/results", "lab.results"],
  ["/lab/approval", "lab.approve"],
  ["/lab/reports", "lab.reports"],
  ["/lab/dispatch", "lab.dispatch"],
  ["/lab/tests", "lab.catalog"],
];

/** The laboratory opens on the first list this person works from. */
export default async function LabIndex() {
  const user = await requireBackOfficeUser();
  redirect(ORDER.find(([, p]) => can(user, p))?.[0] ?? NO_ACCESS);
}
