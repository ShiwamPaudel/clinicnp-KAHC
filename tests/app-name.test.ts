import { describe, it, expect } from "vitest";
import {
  appNameFor,
  appDescriptionFor,
  appSubtitleFor,
  CLINIC_APP_NAME,
  type ModuleFlags,
} from "@/lib/app-name";

/** Every combination with at least one module on. */
const ALL: ModuleFlags[] = [];
for (const pharmacy of [true, false])
  for (const clinic of [true, false])
    for (const lab of [true, false])
      if (pharmacy || clinic || lab) ALL.push({ pharmacy, clinic, lab });

describe("appNameFor — the product is ClinicNP whatever is switched on (2083-08-03)", () => {
  it("is ClinicNP for every combination of modules", () => {
    for (const m of ALL) expect(appNameFor(m)).toBe(CLINIC_APP_NAME);
  });
});

describe("appDescriptionFor", () => {
  it("names each part that is switched on", () => {
    const all = appDescriptionFor({ pharmacy: true, clinic: true, lab: true });
    expect(all).toMatch(/clinic/i);
    expect(all).toMatch(/laboratory/i);
    expect(all).toMatch(/pharmacy/i);
    expect(appDescriptionFor({ pharmacy: true, clinic: true, lab: false })).not.toMatch(/laboratory/i);
  });

  it("uses plain language with no backend words", () => {
    const banned = /database|\brow\b|query|sync|api|cache|null/i;
    for (const m of ALL) expect(appDescriptionFor(m)).not.toMatch(banned);
  });
});

describe("appSubtitleFor", () => {
  it("names only the parts that are switched on", () => {
    expect(appSubtitleFor({ pharmacy: true, clinic: true, lab: false })).toBe("Clinic & Pharmacy Management");
    expect(appSubtitleFor({ pharmacy: false, clinic: true, lab: false })).toBe("Clinic Management");
    expect(appSubtitleFor({ pharmacy: true, clinic: false, lab: false })).toBe("Pharmacy Management");
    expect(appSubtitleFor({ pharmacy: false, clinic: false, lab: true })).toBe("Laboratory Management");
    expect(appSubtitleFor({ pharmacy: true, clinic: true, lab: true })).toBe(
      "Clinic, Laboratory & Pharmacy Management",
    );
  });
});
