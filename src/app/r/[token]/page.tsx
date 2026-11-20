import { headers } from "next/headers";
import { Clock, CreditCard, Unlink, ShieldAlert } from "lucide-react";
import { resolvePublicReport, logReportView } from "@/lib/repos/lab-orders";
import { getReportData } from "@/lib/repos/lab-report";
import { getCompany, getModuleFlags } from "@/lib/repos/company";
import { toReportView, originOf } from "@/lib/lab-report-view";
import { checkRateLimit, LAB_REPORT_VIEW } from "@/lib/rate-limit";
import { ReportPrintView } from "@/components/lab/report-print-view";

export const dynamic = "force-dynamic";
// Never in a search engine, and no patient name in the tab title.
export const metadata = { title: "Lab report", robots: { index: false, follow: false } };

/**
 * The patient's report, opened from the QR on their bill (owner, 2083-08-03):
 * no sign-in, a short unguessable code, shown only once at least one test is
 * approved and nothing is owed on the bill. Every opening is logged.
 */
export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const ua = h.get("user-agent") ?? "";
  const company = await getCompany();

  const limit = await checkRateLimit(LAB_REPORT_VIEW, ip);
  if (!limit.ok) {
    return <Notice clinic={company.name} icon={ShieldAlert} title="Please wait a little" body="This report was opened too many times in a short while. Try again in a few minutes." />;
  }
  if (!(await getModuleFlags()).lab) {
    return <Notice clinic={company.name} icon={Unlink} title="This link isn't working" body="Check the code on your bill, or ask at the laboratory." />;
  }

  const state = await resolvePublicReport(token);
  if (state.status === "invalid") {
    return <Notice clinic={company.name} icon={Unlink} title="This link isn't working" body="Check the code on your bill, or ask at the laboratory." />;
  }
  if (state.status === "not_ready") {
    await logReportView(state.orderId, "not_ready", ip, ua);
    return <Notice clinic={company.name} icon={Clock} title="Your report isn't ready yet" body="Please open this link again later. Your tests are still in the laboratory." />;
  }
  if (state.status === "payment_pending") {
    await logReportView(state.orderId, "payment_pending", ip, ua);
    return <Notice clinic={company.name} icon={CreditCard} title="Payment is still due" body="Your report is ready. Please clear the amount due on your bill at the counter, then open this link again." />;
  }

  const data = await getReportData(state.orderId);
  if (!data || data.sections.length === 0) {
    return <Notice clinic={company.name} icon={Clock} title="Your report isn't ready yet" body="Please open this link again later." />;
  }
  await logReportView(state.orderId, "shown", ip, ua);
  const pendingNote =
    state.pendingTests.length > 0
      ? `${state.approved} of ${state.total} tests are ready. Still in the laboratory: ${state.pendingTests.slice(0, 6).join(", ")}${state.pendingTests.length > 6 ? ` and ${state.pendingTests.length - 6} more` : ""}. They will appear on this same link when done.`
      : undefined;
  const view = await toReportView(data, originOf(h), pendingNote);
  return <ReportPrintView d={view} forPatient />;
}

function Notice({
  clinic,
  icon: Icon,
  title,
  body,
}: {
  clinic: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream-100 p-6">
      <div className="w-full max-w-md rounded-[12px] border border-line bg-cream-50 p-8 text-center">
        <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-sage-600">{clinic}</div>
        <Icon className="mx-auto mt-5 h-10 w-10 text-sage-500" />
        <h1 className="mt-3 text-[20px] font-semibold text-sage-900">{title}</h1>
        <p className="mt-2 text-[15px] leading-[1.5] text-sage-600">{body}</p>
      </div>
    </main>
  );
}
