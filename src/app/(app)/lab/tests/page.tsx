import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listTests, listDepartments } from "@/lib/repos/lab-catalog";
import { TestList } from "@/components/lab/test-list";

export const metadata = { title: "Lab tests" };

const RESULT_LABEL: Record<string, string> = {
  numeric: "A number",
  text: "Words",
  select: "Pick from a list",
  pos_neg: "Positive / Negative",
};

export default async function TestsPage() {
  await requireModulePage("lab");
  await requirePermission("lab.catalog");
  const [tests, departments] = await Promise.all([listTests(), listDepartments(true)]);
  const order = new Map(departments.map((d, i) => [d.id, i]));
  const rows = tests
    .map((t) => ({
      id: t.id,
      name: t.name,
      shortCode: t.shortCode,
      departmentId: t.departmentId,
      departmentName: t.departmentName,
      sampleTypeName: t.sampleTypeName,
      result: t.resultType === "multi" ? `${t.parameters.length} values` : (RESULT_LABEL[t.resultType] ?? t.resultType),
      ratePaisa: t.ratePaisa,
      active: t.active,
      billable: t.billable,
    }))
    .sort(
      (a, b) =>
        (order.get(a.departmentId ?? "") ?? 999) - (order.get(b.departmentId ?? "") ?? 999) || a.name.localeCompare(b.name),
    );
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <TestList tests={rows} departments={departments.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name }))} />
    </main>
  );
}
