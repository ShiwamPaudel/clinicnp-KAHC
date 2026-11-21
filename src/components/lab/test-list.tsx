"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Beaker, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { formatPaisa } from "@/lib/money";
import { cn } from "@/lib/cn";

export interface TestRow {
  id: string;
  name: string;
  shortCode: string;
  departmentId: string | null;
  departmentName: string;
  sampleTypeName: string;
  result: string;
  ratePaisa: number;
  active: boolean;
  billable: boolean;
}

/** Lab → Tests: find a test, see what is still missing a price, open one. */
export function TestList({ tests, departments }: { tests: TestRow[]; departments: { id: string; name: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);

  const unpriced = tests.filter((t) => t.active && t.billable && t.ratePaisa === 0).length;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tests.filter(
      (t) =>
        (!term || t.name.toLowerCase().includes(term) || t.shortCode.toLowerCase().includes(term)) &&
        (!dept || t.departmentId === dept) &&
        (!onlyUnpriced || (t.billable && t.ratePaisa === 0)),
    );
  }, [tests, q, dept, onlyUnpriced]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sage-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a test" className="pl-9" />
        </div>
        <div className="w-52">
        <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        </div>
        {unpriced > 0 && (
          <button
            type="button"
            onClick={() => setOnlyUnpriced((v) => !v)}
            className={cn(
              "h-10 rounded-[8px] border px-3 text-[13px] font-medium",
              onlyUnpriced ? "border-warn-600 bg-warn-100 text-warn-600" : "border-line bg-cream-50 text-sage-700 hover:bg-cream-200",
            )}
          >
            No price yet · {unpriced}
          </button>
        )}
        <span className="ml-auto text-[13px] text-sage-500">
          {shown.length} of {tests.length}
        </span>
        <Link href="/lab/tests/new">
          <Button>
            <Plus className="h-4 w-4" />
            Add test
          </Button>
        </Link>
      </div>

      {tests.length === 0 ? (
        <EmptyState icon={Beaker} message="No tests yet." />
      ) : shown.length === 0 ? (
        <EmptyState icon={Search} message="No test matches." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Test</TH>
              <TH>Department</TH>
              <TH>Sample</TH>
              <TH>Result</TH>
              <TH numeric>Price</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <tbody>
            {shown.map((t) => (
              <TR
                key={t.id}
                className="cursor-pointer hover:bg-cream-100"
                onClick={() => router.push(`/lab/tests/${t.id}`)}
              >
                <TD>
                  <Link href={`/lab/tests/${t.id}`} className="font-medium text-sage-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {t.name}
                  </Link>
                  {t.shortCode && <div className="text-[12px] text-sage-500">{t.shortCode}</div>}
                </TD>
                <TD className="text-[13px] text-sage-700">{t.departmentName || "—"}</TD>
                <TD className="text-[13px] text-sage-700">{t.sampleTypeName || "—"}</TD>
                <TD className="text-[13px] text-sage-700">{t.result}</TD>
                <TD numeric>
                  {t.ratePaisa > 0 ? formatPaisa(t.ratePaisa) : <span className="text-[13px] text-warn-600">Not set</span>}
                </TD>
                <TD>
                  {!t.active ? (
                    <Badge tone="danger">Off</Badge>
                  ) : t.billable ? (
                    <Badge tone="ok">Billed</Badge>
                  ) : (
                    <Badge tone="neutral">In profiles only</Badge>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
