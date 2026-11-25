import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil, Stethoscope, Receipt, GitMerge, HeartPulse, CalendarClock } from "lucide-react";
import { can, requirePermission } from "@/lib/session";
import { getModules, requireAnyModulePage, PATIENT_MODULES } from "@/lib/modules";
import { listDoctors } from "@/lib/repos/doctors";
import { nextFollowupFor } from "@/lib/repos/prebookings";
import { formatTime } from "@/lib/appointment-types";
import { FollowupButton } from "@/components/clinic/followup-button";
import { getPatient } from "@/lib/repos/patients";
import { visitsForPatient, vitalsForPatient } from "@/lib/repos/visits";
import { vitalsTable } from "@/lib/vitals";
import { VitalsHistory } from "@/components/clinic/vitals-history";
import { attachmentsForPatient } from "@/lib/repos/attachments";
import { listBillsForPatient } from "@/lib/repos/bills";
import { owedByPatient } from "@/lib/repos/dues";
import { formatPaisa } from "@/lib/money";
import { formatDocNo } from "@/lib/invoice-number";
import { adToIso, toBS, adFromIso, formatBS, today, bsToDbText, bsFromDbText } from "@/lib/bs";
import { PageShell } from "@/components/app/page-shell";
import { Button } from "@/components/ui/button";
import {
  PatientHeader,
  VisitTimeline,
} from "@/components/clinic/patient-card";
import { AttachmentGrid } from "@/components/clinic/attachment-grid";
import { StartVisitButton } from "@/components/clinic/start-visit-button";

export default async function PatientCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("patients.view");
  await requireAnyModulePage(PATIENT_MODULES);

  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) notFound();

  const todayAd = adToIso(new Date());
  const canBook = can(user, "appointments.manage");
  const modules = await getModules();
  const [visits, attachments, bills, owed, vitals, followup, doctors] = await Promise.all([
    visitsForPatient(patient.id),
    attachmentsForPatient(patient.id),
    listBillsForPatient(patient.id),
    owedByPatient(patient.id),
    vitalsForPatient(patient.id),
    nextFollowupFor(patient.id, todayAd),
    canBook && modules.clinic ? listDoctors() : Promise.resolve([]),
  ]);

  const sinceBs = formatBS(toBS(adFromIso(patient.createdAt.slice(0, 10))));
  const isAdmin = can(user, "patients.merge");

  return (
    <PageShell
      title={patient.name}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StartVisitButton
            patientId={patient.id}
            todayAd={todayAd}
            todayBs={bsToDbText(today())}
          />
          {canBook && (
            <FollowupButton
              patientId={patient.id}
              todayBs={bsToDbText(today())}
              doctors={doctors.map((d) => ({ id: d.id, name: d.name }))}
            />
          )}
          <Link href={`/billing?patient=${patient.id}`}>
            <Button variant="secondary">
              <Receipt className="h-4 w-4" />
              New bill
            </Button>
          </Link>
          <Link href={`/patients/${patient.id}/edit`}>
            <Button variant="secondary">
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
          {isAdmin && (
            <Link href={`/patients/merge?keep=${patient.id}`}>
              <Button variant="secondary">
                <GitMerge className="h-4 w-4" />
                Merge
              </Button>
            </Link>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <PatientHeader patient={patient} todayAd={todayAd} sinceBs={sinceBs} />

        {followup && (
          <Link
            href={`/prebooking?on=${followup.dateBs}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-cream-50 px-4 py-3 hover:bg-cream-200"
          >
            <span className="flex items-center gap-2 text-[14px] text-sage-900">
              <CalendarClock className="h-4 w-4 text-clinic-500" />
              Next follow-up:{" "}
              <span className="font-semibold">
                {formatBS(bsFromDbText(followup.dateBs), { form: "long", monthScript: "en" })} · {formatTime(followup.timeHhmm)}
              </span>
              {followup.doctorName && <span className="text-sage-600">· {followup.doctorName}</span>}
            </span>
            <span className="text-[13px] font-medium text-sage-600">Pre-Booking →</span>
          </Link>
        )}

        {owed.owedPaisa > 0 && (
          <Link
            href={`/dues?patient=${patient.id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warn-600/30 bg-warn-100 px-4 py-3 text-warn-600 hover:bg-warn-100/70"
          >
            <span className="text-[14px]">
              Owes{" "}
              <span className="font-semibold tnum">{formatPaisa(owed.owedPaisa)}</span>{" "}
              on {owed.billCount} {owed.billCount === 1 ? "bill" : "bills"}
            </span>
            <span className="text-[13px] font-medium">See dues →</span>
          </Link>
        )}

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-sage-900">
            <HeartPulse className="h-4 w-4 text-clinic-500" />
            Vitals
          </h2>
          <VitalsHistory rows={vitalsTable(vitals)} />
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-sage-900">
            <Stethoscope className="h-4 w-4 text-clinic-500" />
            History
          </h2>
          <VisitTimeline
            visits={visits}
            attachments={attachments}
            bills={bills.map((b) => ({
              id: b.id,
              invoiceLabel:
                b.invoiceNo != null
                  ? formatDocNo("SI", b.fiscalLabel, b.invoiceNo)
                  : "Pending",
              dateBs: b.dateBs,
              totalPaisa: b.totalPaisa,
              visitId: b.visitId,
            }))}
          />
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold text-sage-900">Files</h2>
          <AttachmentGrid
            patientId={patient.id}
            files={attachments.map((a) => ({
              id: a.id,
              title: a.title,
              fileName: a.fileName,
              mime: a.mime,
              sizeBytes: a.sizeBytes,
              kind: a.kind,
              createdAt: a.createdAt,
              uploaderName: a.uploaderName,
            }))}
            canDelete={isAdmin}
          />
        </section>
      </div>
    </PageShell>
  );
}
