import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { adToIso } from "@/lib/bs";
import { PageShell } from "@/components/app/page-shell";
import { PatientForm, EMPTY_PATIENT } from "@/components/clinic/patient-form";

export const metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  await requirePermission("patients.manage");
  await requireModulePage("clinic");

  return (
    <PageShell title="Register patient">
      <PatientForm
        mode="create"
        initial={EMPTY_PATIENT}
        todayAd={adToIso(new Date())}
      />
    </PageShell>
  );
}
