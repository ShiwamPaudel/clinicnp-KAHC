import { requirePermission } from "@/lib/session";
import { getModules } from "@/lib/modules";
import { SettingsTabs } from "@/components/app/settings-tabs";
import { visibleSettingsTabs, SETTINGS_TABS } from "@/lib/settings-tabs";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Anybody holding one of the settings permissions gets in; each tab's page
  // checks its own permission again.
  const user = await requirePermission([...new Set(SETTINGS_TABS.flatMap((t) => (Array.isArray(t.perm) ? t.perm : [t.perm])))]);
  const modules = await getModules();
  return (
    <>
      <SettingsTabs tabs={visibleSettingsTabs(modules, [...user.permissions])} />
      {children}
    </>
  );
}
