/**
 * app-name.ts — the product is called ClinicNP whichever modules are on
 * (owner, 2083-08-03; replaces D-025's derived "Faarma" for a pharmacy-only
 * install). What still follows the modules is the one-line description and
 * the title suffix, which name only the parts that are switched on.
 *
 * Pure and dependency-free, so both the server and the counter bundle can
 * import it.
 */

export interface ModuleFlags {
  pharmacy: boolean;
  clinic: boolean;
  lab: boolean;
}

/** The product's name. */
export const CLINIC_APP_NAME = "ClinicNP";

/** Default until the module flags have been read. */
export const DEFAULT_APP_NAME = CLINIC_APP_NAME;

/** Always ClinicNP; kept as a function so callers need not change if that ever moves. */
export function appNameFor(_modules: ModuleFlags): string {
  return CLINIC_APP_NAME;
}

/** The switched-on parts in a fixed order: Clinic, Laboratory, Pharmacy. */
function parts(modules: ModuleFlags): string[] {
  const out: string[] = [];
  if (modules.clinic) out.push("clinic");
  if (modules.lab) out.push("laboratory");
  if (modules.pharmacy) out.push("pharmacy");
  return out;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One-line description for metadata, the manifest and the PWA install prompt. */
export function appDescriptionFor(modules: ModuleFlags): string {
  const p = parts(modules);
  if (p.length === 1 && p[0] === "pharmacy") {
    return "Pharmacy billing & stock for Nepali retail pharmacies";
  }
  if (p.length === 1 && p[0] === "clinic") return "Clinic billing, patients and visits";
  if (p.length === 1 && p[0] === "laboratory") return "Laboratory billing, samples and reports";
  return `${capital(joinWords(p))} billing, patients and records`;
}

/** The title suffix: names only the parts that are actually switched on. */
export function appSubtitleFor(modules: ModuleFlags): string {
  const p = parts(modules).map(capital);
  if (p.length === 0) return "Management";
  return `${p.length === 3 ? `${p[0]}, ${p[1]} & ${p[2]}` : p.join(" & ")} Management`;
}
