import { requirePermission } from "@/lib/session";
import { listBackups } from "@/lib/repos/backup";
import { backupStorage } from "@/lib/backups";
import { BackupPanel } from "@/components/app/backup-panel";

export default async function BackupPage() {
  await requirePermission("settings.manage");
  const [backups, storage] = await Promise.all([listBackups(), backupStorage()]);
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">
      <BackupPanel backups={backups} storage={storage} />
    </main>
  );
}
