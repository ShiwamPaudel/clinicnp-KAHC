/**
 * lab-token.ts — the short code behind the QR on a bill (/r/<token>).
 *
 * Ten characters from a 57-character alphabet with no look-alikes (no 0/O,
 * 1/l/I): about 3.6 × 10^17 codes, so guessing one is hopeless — and the
 * public page is rate-limited on top. Short enough that the QR stays small and
 * a person could type it from the paper if the QR will not scan.
 *
 * Minted by the counter so a bill printed offline already carries its QR; the
 * server keeps that code if it is well-formed and unused (Lab.md).
 * Uses Web Crypto, which both the browser and Node provide.
 */

export const TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const TOKEN_LENGTH = 10;

const VALID = new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`);

export function isReportToken(s: unknown): s is string {
  return typeof s === "string" && VALID.test(s);
}

/** A fresh code. Rejection sampling, so every character is equally likely. */
export function mintReportToken(): string {
  const n = TOKEN_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    const bytes = new Uint8Array(TOKEN_LENGTH * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;
      out += TOKEN_ALPHABET[b % n];
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out;
}

/** The address printed under the QR and encoded in it. */
export function reportUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/r/${token}`;
}
