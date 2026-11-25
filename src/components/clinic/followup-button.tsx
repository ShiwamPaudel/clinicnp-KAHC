"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { bookFollowupAction } from "@/app/(app)/prebooking/actions";
import { useToast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePickerBS } from "@/components/ui/date-picker-bs";
import { strings } from "@/lib/strings";

/**
 * Next follow-up, from the patient's page (owner, 2083-08-09). It shows on
 * Pre-Booking: with a doctor as that doctor's consultation, without one as a
 * booking with no tests yet.
 */
export function FollowupButton({
  patientId,
  todayBs,
  doctors,
}: {
  patientId: string;
  todayBs: string;
  /** doctors seeing patients; empty when the clinic module is off */
  doctors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dateBs, setDateBs] = useState(todayBs);
  const [timeHhmm, setTimeHhmm] = useState("10:00");
  const [doctorId, setDoctorId] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await bookFollowupAction({ patientId, dateBs, timeHhmm, doctorId: doctorId || null, note });
      if (!res.ok) {
        toast.error(res.userMessage ?? strings.somethingWentWrong);
        return;
      }
      toast.success("Follow-up booked");
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <CalendarClock className="h-4 w-4" />
        Follow-up
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Book follow-up"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {strings.cancel}
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Book follow-up"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">
              <DatePickerBS value={dateBs} onChange={setDateBs} />
            </Field>
            <Field label="Time">
              <Input type="time" value={timeHhmm} onChange={(e) => setTimeHhmm(e.target.value)} />
            </Field>
          </div>
          {doctors.length > 0 && (
            <Field label="Doctor">
              <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">No doctor</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Note">
            <Input value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
