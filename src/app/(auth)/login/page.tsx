import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/session";
import { LoginForm } from "@/components/auth/login-form";
import { BrandPanel } from "@/components/auth/brand-panel";
import { appNameFor, appDescriptionFor } from "@/lib/app-name";
import { getModules } from "@/lib/modules";
import { getCompany } from "@/lib/repos/company";

/**
 * The sign-in screen.
 *
 * Two halves: the software on the left, this clinic on the right. Only the
 * clinic's name and letterhead cross to the browser — both are printed on
 * every bill that leaves the shop, so neither is a secret, and nothing else
 * from the company profile is sent to a page anybody can open.
 */
export default async function LoginPage() {
  // Somebody already signed in goes to their start page. A sign-in whose
  // account has since been switched off reads as nobody, so the form shows
  // instead of bouncing between here and the page that turned them away.
  if (await getRequestUser()) redirect("/");

  const [modules, company] = await Promise.all([getModules(), getCompany()]);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel
        appName={appNameFor(modules)}
        tagline={appDescriptionFor(modules)}
        modules={modules}
      />
      <LoginForm clinicName={company.name} clinicLogoUrl={company.logoUrl} />
    </div>
  );
}
