import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listDepartments, listSampleTypes } from "@/lib/repos/lab-catalog";
import { TestEditor } from "@/components/lab/test-editor";

export const metadata = { title: "New lab test" };

export default async function NewTestPage() {
  await requireModulePage("lab");
  await requirePermission("lab.catalog");
  const [departments, sampleTypes] = await Promise.all([listDepartments(false), listSampleTypes(false)]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-6 pt-6">
      <TestEditor
        test={null}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        sampleTypes={sampleTypes.map((s) => ({ id: s.id, name: s.name }))}
        profileNames={[]}
      />
    </main>
  );
}
