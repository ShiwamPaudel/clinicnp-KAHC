import { requirePermission } from "@/lib/session";
import { ACCOUNTS_PERMISSIONS } from "@/lib/permissions";
import { AccountsTabs } from "@/components/accounts/accounts-tabs";

/** Accounts: the whole clinic's books. Not behind a module — every install keeps books. */
export default async function AccountsLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission([...ACCOUNTS_PERMISSIONS]);
  return (
    <>
      <AccountsTabs permissions={[...user.permissions]} />
      <main className="mx-auto w-full max-w-[1240px] flex-1 p-6">{children}</main>
    </>
  );
}
