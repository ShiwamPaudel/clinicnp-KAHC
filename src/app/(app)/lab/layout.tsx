import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { labQueueCounts } from "@/lib/repos/lab-orders";
import { LabTabs } from "@/components/lab/lab-tabs";
import { LAB_PERMISSIONS } from "@/lib/permissions";

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("lab");
  const user = await requirePermission([...LAB_PERMISSIONS]);
  const counts = await labQueueCounts();
  return (
    <>
      <LabTabs counts={counts} permissions={[...user.permissions]} />
      {children}
    </>
  );
}
