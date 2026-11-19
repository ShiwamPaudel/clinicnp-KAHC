import { ShieldOff } from "lucide-react";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "@/components/auth/sign-out-button";

export const metadata = { title: "Not available" };

/**
 * Where somebody lands when their role does not include the page they asked
 * for. It says so plainly and offers the one thing they can do about it on
 * this screen: sign out so somebody else can sign in.
 */
export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream-100 p-6">
      <div className="max-w-md text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-sage-500" aria-hidden="true" />
        <h1 className="mt-4 text-[22px] font-semibold text-sage-900">
          This page isn&apos;t part of your work
        </h1>
        <p className="mt-2 text-[15px] leading-[1.5] text-sage-600">
          You are signed in as {user.name} ({user.roleName}). Ask the Admin if you
          need it, or sign out so somebody else can sign in.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <a
            href="/"
            className="inline-block rounded-[8px] border border-line bg-cream-50 px-4 py-2.5 text-[15px] font-medium text-sage-900 hover:bg-cream-100"
          >
            Go to my start page
          </a>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
