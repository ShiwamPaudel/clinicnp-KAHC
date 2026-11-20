import { getCompany } from "@/lib/repos/company";
import { PrintButton } from "@/components/app/print-button";

/**
 * A statement that prints as it shows: the clinic's name and the period head
 * the paper, and the controls stay off it (styles/print.css, .print-page).
 */
export async function Statement({
  title,
  period,
  controls,
  actions,
  children,
}: {
  title: string;
  period: string;
  /** the period picker */
  controls?: React.ReactNode;
  /** buttons beside Print */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const company = await getCompany();
  return (
    <div className="print-page">
      {controls}
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold text-sage-900">{title}</h2>
        <div className="flex flex-wrap gap-2">
          {actions}
          <PrintButton label="Print" />
        </div>
      </div>
      <div className="print-only mb-3 text-center">
        <div className="text-[15px] font-semibold">{company.name}</div>
        {company.address && <div>{company.address}</div>}
        <div className="mt-1 text-[13px] font-semibold">{title}</div>
        <div>{period}</div>
      </div>
      {children}
    </div>
  );
}
