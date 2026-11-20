/**
 * settings-tabs.ts — which Settings tabs exist and who may open them. Pure, so
 * the server layout (which decides) and the tab strip (which draws) share it.
 */
import type { Permission } from "@/lib/permissions";
import type { ModuleFlags } from "@/lib/app-name";

export interface SettingsTab {
  href: string;
  label: string;
  /** Shown only when this module is on. */
  module?: keyof ModuleFlags;
  perm: Permission;
}

// Settings tabs. A tab marked with a module appears only when that module is
// on — a pharmacy-only install should not be told about doctors it has none
// of — and only to somebody whose role allows it. Each page checks again on
// the server; this list is only what is offered.
export const SETTINGS_TABS: SettingsTab[] = [
  { href: "/settings/company", label: "Company", perm: "settings.manage" },
  { href: "/settings/modules", label: "Modules", perm: "settings.manage" },
  { href: "/settings/services", label: "Services", module: "clinic", perm: "clinic.setup" },
  { href: "/settings/doctors", label: "Doctors", module: "clinic", perm: "clinic.setup" },
  { href: "/settings/lab-partners", label: "Lab partners", module: "clinic", perm: "clinic.setup" },
  { href: "/settings/lab", label: "Laboratory", module: "lab", perm: "lab.catalog" },
  { href: "/settings/lab-report", label: "Lab report", module: "lab", perm: "lab.catalog" },
  { href: "/settings/racks", label: "Shop layout", module: "pharmacy", perm: "stock.adjust" },
  { href: "/settings/fiscal-years", label: "Fiscal years", perm: "settings.manage" },
  { href: "/settings/users", label: "Users", perm: "users.manage" },
  { href: "/settings/roles", label: "Roles", perm: "users.manage" },
  { href: "/settings/backup", label: "Backup", perm: "settings.manage" },
  { href: "/settings/audit", label: "Audit log", perm: "audit.view" },
];

/** The tabs this person may open with these modules on. Pure, shared with the server. */
export function visibleSettingsTabs(
  modules: ModuleFlags,
  permissions: readonly Permission[],
): SettingsTab[] {
  const granted = new Set(permissions);
  return SETTINGS_TABS.filter(
    (t) => (!t.module || modules[t.module]) && granted.has(t.perm),
  );
}
