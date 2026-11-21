import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { getTest, listDepartments, listSampleTypes, listProfiles } from "@/lib/repos/lab-catalog";
import { TestEditor } from "@/components/lab/test-editor";

export const metadata = { title: "Lab test" };

export default async function EditTestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModulePage("lab");
  await requirePermission("lab.catalog");
  const { id } = await params;
  const [test, departments, sampleTypes, profiles] = await Promise.all([
    getTest(id),
    listDepartments(true),
    listSampleTypes(true),
    listProfiles(),
  ]);
  if (!test) notFound();
  // a department or sample type switched off still shows on the test that uses it
  const keep = <T extends { id: string; active: boolean }>(list: T[], current: string | null) =>
    list.filter((x) => x.active || x.id === current);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-6 pt-6">
      <TestEditor
        test={test}
        departments={keep(departments, test.departmentId).map((d) => ({ id: d.id, name: d.name }))}
        sampleTypes={keep(sampleTypes, test.sampleTypeId).map((s) => ({ id: s.id, name: s.name }))}
        profileNames={profiles.filter((p) => p.testIds.includes(test.id)).map((p) => p.name)}
      />
    </main>
  );
}
