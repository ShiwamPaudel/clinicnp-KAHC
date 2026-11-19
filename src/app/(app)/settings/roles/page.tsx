import { requirePermission } from "@/lib/session";
import { getModules } from "@/lib/modules";
import { listRoles } from "@/lib/repos/roles";
import { RolesManager } from "@/components/app/roles-manager";

export const metadata = { title: "Roles" };

export default async function RolesSettingsPage() {
  await requirePermission("users.manage");
  const [roles, modules] = await Promise.all([listRoles(), getModules()]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <RolesManager roles={roles} modules={modules} />
    </main>
  );
}
