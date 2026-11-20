/**
 * lab-codes.ts — the QR on reports and the Code 128 barcode on sample labels,
 * drawn on the server as images. Server-only.
 */
import "server-only";
import QRCode from "qrcode";
import { toBuffer } from "bwip-js/node";

/** A QR code as a PNG data URL, or "" if it cannot be drawn. */
export async function qrDataUrl(text: string, size = 128): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" });
  } catch {
    return "";
  }
}

/**
 * A Code 128 barcode — what handheld scanners read on a tube — as a PNG data
 * URL, or "" if it cannot be drawn (the label then prints the code in type).
 */
export async function barcodeDataUrl(text: string, opts: { heightMm?: number; scale?: number; withText?: boolean } = {}): Promise<string> {
  if (!text) return "";
  try {
    const png = await toBuffer({
      bcid: "code128",
      text,
      scale: opts.scale ?? 3,
      height: opts.heightMm ?? 10,
      includetext: opts.withText ?? true,
      textxalign: "center",
      textsize: 8,
      backgroundcolor: "FFFFFF",
    });
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return "";
  }
}
