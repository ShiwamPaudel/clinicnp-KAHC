"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse } from "lucide-react";
import { updateVisitAction } from "@/app/(app)/patients/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { bmiOf, draftOf, payloadOf, type VitalsDraft, type VitalsValues } from "@/lib/vitals";
import { cn } from "@/lib/cn";

function Vital({
  label,
  suffix,
  value,
  onChange,
  disabled,
  wide,
  placeholder,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  wide?: boolean;
  placeholder?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1", wide ? "w-[104px]" : "w-[88px]")}>
      <span className="text-[12px] text-sage-500">{label}</span>
      <span className="relative">
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          inputMode={label === "BP" ? "text" : "decimal"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-[8px] border border-line bg-cream-50 pl-2.5 pr-8 text-right font-mono text-[14px] outline-none focus:border-sage-700 disabled:opacity-50"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-sage-500">
          {suffix}
        </span>
      </span>
    </label>
  );
}

/**
 * The vitals row: all optional, blank by default, never judged (Rules §2.6).
 * BMI is worked out as the boxes are filled, for a patient 18 or older.
 */
export function VitalsFields({
  value,
  onChange,
  ageYears,
  lastHeightCm = null,
  disabled,
}: {
  value: VitalsDraft;
  onChange: (v: VitalsDraft) => void;
  ageYears: number | null;
  /** the patient's last recorded height: an adult's BMI uses it when none is typed */
  lastHeightCm?: number | null;
  disabled?: boolean;
}) {
  const set = (k: keyof VitalsDraft) => (x: string) => onChange({ ...value, [k]: x });
  const p = payloadOf(value);
  const bmi = bmiOf(p.weightKg, p.heightCm ?? lastHeightCm, ageYears);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Vital label="BP" suffix="" value={value.bp} disabled={disabled} onChange={set("bp")} wide />
      <Vital label="Pulse" suffix="/min" value={value.pulse} disabled={disabled} onChange={set("pulse")} />
      <Vital label="Temp" suffix="°C" value={value.tempC} disabled={disabled} onChange={set("tempC")} />
      <Vital label="Weight" suffix="kg" value={value.weightKg} disabled={disabled} onChange={set("weightKg")} />
      <Vital
        label="Height"
        suffix="cm"
        value={value.heightCm}
        disabled={disabled}
        onChange={set("heightCm")}
        placeholder={lastHeightCm != null ? String(lastHeightCm) : undefined}
      />
      <Vital label="SpO₂" suffix="%" value={value.spo2} disabled={disabled} onChange={set("spo2")} />
      <div className="flex w-[88px] flex-col gap-1">
        <span className="text-[12px] text-sage-500">BMI</span>
        <span className="flex h-10 items-center justify-end rounded-[8px] bg-cream-100 px-2.5 font-mono text-[14px] text-sage-900">
          {bmi ?? "-"}
        </span>
      </div>
    </div>
  );
}

/** "Vitals" on a row of Today: record or correct them without opening the visit. */
export function VitalsButton({
  visitId,
  patientId,
  patientName,
  initial,
  ageYears,
  lastHeightCm = null,
}: {
  visitId: string;
  patientId: string;
  patientName: string;
  initial: VitalsValues;
  ageYears: number | null;
  lastHeightCm?: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VitalsDraft>(() => draftOf(initial));
  const [pending, start] = useTransition();
  const recorded = Object.values(draftOf(initial)).some((x) => x.trim() !== "");

  function save() {
    start(async () => {
      const res = await updateVisitAction({ id: visitId, patientId, vitals: payloadOf(draft) });
      if (!res.ok) {
        toast.error(res.userMessage ?? "Something went wrong. Please try again.");
        return;
      }
      toast.success("Vitals saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        className="h-8 px-3 text-[13px]"
        onClick={() => {
          setDraft(draftOf(initial));
          setOpen(true);
        }}
      >
        <HeartPulse className={cn("h-4 w-4", recorded ? "text-clinic-500" : "text-sage-500")} />
        {recorded ? "Vitals" : "Add vitals"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Vitals: ${patientName}`}
        className="max-w-[820px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save vitals"}
            </Button>
          </>
        }
      >
        <VitalsFields value={draft} onChange={setDraft} ageYears={ageYears} lastHeightCm={lastHeightCm} />
      </Dialog>
    </>
  );
}
