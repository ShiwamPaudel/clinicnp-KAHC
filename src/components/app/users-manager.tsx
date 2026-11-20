"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { createUserAction, updateUserAction } from "@/app/(app)/settings/actions";
import type { User } from "@/lib/repos/users";
import { strings } from "@/lib/strings";

export interface RoleOption {
  id: string;
  name: string;
}

interface FormState {
  name: string;
  username: string;
  password: string;
  roleId: string;
}

export function UsersManager({
  initial,
  roles,
  selfId,
}: {
  initial: User[];
  roles: RoleOption[];
  selfId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const empty: FormState = { name: "", username: "", password: "", roleId: roles[0]?.id ?? "" };
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submitNew() {
    setBusy(true);
    const res = await createUserAction(form);
    setBusy(false);
    if (res.ok) {
      toast.success("Person added");
      setAddOpen(false);
      setForm(empty);
      router.refresh();
    } else {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
    }
  }

  async function submitEdit() {
    if (!editing) return;
    setBusy(true);
    const res = await updateUserAction({
      id: editing.id,
      name: form.name,
      roleId: form.roleId,
      password: form.password || undefined,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(strings.saved);
      setEditing(null);
      router.refresh();
    } else {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
    }
  }

  async function toggleActive(u: User) {
    const res = await updateUserAction({ id: u.id, active: !u.active });
    if (res.ok) {
      toast.success(u.active ? "Switched off — they can no longer sign in" : "Switched on");
      router.refresh();
    } else {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
    }
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({ name: u.name, username: u.username, password: "", roleId: u.roleId });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <span />
        <Button
          onClick={() => {
            setForm(empty);
            setAddOpen(true);
          }}
        >
          <UserPlus className="h-4 w-4" />
          {strings.addUser}
        </Button>
      </div>

      {initial.length === 0 ? (
        <EmptyState icon={UsersIcon} message={strings.emptyUsers} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Username</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {initial.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium text-sage-900">
                  {u.name}
                  {u.id === selfId && <span className="ml-2 text-[12px] text-sage-500">(you)</span>}
                </TD>
                <TD>{u.username}</TD>
                <TD>
                  <Badge tone={u.roleId === "admin" ? "neutral" : "info"}>{u.roleName}</Badge>
                </TD>
                <TD>
                  {u.active ? (
                    <Badge tone="ok">Active</Badge>
                  ) : (
                    <Badge tone="danger">Switched off</Badge>
                  )}
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => openEdit(u)}>
                      {strings.edit}
                    </Button>
                    {u.id !== selfId && (
                      <Button variant="ghost" onClick={() => toggleActive(u)}>
                        {u.active ? "Switch off" : "Switch on"}
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={strings.addUser}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              {strings.cancel}
            </Button>
            <Button onClick={submitNew} disabled={busy}>
              {strings.add}
            </Button>
          </>
        }
      >
        <UserFields form={form} set={set} roles={roles} isNew />
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : strings.edit}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {strings.cancel}
            </Button>
            <Button onClick={submitEdit} disabled={busy}>
              {strings.save}
            </Button>
          </>
        }
      >
        <UserFields form={form} set={set} roles={roles} isNew={false} />
      </Dialog>
    </div>
  );
}

function UserFields({
  form,
  set,
  roles,
  isNew,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  roles: RoleOption[];
  isNew: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label={strings.fullName}>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      {isNew && (
        <Field label={strings.username} hint="At least 3 characters">
          <Input
            value={form.username}
            autoComplete="off"
            onChange={(e) => set("username", e.target.value)}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field
          label={isNew ? strings.password : "New password"}
          hint={isNew ? "At least 6 characters" : "Leave blank to keep"}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>
        <Field label={strings.role} hint="What they can see and do — see Roles">
          <Select value={form.roleId} onChange={(e) => set("roleId", e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}
