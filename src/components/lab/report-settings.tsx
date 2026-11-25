"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { LogoUpload, type ImageCopy } from "@/components/app/logo-upload";
import { saveLabSettingsAction, saveSignatoryAction } from "@/app/(app)/lab/actions";
import { strings } from "@/lib/strings";

export interface ReportSettingsValue {
  headerImage: string;
  footerImage: string;
  marginTopMm: number;
  marginBottomMm: number;
  marginXMm: number;
  pageNote: string;
  endNote: string;
}

export interface SignatoryValue {
  id: string;
  name: string;
  description: string;
  image: string;
  sortOrder: number;
  active: boolean;
}

const HEADER_COPY: ImageCopy = {
  title: "Report header",
  help: "Printed across the top of every report page. Leave it empty to use the bill letterhead.",
  choose: "Choose a header image",
  set: "Header chosen. Press Save to keep it.",
  savedWith: "It is resized here, and saved when you press Save",
  alt: "The report header",
};
const FOOTER_COPY: ImageCopy = {
  title: "Report footer",
  help: "Printed across the bottom of every report page, under the signatures. Optional.",
  choose: "Choose a footer image",
  set: "Footer chosen. Press Save to keep it.",
  savedWith: "It is resized here, and saved when you press Save",
  alt: "The report footer",
};
const SIGNATURE_COPY: ImageCopy = {
  title: "Signature image",
  help: "A clear photo or scan of the signature on white paper.",
  choose: "Choose a signature image",
  set: "Signature chosen. Press Save to keep it.",
  savedWith: "It is resized here, and saved when you press Save",
  alt: "The signature",
};

const NOTE_CLASS =
  "w-full rounded-[8px] border border-line bg-cream-50 px-3 py-2 text-[14px] leading-[1.45] outline-none focus:border-sage-700 focus:ring-2 focus:ring-sage-700/20";

/** Settings → Lab report: how the report looks, and who signs it. */
export function ReportSettings({ initial, signatories }: { initial: ReportSettingsValue; signatories: SignatoryValue[] }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({
    ...initial,
    top: String(initial.marginTopMm),
    bottom: String(initial.marginBottomMm),
    x: String(initial.marginXMm),
  });
  const [sig, setSig] = useState<(Omit<SignatoryValue, "id"> & { id?: string }) | null>(null);
  const [pending, start] = useTransition();

  function saveSettings() {
    start(async () => {
      const res = await saveLabSettingsAction({
        headerImage: v.headerImage,
        footerImage: v.footerImage,
        marginTopMm: Math.trunc(Number(v.top) || 0),
        marginBottomMm: Math.trunc(Number(v.bottom) || 0),
        marginXMm: Math.trunc(Number(v.x) || 0),
        pageNote: v.pageNote,
        endNote: v.endNote,
      });
      if (res.ok) {
        toast.success(strings.saved);
        router.refresh();
      } else toast.error(res.userMessage ?? strings.somethingWentWrong);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-[10px] border border-line bg-cream-50 p-4">
        <h2 className="text-[16px] font-semibold text-sage-900">Letterhead</h2>
        <p className="mb-3 text-[13px] text-sage-500">
          Printed across the top and bottom of every report page. With no header here, the bill letterhead is used.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <LogoUpload copy={HEADER_COPY} value={v.headerImage || null} onChange={(d) => setV({ ...v, headerImage: d ?? "" })} />
          <LogoUpload copy={FOOTER_COPY} value={v.footerImage || null} onChange={(d) => setV({ ...v, footerImage: d ?? "" })} />
        </div>
        <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-3">
          <Field label="Top space (mm)" hint="Kept blank when printing on a pre-printed pad">
            <Input value={v.top} inputMode="numeric" onChange={(e) => setV({ ...v, top: e.target.value })} />
          </Field>
          <Field label="Bottom space (mm)">
            <Input value={v.bottom} inputMode="numeric" onChange={(e) => setV({ ...v, bottom: e.target.value })} />
          </Field>
          <Field label="Side margins (mm)">
            <Input value={v.x} inputMode="numeric" onChange={(e) => setV({ ...v, x: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button disabled={pending} onClick={saveSettings}>
            {strings.save}
          </Button>
        </div>
      </section>

      <section className="rounded-[10px] border border-line bg-cream-50 p-4">
        <h2 className="mb-3 text-[16px] font-semibold text-sage-900">Notes on the report</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="On every page" hint="Printed at the foot of every page, under the signatures">
            <textarea
              value={v.pageNote}
              rows={3}
              maxLength={400}
              onChange={(e) => setV({ ...v, pageNote: e.target.value })}
              className={NOTE_CLASS}
            />
          </Field>
          <Field label="At the end of the report" hint="Printed once, after the last result">
            <textarea
              value={v.endNote}
              rows={3}
              maxLength={2000}
              onChange={(e) => setV({ ...v, endNote: e.target.value })}
              className={NOTE_CLASS}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button disabled={pending} onClick={saveSettings}>
            {strings.save}
          </Button>
        </div>
      </section>

      <section className="rounded-[10px] border border-line bg-cream-50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-sage-900">Signatures</h2>
            <p className="text-[13px] text-sage-500">Signatures that are on sign every report, in this order (up to three).</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setSig({ name: "", description: "", image: "", sortOrder: signatories.length, active: true })}
          >
            <Plus className="h-4 w-4" />
            Add signature
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {signatories.map((s) => (
            <div key={s.id} className="rounded-[8px] border border-line p-3">
              {s.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.image} alt="" className="h-12 max-w-full object-contain" />
              ) : (
                <div className="flex h-12 items-center text-[12px] text-sage-500">No signature image</div>
              )}
              <div className="mt-2 font-medium text-sage-900">
                {s.name} {!s.active && <Badge tone="danger">Off</Badge>}
              </div>
              <div className="text-[13px] text-sage-600">{s.description}</div>
              <Button variant="ghost" className="mt-1 px-0" onClick={() => setSig({ ...s })}>
                {strings.edit}
              </Button>
            </div>
          ))}
          {signatories.length === 0 && <p className="text-[13px] text-sage-500">None yet. A report can&apos;t be approved without one.</p>}
        </div>
      </section>

      <Dialog
        open={sig !== null}
        onClose={() => setSig(null)}
        title={sig?.id ? "Edit signature" : "Add signature"}
        footer={
          <Button
            disabled={pending}
            onClick={() =>
              sig &&
              start(async () => {
                const res = await saveSignatoryAction(sig);
                if (res.ok) {
                  toast.success(strings.saved);
                  setSig(null);
                  router.refresh();
                } else toast.error(res.userMessage ?? strings.somethingWentWrong);
              })
            }
          >
            {strings.save}
          </Button>
        }
      >
        {sig && (
          <div className="flex flex-col gap-3">
            <Field label="Name as printed">
              <Input value={sig.name} onChange={(e) => setSig({ ...sig, name: e.target.value })} />
            </Field>
            <Field label="Under the name" hint="Qualification, designation, council number">
              <Input value={sig.description} onChange={(e) => setSig({ ...sig, description: e.target.value })} />
            </Field>
            <LogoUpload copy={SIGNATURE_COPY} value={sig.image || null} onChange={(d) => setSig({ ...sig, image: d ?? "" })} />
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={sig.active} onChange={(e) => setSig({ ...sig, active: e.target.checked })} /> In use
            </label>
          </div>
        )}
      </Dialog>
    </div>
  );
}
