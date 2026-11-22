import { can, requirePermission } from "@/lib/session";
import { getModules, requireAnyModulePage } from "@/lib/modules";
import { listDoctors } from "@/lib/repos/doctors";
import { appointmentsOn, countsByDoctorOn } from "@/lib/repos/appointments";
import { listPrebookingsOn, prebookingsForAppointments } from "@/lib/repos/prebookings";
import { listServices } from "@/lib/repos/services";
import { adToIso, toAD, bsFromDbText, bsToDbText, today, formatBS } from "@/lib/bs";
import { displayAge } from "@/lib/age";
import { PageShell } from "@/components/app/page-shell";
import { DayStepper } from "@/components/clinic/day-stepper";
import { DoctorCard } from "@/components/clinic/doctor-card";
import { PrebookingBoard } from "@/components/clinic/prebooking-board";

export const metadata = { title: "Pre-Booking" };

/**
 * Pre-Booking: the day's booked tests and doctors' consultations, in one
 * place (owner, 2083-08-06). A booking is issued as a bill when they arrive;
 * an advance can be taken on either kind.
 */
export default async function PrebookingPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const user = await requirePermission(["visits.view", "appointments.manage"]);
  await requireAnyModulePage(["clinic", "lab"]);
  const modules = await getModules();

  const sp = await searchParams;
  const onBs = sp.on && /^\d{4}-\d{2}-\d{2}$/.test(sp.on) ? sp.on : bsToDbText(today());
  const onAd = adToIso(toAD(bsFromDbText(onBs)));

  const [bookings, appointments, doctors, counts, services] = await Promise.all([
    listPrebookingsOn(onAd),
    modules.clinic ? appointmentsOn(onAd) : Promise.resolve([]),
    modules.clinic ? listDoctors() : Promise.resolve([]),
    modules.clinic ? countsByDoctorOn(onAd) : Promise.resolve(new Map()),
    listServices(),
  ]);
  const byAppointment = await prebookingsForAppointments(appointments.map((a) => a.id));
  const todayAd = adToIso(new Date());

  return (
    <PageShell title="Pre-Booking">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DayStepper valueBs={onBs} basePath="/prebooking" />
          <span className="text-[14px] text-sage-500">{formatBS(bsFromDbText(onBs), { form: "long", monthScript: "en" })}</span>
        </div>

        <PrebookingBoard
          dateBs={onBs}
          canBook={can(user, "appointments.manage")}
          canBill={can(user, "counter.use")}
          showConsultations={modules.clinic}
          tests={bookings
            .filter((b) => b.kind === "tests")
            .map((b) => ({
              id: b.id,
              timeHhmm: b.timeHhmm,
              name: b.name,
              phone: b.phone,
              patientNo: b.patientNo,
              patient: b.patient
                ? {
                    id: b.patient.id,
                    patientNo: b.patient.patientNo,
                    name: b.patient.name,
                    sex: b.patient.sex,
                    phone: b.patient.phone,
                    ageShort: displayAge(b.patient.age, todayAd).short,
                  }
                : null,
              note: b.note,
              status: b.status,
              billId: b.billId,
              billNo: b.billNo,
              cancelReason: b.cancelReason,
              items: b.items,
              inHandPaisa: b.inHandPaisa,
              receipts: b.moves
                .filter((m) => m.kind === "received")
                .map((m) => ({ id: m.id, label: m.receiptLabel, amountPaisa: m.amountPaisa, method: m.method })),
              dateBs: b.dateBs,
            }))}
          consultations={appointments.map((a) => {
            const pb = byAppointment.get(a.id);
            return {
              appointmentId: a.id,
              prebookingId: pb?.id ?? null,
              timeHhmm: a.timeHhmm,
              doctorId: a.doctorId,
              doctorName: a.doctorName,
              name: a.patientName,
              phone: a.patientPhone,
              patientNo: a.patientNo,
              reason: a.reason,
              status: a.status,
              billId: pb?.billId ?? null,
              billNo: pb?.billNo ?? null,
              inHandPaisa: pb?.inHandPaisa ?? 0,
              receipts: (pb?.moves ?? [])
                .filter((m) => m.kind === "received")
                .map((m) => ({ id: m.id, label: m.receiptLabel, amountPaisa: m.amountPaisa, method: m.method })),
            };
          })}
          services={services.map((s) => ({ id: s.id, name: s.name, groupName: s.groupName, ratePaisa: s.ratePaisa }))}
        />

        {modules.clinic && doctors.length > 0 && (
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-sage-900">Book a consultation</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {doctors.map((d) => (
                <li key={d.id}>
                  <DoctorCard
                    doctor={{ id: d.id, name: d.name, qualification: d.qualification, specialty: d.specialty, hasLogin: d.userId != null }}
                    dateBs={onBs}
                    booked={counts.get(d.id)?.booked ?? 0}
                    total={counts.get(d.id)?.total ?? 0}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageShell>
  );
}
