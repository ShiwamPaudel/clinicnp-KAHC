import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listProfiles, listTests } from "@/lib/repos/lab-catalog";
import { PackageManager } from "@/components/lab/package-manager";

export const metadata = { title: "Lab packages" };

export default async function PackagesPage() {
  await requireModulePage("lab");
  await requirePermission("lab.catalog");
  const [packages, profiles, tests] = await Promise.all([listProfiles("package"), listProfiles("profile"), listTests()]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <PackageManager
        packages={packages}
        profiles={profiles.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, testIds: p.testIds }))}
        tests={tests.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))}
      />
    </main>
  );
}
