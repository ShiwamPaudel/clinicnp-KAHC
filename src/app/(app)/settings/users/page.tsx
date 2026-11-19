import { requirePermission } from "@/lib/session";
import { listUsers } from "@/lib/repos/users";
import { listRoles } from "@/lib/repos/roles";
import { UsersManager } from "@/components/app/users-manager";

export const metadata = { title: "Users" };

export default async function UsersSettingsPage() {
  const me = await requirePermission("users.manage");
  const [users, roles] = await Promise.all([listUsers(), listRoles()]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <UsersManager
        initial={users}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        selfId={me.id}
      />
    </main>
  );
}
