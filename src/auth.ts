import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { verifyCredentials } from "@/lib/repos/users";
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/repos/security";
import { loginSchema } from "@/lib/validators";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // The only way in: username + password. To change who is using a
    // screen, sign out and sign back in (0022 removed the PIN quick-switch).
    Credentials({
      id: "password",
      name: "Password",
      credentials: { username: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const ident = parsed.data.username;
        // Brute-force gate: refuse while locked (don't even check the password).
        const gate = await checkLoginAllowed(ident);
        if (!gate.allowed) return null;
        const u = await verifyCredentials(ident, parsed.data.password);
        if (!u) {
          await recordLoginFailure(ident);
          return null;
        }
        await clearLoginFailures(ident);
        return { id: u.id, name: u.name };
      },
    }),
  ],
});
