"use client";

/**
 * logo-upload.tsx — the header that prints across the top of every bill.
 *
 * Deliberately a picture and not a set of fields. Every shop already has a
 * letterhead it is happy with — its name set the way it wants, a logo, a
 * Devanagari line — and asking somebody to re-type that into six boxes gets a
 * bill that looks like the software rather than like the shop.
 *
 * The image is resized in the browser and kept with the rest of the company
 * profile, so it prints from any machine at the counter with the internet
 * down, which is the state a pharmacy prints in most often.
 */
import { useRef, useState } from "react";
import { ImagePlus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  downscaleToDataUrl,
  ACCEPTED_TYPES,
  ImageProblem,
  type DownscaleOptions,
} from "@/lib/logo-image";

export interface ImageCopy {
  title: string;
  help: string;
  choose: string;
  set: string;
  savedWith: string;
  alt: string;
}

const BILL_HEADER: ImageCopy = {
  title: "Bill header image",
  help: "Printed across the top of every bill, above the invoice details. Use your letterhead band — the whole strip, name and logo together. PNG or JPG, wide rather than tall.",
  choose: "Choose a header image",
  set: "Bill header set. Save your details to keep it.",
  savedWith: "It is resized here, and saved with your company details",
  alt: "The header as it will print at the top of a bill",
};

export const SIGN_IN_LOGO: ImageCopy = {
  title: "Logo",
  help: "Shown on the sign-in screen. Not printed.",
  choose: "Choose a logo",
  set: "Logo set. Save your details to keep it.",
  savedWith: "PNG, JPG or WEBP",
  alt: "The logo as it shows on the sign-in screen",
};

/** A logo is shown on screen, so it keeps a clear background and stays small. */
export const SIGN_IN_LOGO_RESIZE: DownscaleOptions = {
  maxWidth: 800,
  keepTransparency: true,
};

export function LogoUpload({
  value,
  onChange,
  copy = BILL_HEADER,
  resize,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  /** the words, when this is not the bill header (a report footer, a signature) */
  copy?: ImageCopy;
  /** how the image is shrunk before it is kept; the bill header's by default */
  resize?: DownscaleOptions;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const res = await downscaleToDataUrl(file, resize);
      onChange(res.dataUrl);
      toast.success(copy.set);
    } catch (err) {
      // Only wording written for this screen is repeated back; anything the
      // browser threw on its own is not something to put in front of anybody.
      toast.error(
        err instanceof ImageProblem
          ? err.message
          : "That image could not be used. Try a PNG or JPG.",
      );
    } finally {
      setBusy(false);
      // Let the same file be chosen again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div>
        <div className="text-[14px] font-medium text-sage-900">{copy.title}</div>
        <p className="mt-0.5 max-w-[560px] text-[12px] text-sage-500">{copy.help}</p>
      </div>

      {value ? (
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-[8px] border border-line bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt={copy.alt}
              className="mx-auto block max-h-[120px] w-full object-contain"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <ImagePlus className="h-4 w-4" />
              Replace
            </Button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium text-danger-600 hover:bg-danger-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex h-[104px] w-full flex-col items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-line bg-white text-sage-500 hover:border-sage-500 hover:text-sage-700"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ImagePlus className="h-5 w-5" />
          )}
          <span className="text-[13px] font-medium">
            {busy ? "Preparing…" : copy.choose}
          </span>
          <span className="text-[11px]">
            {copy.savedWith}
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        aria-label={copy.choose}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
    </div>
  );
}
