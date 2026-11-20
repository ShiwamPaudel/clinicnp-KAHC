import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listProfiles, listTests, listDepartments } from "@/lib/repos/lab-catalog";
import { ProfileManager } from "@/components/lab/profile-manager";

export const metadata = { title: "Lab profiles" };

export default async function ProfilesPage() {
  await requireModulePage("lab");
  await requirePermission("lab.catalog");
  const [profiles, tests, departments] = await Promise.all([listProfiles(), listTests(), listDepartments(false)]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <ProfileManager
        profiles={profiles}
        tests={tests.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      />
    </main>
  );
}
