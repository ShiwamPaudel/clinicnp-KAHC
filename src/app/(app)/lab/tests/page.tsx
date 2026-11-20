import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listTests, listDepartments, listSampleTypes } from "@/lib/repos/lab-catalog";
import { TestManager } from "@/components/lab/test-manager";

export const metadata = { title: "Lab tests" };

export default async function TestsPage() {
  await requireModulePage("lab");
  await requirePermission("lab.catalog");
  const [tests, departments, sampleTypes] = await Promise.all([listTests(), listDepartments(false), listSampleTypes(false)]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <TestManager
        tests={tests}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        sampleTypes={sampleTypes.map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
