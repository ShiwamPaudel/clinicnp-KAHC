"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { saveRoleAction, deleteRoleAction } from "@/app/(app)/settings/actions";
import {
  PERMISSION_GROUPS,
  type Permission,
  type PermissionModule,
} from "@/lib/permissions";
import type { ModuleFlags } from "@/lib/app-name";
import { strings } from "@/lib/strings";

export interface RoleRow {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  isSystem: boolean;
  userCount: number;
}

interface FormState {
  id: string | null;
  name: string;
  description: string;
  permissions: Set<Permission>;
}

const SYSTEM_NOTE: Record<string, string> = {
  admin: "Can do everything, including whatever is added later. Can't be changed.",
  doctor: "Signs in to their own booked consultations on their phone, and nothing else. Can't be changed.",
};

/**
 * Settings → Roles. A role is a name and a set of ticks. Ticks for a module
 * that is switched off are hidden but kept, so switching the module back on
 * brings the role back exactly as it was.
 */
export function RolesManager({ roles, modules }: { roles: RoleRow[]; modules: ModuleFlags }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const moduleOn = (m: PermissionModule) => m === null || modules[m];

  function openNew() {
    setForm({ id: null, name: "", description: "", permissions: new Set(["dashboard.view"]) });
  }

  function openEdit(r: RoleRow) {
    setForm({ id: r.id, name: r.name, description: r.description, permissions: new Set(r.permissions) });
  }

  function toggle(p: Permission) {
    setForm((f) => {
      if (!f) return f;
      const next = new Set(f.permissions);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return { ...f, permissions: next };
    });
  }

  function toggleGroup(keys: Permission[], on: boolean) {
    setForm((f) => {
      if (!f) return f;
      const next = new Set(f.permissions);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return { ...f, permissions: next };
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    const res = await saveRoleAction({
      id: form.id ?? undefined,
      name: form.name,
      description: form.description,
      permissions: [...form.permissions],
    });
    setBusy(false);
    if (res.ok) {
      toast.success(strings.saved);
      setForm(null);
      router.refresh();
    } else {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
    }
  }

  async function remove(r: RoleRow) {
    if (!window.confirm(`Remove the role "${r.name}"?`)) return;
    const res = await deleteRoleAction(r.id);
    if (res.ok) {
      toast.success("Role removed");
      router.refresh();
    } else {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-[14px] text-sage-500">
          A role decides what somebody can see and do. Give each person one role
          under Users. Changes apply the next time they open a page.
        </p>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" />
          Add role
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((r) => (
          <div key={r.id} className="rounded-[10px] border border-line bg-cream-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {r.isSystem ? (
                    <Lock className="h-4 w-4 text-sage-500" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 text-sage-500" aria-hidden="true" />
                  )}
                  <h3 className="truncate text-[15px] font-semibold text-sage-900">{r.name}</h3>
                </div>
                <p className="mt-1 text-[13px] text-sage-600">
                  {SYSTEM_NOTE[r.id] ?? (r.description || "No description")}
                </p>
              </div>
              <Badge tone="neutral">
                {r.userCount} {r.userCount === 1 ? "person" : "people"}
              </Badge>
            </div>
            {!r.isSystem && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[12px] text-sage-500">
                  {r.permissions.length} {r.permissions.length === 1 ? "thing" : "things"} allowed
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => openEdit(r)}>
                    {strings.edit}
                  </Button>
                  <Button variant="ghost" onClick={() => remove(r)}>
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? `Edit ${form.name || "role"}` : "Add role"}
        className="max-w-3xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              {strings.cancel}
            </Button>
            <Button onClick={save} disabled={busy}>
              {strings.save}
            </Button>
          </>
        }
      >
        {form && (
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={form.name}
                  maxLength={40}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="What this role is for" hint="Optional">
                <Input
                  value={form.description}
                  maxLength={160}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {PERMISSION_GROUPS.map((g) => {
                const items = g.items.filter((i) => moduleOn(i.module));
                if (items.length === 0) return null;
                const keys = items.map((i) => i.key as Permission);
                const allOn = keys.every((k) => form.permissions.has(k));
                return (
                  <fieldset key={g.label} className="rounded-[8px] border border-line p-3">
                    <legend className="flex w-full items-center justify-between px-1">
                      <span className="text-[13px] font-semibold uppercase tracking-[0.04em] text-sage-700">
                        {g.label}
                      </span>
                    </legend>
                    <button
                      type="button"
                      onClick={() => toggleGroup(keys, !allOn)}
                      className="mb-2 text-[12px] text-sage-600 underline-offset-2 hover:underline"
                    >
                      {allOn ? "Untick all" : "Tick all"}
                    </button>
                    <div className="flex flex-col gap-1.5">
                      {items.map((i) => (
                        <label key={i.key} className="flex items-start gap-2 text-[14px] text-sage-900">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={form.permissions.has(i.key as Permission)}
                            onChange={() => toggle(i.key as Permission)}
                          />
                          <span>{i.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
