"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, FlaskConical, Stethoscope, Wallet, Receipt, X, Printer, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { DatePickerBS } from "@/components/ui/date-picker-bs";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  closeBookingAction,
  consultationBookingAction,
  saveTestBookingAction,
  takeAdvanceAction,
} from "@/app/(app)/prebooking/actions";
import { formatPaisa, toPaisa } from "@/lib/money";
import { formatTime, APPOINTMENT_STATUS_LABEL, type AppointmentStatus } from "@/lib/appointment-types";
import { PREBOOKING_STATUS_LABEL, type PrebookingStatus } from "@/lib/prebooking-format";
import { strings } from "@/lib/strings";
import { PatientPicker, type FoundPatient, type DraftPatient } from "@/components/clinic/patient-picker";
import { cn } from "@/lib/cn";

interface ReceiptRow {
  id: string;
  label: string;
  amountPaisa: number;
  method: string;
}

export interface TestRow {
  id: string;
  timeHhmm: string;
  name: string;
  phone: string;
  patientNo: number | null;
  /** the registered patient; null only on bookings made before every booking needed one */
  patient: FoundPatient | null;
  note: string;
  status: PrebookingStatus;
  billId: string | null;
  billNo: number | null;
  cancelReason: string;
  items: { serviceId: string; name: string }[];
  inHandPaisa: number;
  receipts: ReceiptRow[];
  dateBs: string;
}

export interface ConsultationRow {
  appointmentId: string;
  prebookingId: string | null;
  timeHhmm: string;
  doctorId: string;
  doctorName: string;
  name: string;
  phone: string;
  patientNo: number | null;
  reason: string;
  status: AppointmentStatus;
  billId: string | null;
  billNo: number | null;
  inHandPaisa: number;
  receipts: ReceiptRow[];
}

interface ServiceOption {
  id: string;
  name: string;
  groupName: string;
  ratePaisa: number;
}

type Target = {
  prebookingId?: string;
  appointmentId?: string;
  name: string;
  inHandPaisa: number;
  /** how the last advance came in: it goes back the same way unless changed */
  lastMethod?: "cash" | "qr";
};

const lastMethod = (receipts: ReceiptRow[]): "cash" | "qr" => (receipts.at(-1)?.method === "qr" ? "qr" : "cash");

const TEST_TONE: Record<PrebookingStatus, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  booked: "info",
  billed: "ok",
  cancelled: "danger",
  missed: "neutral",
};

const billNoLabel = (n: number | null) => (n == null ? "Bill" : `Bill ${String(n).padStart(6, "0")}`);

function openReceipt(id: string) {
  window.open(`/print/advance/${id}`, "_blank", "noopener");
}

export function PrebookingBoard({
  dateBs,
  canBook,
  canBill,
  showConsultations,
  tests,
  consultations,
  services,
}: {
  dateBs: string;
  canBook: boolean;
  canBill: boolean;
  showConsultations: boolean;
  tests: TestRow[];
  consultations: ConsultationRow[];
  services: ServiceOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [booking, setBooking] = useState<null | BookingForm>(null);
  const [advanceFor, setAdvanceFor] = useState<Target | null>(null);
  const [closeFor, setCloseFor] = useState<Target | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const newBooking = () => setBooking({ name: "", phone: "", patient: null, dateBs, timeHhmm: "08:00", note: "", serviceIds: [] });

  async function issueConsultation(c: ConsultationRow) {
    setOpening(c.appointmentId);
    const res = c.prebookingId
      ? { ok: true, id: c.prebookingId }
      : await consultationBookingAction({ appointmentId: c.appointmentId });
    setOpening(null);
    if (!res.ok || !res.id) {
      toast.error(("userMessage" in res && res.userMessage) || strings.somethingWentWrong);
      return;
    }
    router.push(`/billing?prebooking=${res.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-sage-900">
            <FlaskConical className="h-4 w-4 text-sage-600" />
            Tests and services booked
          </h2>
          {canBook && (
            <Button onClick={newBooking}>
              <CalendarPlus className="h-4 w-4" />
              Book tests
            </Button>
          )}
        </div>
        {tests.length === 0 ? (
          <EmptyState icon={FlaskConical} message="Nothing booked for this day." />
        ) : (
          <div className="rounded-[10px] border border-line bg-cream-50">
            <Table>
              <THead>
                <TR>
                  <TH>Time</TH>
                  <TH>Patient</TH>
                  <TH>Booked</TH>
                  <TH numeric>Advance</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <tbody>
                {tests.map((t) => (
                  <TR key={t.id} className={t.status === "cancelled" || t.status === "missed" ? "text-sage-500" : undefined}>
                    <TD className="whitespace-nowrap font-semibold tnum">{formatTime(t.timeHhmm)}</TD>
                    <TD>
                      <div className="font-medium text-sage-900">{t.name}</div>
                      <div className="text-[12px] text-sage-500">{[t.phone, t.patientNo != null ? `P-${String(t.patientNo).padStart(6, "0")}` : ""].filter(Boolean).join(" · ")}</div>
                      {t.note && <div className="text-[12px] text-sage-500">{t.note}</div>}
                    </TD>
                    <TD className="max-w-[320px] text-[13px] text-sage-700">{t.items.map((i) => i.name).join(", ")}</TD>
                    <TD numeric>
                      <Advance inHand={t.inHandPaisa} receipts={t.receipts} />
                    </TD>
                    <TD>
                      <Badge tone={TEST_TONE[t.status]}>{PREBOOKING_STATUS_LABEL[t.status]}</Badge>
                      {t.status === "billed" && t.billId && (
                        <Link href={`/bills/${t.billId}`} className="ml-2 text-[12px] text-sage-600 underline-offset-2 hover:underline">
                          {billNoLabel(t.billNo)}
                        </Link>
                      )}
                      {t.cancelReason && <div className="text-[12px] text-sage-500">{t.cancelReason}</div>}
                    </TD>
                    <TD className="text-right">
                      {t.status === "booked" && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {canBill && (
                            <Link href={`/billing?prebooking=${t.id}`}>
                              <Button className="h-9 px-3 text-[13px]">
                                <Receipt className="h-4 w-4" />
                                Issue bill
                              </Button>
                            </Link>
                          )}
                          {canBook && (
                            <>
                              <Button variant="secondary" className="h-9 px-3 text-[13px]" onClick={() => setAdvanceFor({ prebookingId: t.id, name: t.name, inHandPaisa: t.inHandPaisa })}>
                                <Wallet className="h-4 w-4" />
                                Advance
                              </Button>
                              <Button
                                variant="ghost"
                                className="h-9 px-2"
                                aria-label="Change"
                                onClick={() =>
                                  setBooking({ id: t.id, name: t.name, phone: t.phone, patient: t.patient, dateBs: t.dateBs, timeHhmm: t.timeHhmm, note: t.note, serviceIds: t.items.map((i) => i.serviceId) })
                                }
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" className="h-9 px-2" aria-label="Cancel" onClick={() => setCloseFor({ prebookingId: t.id, name: t.name, inHandPaisa: t.inHandPaisa, lastMethod: lastMethod(t.receipts) })}>
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>

      {showConsultations && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-sage-900">
            <Stethoscope className="h-4 w-4 text-sage-600" />
            Doctors&apos; consultations
          </h2>
          {consultations.length === 0 ? (
            <EmptyState icon={Stethoscope} message="No consultations booked for this day." />
          ) : (
            <div className="rounded-[10px] border border-line bg-cream-50">
              <Table>
                <THead>
                  <TR>
                    <TH>Time</TH>
                    <TH>Patient</TH>
                    <TH>Doctor</TH>
                    <TH numeric>Advance</TH>
                    <TH>Status</TH>
                    <TH />
                  </TR>
                </THead>
                <tbody>
                  {consultations.map((c) => {
                    const open = c.status === "booked" || c.status === "arrived";
                    const billed = c.billId != null;
                    return (
                      <TR key={c.appointmentId} className={open ? undefined : "text-sage-500"}>
                        <TD className="whitespace-nowrap font-semibold tnum">{formatTime(c.timeHhmm)}</TD>
                        <TD>
                          <div className="font-medium text-sage-900">{c.name}</div>
                          <div className="text-[12px] text-sage-500">{[c.phone, c.patientNo != null ? `P-${String(c.patientNo).padStart(6, "0")}` : ""].filter(Boolean).join(" · ")}</div>
                        </TD>
                        <TD className="text-[13px]">
                          <Link href={`/doctors/${c.doctorId}?on=${dateBs}`} className="text-sage-900 underline-offset-2 hover:underline">
                            {c.doctorName}
                          </Link>
                          {c.reason && <div className="text-[12px] text-sage-500">{c.reason}</div>}
                        </TD>
                        <TD numeric>
                          <Advance inHand={c.inHandPaisa} receipts={c.receipts} />
                        </TD>
                        <TD>
                          <Badge tone={billed ? "ok" : open ? "info" : "neutral"}>{billed ? "Billed" : APPOINTMENT_STATUS_LABEL[c.status]}</Badge>
                          {billed && (
                            <Link href={`/bills/${c.billId}`} className="ml-2 text-[12px] text-sage-600 underline-offset-2 hover:underline">
                              {billNoLabel(c.billNo)}
                            </Link>
                          )}
                        </TD>
                        <TD className="text-right">
                          {open && !billed && (
                            <div className="flex flex-wrap justify-end gap-1">
                              {canBill && (
                                <Button className="h-9 px-3 text-[13px]" disabled={opening === c.appointmentId} onClick={() => issueConsultation(c)}>
                                  <Receipt className="h-4 w-4" />
                                  Issue bill
                                </Button>
                              )}
                              {canBook && (
                                <>
                                  <Button
                                    variant="secondary"
                                    className="h-9 px-3 text-[13px]"
                                    onClick={() => setAdvanceFor({ prebookingId: c.prebookingId ?? undefined, appointmentId: c.appointmentId, name: c.name, inHandPaisa: c.inHandPaisa })}
                                  >
                                    <Wallet className="h-4 w-4" />
                                    Advance
                                  </Button>
                                  {c.inHandPaisa > 0 && (
                                    <Button
                                      variant="ghost"
                                      className="h-9 px-2"
                                      aria-label="Cancel"
                                      onClick={() => setCloseFor({ prebookingId: c.prebookingId ?? undefined, appointmentId: c.appointmentId, name: c.name, inHandPaisa: c.inHandPaisa, lastMethod: lastMethod(c.receipts) })}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </section>
      )}

      {booking && <BookingDialog key={booking.id ?? "new"} initial={booking} services={services} onClose={() => setBooking(null)} onSaved={() => { setBooking(null); router.refresh(); }} />}
      {advanceFor && <AdvanceDialog key={advanceFor.prebookingId ?? advanceFor.appointmentId} target={advanceFor} onClose={() => setAdvanceFor(null)} onSaved={() => { setAdvanceFor(null); router.refresh(); }} />}
      {closeFor && <CloseDialog key={closeFor.prebookingId ?? closeFor.appointmentId} target={closeFor} onClose={() => setCloseFor(null)} onSaved={() => { setCloseFor(null); router.refresh(); }} />}
    </div>
  );
}

function Advance({ inHand, receipts }: { inHand: number; receipts: ReceiptRow[] }) {
  if (receipts.length === 0) return <span className="text-sage-300">-</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-semibold tnum text-sage-900">{formatPaisa(inHand)}</span>
      {receipts.map((r) => (
        <button key={r.id} type="button" onClick={() => openReceipt(r.id)} className="flex items-center gap-1 text-[12px] text-sage-600 hover:text-sage-900">
          <Printer className="h-3 w-3" />
          {r.label} · {formatPaisa(r.amountPaisa)}
        </button>
      ))}
    </div>
  );
}

interface BookingForm {
  id?: string;
  /** as the booking was saved: shown when changing an old booking that has no patient yet */
  name: string;
  phone: string;
  patient: FoundPatient | null;
  dateBs: string;
  timeHhmm: string;
  note: string;
  serviceIds: string[];
}

function BookingDialog({
  initial,
  services,
  onClose,
  onSaved,
}: {
  initial: BookingForm;
  services: ServiceOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [chosen, setChosen] = useState<FoundPatient | null>(initial.patient);
  const [draft, setDraft] = useState<DraftPatient | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return services.filter((s) => !f.serviceIds.includes(s.id) && s.name.toLowerCase().includes(t)).slice(0, 8);
  }, [q, services, f.serviceIds]);
  const total = f.serviceIds.reduce((s, id) => s + (byId.get(id)?.ratePaisa ?? 0), 0);

  async function save() {
    setBusy(true);
    const res = await saveTestBookingAction(
      {
        id: f.id,
        patientId: chosen ? chosen.id : draft ? "new" : "",
        dateBs: f.dateBs,
        timeHhmm: f.timeHhmm,
        note: f.note,
        serviceIds: f.serviceIds,
      },
      chosen ? undefined : (draft ?? undefined),
    );
    setBusy(false);
    if (!res.ok) {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
      return;
    }
    toast.success(f.id ? strings.saved : "Booked");
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={f.id ? `Change booking: ${initial.name}` : "Book tests"}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {strings.cancel}
          </Button>
          <Button onClick={save} disabled={busy || (!chosen && !draft?.name.trim())}>
            {busy ? "Saving…" : "Save booking"}
          </Button>
        </>
      }
    >
      <div className="-mr-2 flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-2">
        {f.id && !initial.patient && !chosen && !draft && (
          <p className="rounded-[8px] bg-cream-200 px-3 py-2 text-[13px] text-sage-700">
            Booked as <span className="font-semibold">{initial.name}</span>
            {initial.phone ? ` · ${initial.phone}` : ""}. Find them or register them.
          </p>
        )}
        <PatientPicker
          chosen={chosen}
          draft={draft}
          onChoose={(p) => {
            setChosen(p);
            if (p) setDraft(null);
          }}
          onDraftChange={(d) => {
            setDraft(d);
            if (d) setChosen(null);
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <DatePickerBS value={f.dateBs} onChange={(v) => setF({ ...f, dateBs: v })} />
          </Field>
          <Field label="Time">
            <Input type="time" value={f.timeHhmm} onChange={(e) => setF({ ...f, timeHhmm: e.target.value })} />
          </Field>
        </div>
        <Field label="Tests or services">
          <div className="relative">
            <Input
              value={q}
              placeholder="Type a test, profile, package or service"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  e.preventDefault();
                  setF({ ...f, serviceIds: [...f.serviceIds, matches[0].id] });
                  setQ("");
                }
              }}
            />
            {matches.length > 0 && (
              <ul className="mt-1 w-full overflow-hidden rounded-[8px] border border-line bg-cream-50">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px] hover:bg-cream-200"
                      onClick={() => {
                        setF({ ...f, serviceIds: [...f.serviceIds, m.id] });
                        setQ("");
                      }}
                    >
                      <span>
                        {m.name} <span className="text-[12px] text-sage-500">{m.groupName}</span>
                      </span>
                      <span className="text-[13px] tnum text-sage-600">{formatPaisa(m.ratePaisa)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>
        {f.serviceIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {f.serviceIds.map((id) => (
              <span key={id} className="flex items-center gap-1 rounded-[999px] bg-sage-150 py-1 pl-3 pr-1 text-[13px] text-sage-900">
                {byId.get(id)?.name ?? "-"}
                <button
                  type="button"
                  aria-label="Remove"
                  className="rounded-full p-0.5 hover:bg-sage-300"
                  onClick={() => setF({ ...f, serviceIds: f.serviceIds.filter((x) => x !== id) })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <span className="ml-auto text-[13px] text-sage-600 tnum">Total {formatPaisa(total)}</span>
          </div>
        )}
        <Field label="Note">
          <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Fasting, referred by…" />
        </Field>
      </div>
    </Dialog>
  );
}

function MethodToggle({ value, onChange, label }: { value: "cash" | "qr"; onChange: (v: "cash" | "qr") => void; label: string }) {
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {(["cash", "qr"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
          className={cn(
            "h-10 flex-1 rounded-[8px] border px-4 text-[14px] font-medium",
            value === m ? "border-sage-700 bg-sage-700 text-cream-50" : "border-line bg-cream-50 text-sage-900 hover:bg-cream-200",
          )}
        >
          {m === "cash" ? "Cash" : "QR / wallet"}
        </button>
      ))}
    </div>
  );
}

function AdvanceDialog({ target, onClose, onSaved }: { target: Target; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "qr">("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const amt = toPaisa(Number(amount) || 0);
    if (amt <= 0) return toast.error("Enter how much they paid.");
    setBusy(true);
    const res = await takeAdvanceAction({ prebookingId: target.prebookingId, appointmentId: target.appointmentId, amountPaisa: amt, method, note });
    setBusy(false);
    if (!res.ok) return toast.error(res.userMessage ?? strings.somethingWentWrong);
    toast.success(`Advance taken · ${res.receiptLabel}`);
    if (res.receiptId) openReceipt(res.receiptId);
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Advance: ${target.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {strings.cancel}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Take advance & print"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {target.inHandPaisa > 0 && <p className="text-[14px] text-sage-700">Already paid: {formatPaisa(target.inHandPaisa)}</p>}
        <Field label="Amount (रू)">
          <Input numeric inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <MethodToggle value={method} onChange={setMethod} label="How it was paid" />
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function CloseDialog({ target, onClose, onSaved }: { target: Target; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<"cancelled" | "missed">("cancelled");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"cash" | "qr">(target.lastMethod ?? "cash");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await closeBookingAction({ prebookingId: target.prebookingId, appointmentId: target.appointmentId, status, reason, refundMethod: method });
    setBusy(false);
    if (!res.ok) return toast.error(res.userMessage ?? strings.somethingWentWrong);
    toast.success(res.refundedPaisa ? `Closed · ${formatPaisa(res.refundedPaisa)} handed back` : "Closed");
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Close booking: ${target.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {strings.cancel}
          </Button>
          <Button variant="destructive" onClick={save} disabled={busy}>
            {busy ? "Saving…" : target.inHandPaisa > 0 ? `Close & hand back ${formatPaisa(target.inHandPaisa)}` : "Close booking"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1" role="group" aria-label="Why it is closed">
          {(
            [
              ["cancelled", "Cancelled"],
              ["missed", "Did not come"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={status === k}
              onClick={() => setStatus(k)}
              className={cn(
                "h-10 flex-1 rounded-[8px] border px-4 text-[14px] font-medium",
                status === k ? "border-sage-700 bg-sage-700 text-cream-50" : "border-line bg-cream-50 text-sage-900 hover:bg-cream-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label={status === "cancelled" ? "Reason" : "Note"}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {target.inHandPaisa > 0 && (
          <Field label={`Hand back ${formatPaisa(target.inHandPaisa)} by`}>
            <MethodToggle value={method} onChange={setMethod} label="How it is handed back" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
