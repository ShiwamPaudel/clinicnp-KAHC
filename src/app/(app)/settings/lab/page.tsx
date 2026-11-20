import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listDepartments, listSampleTypes } from "@/lib/repos/lab-catalog";
import { LabMasters } from "@/components/lab/lab-masters";

export const metadata = { title: "Laboratory settings" };

export default async function LabSettingsPage() {
  await requireModulePage("lab");
  await requirePermission("lab.catalog");
  const [departments, sampleTypes] = await Promise.all([listDepartments(), listSampleTypes()]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <LabMasters departments={departments} sampleTypes={sampleTypes} />
    </main>
  );
}
