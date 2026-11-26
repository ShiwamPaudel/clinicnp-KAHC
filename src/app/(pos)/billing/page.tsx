import { requirePermission, can } from "@/lib/session";
import { getCompany, getPercentDiscountMethod } from "@/lib/repos/company";
import { adToIso, bsToDbText, formatBS, today } from "@/lib/bs";
import { PosScreen } from "@/components/pos/pos-screen";
import { getModules } from "@/lib/modules";
import { appNameFor } from "@/lib/app-name";
import type { PosConfig } from "@/components/pos/bill-table";
import { publicAppOrigin } from "@/lib/lab-report-view";
import { getPrebooking } from "@/lib/repos/prebookings";
import { getPatient } from "@/lib/repos/patients";
import { displayAge } from "@/lib/age";

/**
 * A booking still waiting, ready for the counter (Pre-Booking → Issue bill).
 * One already billed, cancelled or missed is not put on the counter again.
 */
async function counterPrebooking(id: string): Promise<PosConfig["prebooking"]> {
  const b = await getPrebooking(id);
  if (!b || b.status !== "booked") return null;
  const p = b.patientId ? await getPatient(b.patientId) : null;
  return {
    id: b.id,
    name: b.name,
    phone: b.phone,
    serviceIds: b.items.map((i) => i.serviceId),
    advancePaisa: Math.max(0, b.inHandPaisa),
    receiptLabels: b.moves
      .filter((m) => m.kind === "received")
      .map((m) => m.receiptLabel)
      .join(", "),
    patient: p
      ? {
          id: p.id,
          patientNo: p.patientNo,
          name: p.name,
          sex: p.sex,
          ageShort: displayAge({ value: p.ageValue, unit: p.ageUnit, asOfAd: p.ageAsOfAd, dobAd: p.dobAd }, adToIso(new Date())).short,
        }
      : null,
  };
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ prebooking?: string }> }) {
  const user = await requirePermission("counter.use");
  const sp = await searchParams;
  const prebooking = sp.prebooking ? await counterPrebooking(sp.prebooking) : null;
  const company = await getCompany();
  const percentDiscountMethod = await getPercentDiscountMethod();
  const modules = await getModules();
  const bsToday = today();

  const config: PosConfig = {
    appName: appNameFor(modules),
    vatRegistered: company.vatRegistered,
    roundingOn: company.roundingOn,
    percentDiscountMethod,
    rackDisplay: company.rackDisplay,
    minRateIsCost: company.minRateIsCost,
    // patients and services at the counter: Clinic or Laboratory
    clinicOn: modules.clinic || modules.lab,
    canEditRate: can(user, "counter.change_rate"),
    isAdmin: can(user, "bills.cancel"),
    userName: user.name,
    todayIso: adToIso(new Date()),
    todayBsLong: formatBS(bsToday, { form: "long", monthScript: "en" }),
    todayBsText: bsToDbText(bsToday),
    company: {
      name: company.name,
      address: company.address,
      phone: company.phone,
      panNo: company.panNo,
      ddaNo: company.ddaNo,
      invoiceFooter: company.invoiceFooter,
      vatRegistered: company.vatRegistered,
      logoUrl: company.logoUrl,
    },
    publicOrigin: publicAppOrigin() ?? "",
    prebooking,
  };

  return <PosScreen config={config} />;
}
