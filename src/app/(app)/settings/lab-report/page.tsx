import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { getLabSettings, listSignatories } from "@/lib/repos/lab-report";
import { ReportSettings } from "@/components/lab/report-settings";

export const metadata = { title: "Lab report" };

export default async function LabReportSettingsPage() {
  await requireModulePage("lab");
  await requirePermission("lab.catalog");
  const [settings, signatories] = await Promise.all([getLabSettings(), listSignatories()]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <ReportSettings initial={settings} signatories={signatories} />
    </main>
  );
}
