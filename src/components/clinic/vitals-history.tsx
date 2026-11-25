import Link from "next/link";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { bsTextNumeric, stampNumeric } from "@/lib/print-format";
import type { VitalsRow } from "@/lib/vitals";

/**
 * A patient's vitals by date, newest first, each value with its difference
 * from the last time it was recorded. Plain numbers in plain ink: nothing is
 * marked better or worse (Rules §2.6).
 */
export function VitalsHistory({ rows }: { rows: VitalsRow[] }) {
  if (rows.length === 0) {
    return <p className="text-[14px] text-sage-500">No vitals recorded yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-cream-50">
      <Table>
        <THead>
          <TR>
            <TH>Date / Time</TH>
            <TH numeric>BP</TH>
            <TH numeric>Pulse</TH>
            <TH numeric>Temp</TH>
            <TH numeric>Weight</TH>
            <TH numeric>Height</TH>
            <TH numeric>BMI</TH>
            <TH numeric>SpO₂</TH>
          </TR>
        </THead>
        <tbody>
          {rows.map((r) => (
            <TR key={r.visitId}>
              <TD>
                <Link href={`/visits/${r.visitId}`} className="font-mono text-[13px] text-clinic-700 hover:underline">
                  {r.at ? stampNumeric(r.at) : bsTextNumeric(r.dateBs)}
                </Link>
              </TD>
              <Cell value={r.bp || null} change={r.change.bp} />
              <Cell value={r.pulse} unit="/min" change={r.change.pulse} />
              <Cell value={r.tempC} unit="°C" change={r.change.tempC} />
              <Cell value={r.weightKg} unit="kg" change={r.change.weightKg} />
              <Cell value={r.heightCm} unit="cm" change={r.change.heightCm} />
              <Cell value={r.bmi} change={r.change.bmi} />
              <Cell value={r.spo2} unit="%" change={r.change.spo2} />
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function Cell({ value, unit = "", change }: { value: number | string | null; unit?: string; change: string }) {
  return (
    <TD numeric>
      {value == null ? (
        <span className="text-sage-500">-</span>
      ) : (
        <span className="flex flex-col items-end leading-tight">
          <span className="font-mono text-sage-900">
            {value}
            {unit && <span className="ml-0.5 text-[11px] text-sage-500">{unit}</span>}
          </span>
          {change && <span className="font-mono text-[11px] text-sage-500">{change}</span>}
        </span>
      )}
    </TD>
  );
}
