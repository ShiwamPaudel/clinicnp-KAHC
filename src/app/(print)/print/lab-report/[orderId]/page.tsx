import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { getReportData } from "@/lib/repos/lab-report";
import { toReportView, originOf } from "@/lib/lab-report-view";
import { ReportPrintView } from "@/components/lab/report-print-view";

export const metadata = { title: "Lab report" };

export default async function LabReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ only?: string }>;
}) {
  await requireModulePage("lab");
  await requirePermission("lab.reports");
  const { orderId } = await params;
  const sp = await searchParams;
  const only = sp.only ? sp.only.split(",").filter(Boolean) : undefined;
  const data = await getReportData(orderId, only);
  if (!data || data.sections.length === 0) notFound();
  const view = await toReportView(data, originOf(await headers()));
  return <ReportPrintView d={view} backHref={`/lab/orders/${orderId}`} />;
}
