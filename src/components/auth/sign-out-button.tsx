"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { clearCachesOnLogout } from "@/offline/catalog-cache";

/** Sign out, keeping anything still waiting to be sent (same as the menu's button). */
export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => {
        void clearCachesOnLogout()
          .catch(() => {})
          .finally(() => signOut({ redirectTo: "/login" }));
      }}
      className="inline-flex items-center gap-2 rounded-[8px] bg-sage-700 px-4 py-2.5 text-[15px] font-medium text-cream-50 hover:bg-sage-900"
    >
      <LogOut className="h-4 w-4" />
      Sign out
    </button>
  );
}
