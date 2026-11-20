"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { saveDepartmentAction, saveSampleTypeAction } from "@/app/(app)/lab/actions";
import { strings } from "@/lib/strings";
import type { LabDepartment, LabSampleType } from "@/lib/repos/lab-catalog";

/** Settings → Laboratory: report sections and the sample types drawn. */
export function LabMasters({ departments, sampleTypes }: { departments: LabDepartment[]; sampleTypes: LabSampleType[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [dept, setDept] = useState<(Omit<LabDepartment, "id" | "sortOrder"> & { id?: string; sortOrder: string }) | null>(null);
  const [st, setSt] = useState<(Omit<LabSampleType, "id" | "sortOrder"> & { id?: string; sortOrder: string }) | null>(null);

  function done(res: { ok: boolean; userMessage?: string }, close: () => void) {
    if (res.ok) {
      toast.success(strings.saved);
      close();
      router.refresh();
    } else toast.error(res.userMessage ?? strings.somethingWentWrong);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-sage-900">Report sections</h2>
            <p className="text-[13px] text-sage-500">Haematology, Biochemistry… Tests print under their section, in this order.</p>
          </div>
          <Button variant="secondary" onClick={() => setDept({ name: "", sortOrder: String(departments.length), showUnit: true, showRange: true, active: true })}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Section</TH>
              <TH>Prints</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {departments.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">
                  {d.name} {!d.active && <Badge tone="danger">Off</Badge>}
                </TD>
                <TD className="text-[13px] text-sage-600">
                  {[d.showUnit ? "unit" : null, d.showRange ? "range" : null].filter(Boolean).join(" and ") || "result only"}
                </TD>
                <TD className="text-right">
                  <Button variant="ghost" onClick={() => setDept({ ...d, sortOrder: String(d.sortOrder) })}>
                    {strings.edit}
                  </Button>
                </TD>
              </TR>
            ))}
            {departments.length === 0 && (
              <TR>
                <TD className="text-sage-500">None yet.</TD>
              </TR>
            )}
          </tbody>
        </Table>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-sage-900">Sample types</h2>
            <p className="text-[13px] text-sage-500">What is drawn. One tube per type per bill.</p>
          </div>
          <Button variant="secondary" onClick={() => setSt({ name: "", colorHex: "", sortOrder: String(sampleTypes.length), active: true })}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Sample</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {sampleTypes.map((s) => (
              <TR key={s.id}>
                <TD className="font-medium">
                  <span className="mr-2 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ background: s.colorHex || "transparent" }} />
                  {s.name} {!s.active && <Badge tone="danger">Off</Badge>}
                </TD>
                <TD className="text-right">
                  <Button variant="ghost" onClick={() => setSt({ ...s, sortOrder: String(s.sortOrder) })}>
                    {strings.edit}
                  </Button>
                </TD>
              </TR>
            ))}
            {sampleTypes.length === 0 && (
              <TR>
                <TD className="text-sage-500">None yet.</TD>
              </TR>
            )}
          </tbody>
        </Table>
      </section>

      <Dialog
        open={dept !== null}
        onClose={() => setDept(null)}
        title={dept?.id ? "Edit section" : "Add section"}
        footer={
          <Button
            disabled={pending}
            onClick={() =>
              dept &&
              start(async () =>
                done(await saveDepartmentAction({ ...dept, sortOrder: Math.trunc(Number(dept.sortOrder) || 0) }), () => setDept(null)),
              )
            }
          >
            {strings.save}
          </Button>
        }
      >
        {dept && (
          <div className="flex flex-col gap-3">
            <Field label="Name">
              <Input value={dept.name} onChange={(e) => setDept({ ...dept, name: e.target.value })} />
            </Field>
            <Field label="Order">
              <Input value={dept.sortOrder} inputMode="numeric" onChange={(e) => setDept({ ...dept, sortOrder: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={dept.showUnit} onChange={(e) => setDept({ ...dept, showUnit: e.target.checked })} /> Print the
              unit column
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={dept.showRange} onChange={(e) => setDept({ ...dept, showRange: e.target.checked })} /> Print
              the reference range column
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={dept.active} onChange={(e) => setDept({ ...dept, active: e.target.checked })} /> In use
            </label>
          </div>
        )}
      </Dialog>

      <Dialog
        open={st !== null}
        onClose={() => setSt(null)}
        title={st?.id ? "Edit sample type" : "Add sample type"}
        footer={
          <Button
            disabled={pending}
            onClick={() =>
              st &&
              start(async () => done(await saveSampleTypeAction({ ...st, sortOrder: Math.trunc(Number(st.sortOrder) || 0) }), () => setSt(null)))
            }
          >
            {strings.save}
          </Button>
        }
      >
        {st && (
          <div className="flex flex-col gap-3">
            <Field label="Name" hint="For example: Blood (EDTA), Serum, Urine">
              <Input value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} />
            </Field>
            <Field label="Tube colour">
              <div className="flex items-center gap-2">
                <input type="color" value={st.colorHex || "#ffffff"} onChange={(e) => setSt({ ...st, colorHex: e.target.value })} />
                <button type="button" className="text-[13px] text-sage-600 hover:underline" onClick={() => setSt({ ...st, colorHex: "" })}>
                  No colour
                </button>
              </div>
            </Field>
            <Field label="Order">
              <Input value={st.sortOrder} inputMode="numeric" onChange={(e) => setSt({ ...st, sortOrder: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={st.active} onChange={(e) => setSt({ ...st, active: e.target.checked })} /> In use
            </label>
          </div>
        )}
      </Dialog>
    </div>
  );
}
