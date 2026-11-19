import { requireBackOfficeUser, can } from "@/lib/session";
import { getModules } from "@/lib/modules";
import { appNameFor } from "@/lib/app-name";
import { getDateCalendar } from "@/lib/repos/company";
import { Sidebar } from "@/components/app/sidebar";
import { GlobalShortcuts } from "@/components/app/global-shortcuts";
import { DateCalendarProvider } from "@/components/ui/date-calendar-context";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireBackOfficeUser();
  const modules = await getModules();
  const dateCalendar = await getDateCalendar();

  return (
    <div className="flex h-screen overflow-hidden bg-cream-100">
      <GlobalShortcuts canBill={can(user, "counter.use")} />
      <Sidebar
        user={{ name: user.name, roleName: user.roleName }}
        permissions={[...user.permissions]}
        appName={appNameFor(modules)}
        modules={modules}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <DateCalendarProvider calendar={dateCalendar}>{children}</DateCalendarProvider>
      </div>
    </div>
  );
}
