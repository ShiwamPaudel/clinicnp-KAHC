import { redirect } from "next/navigation";
import { requireBackOfficeUser, NO_ACCESS } from "@/lib/session";
import { getModules } from "@/lib/modules";
import { visibleSettingsTabs } from "@/lib/settings-tabs";

/** Settings opens on the first tab this person may use. */
export default async function SettingsIndex() {
  const user = await requireBackOfficeUser();
  const tabs = visibleSettingsTabs(await getModules(), [...user.permissions]);
  redirect(tabs[0]?.href ?? NO_ACCESS);
}
