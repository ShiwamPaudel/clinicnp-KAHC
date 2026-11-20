import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe base config (no DB, no node crypto) so it can run in middleware.
 * The Credentials providers (which touch the DB) are added in ./auth.ts,
 * which runs only in the Node route handler.
 */
export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // ~one business day
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;
      // Public: login page.
      if (pathname.startsWith("/login")) return true;
      // The offline notice is a static page with no data on it. It has to be
      // reachable without a session, because the service worker serves it when
      // there is no connection to check a session against.
      if (pathname === "/offline") return true;
      // A patient's lab report, opened from the QR on their bill. The page
      // checks the code, the bill and the results itself (Lab.md).
      if (pathname.startsWith("/r/")) return true;
      // API routes enforce their own auth (session check or cron secret) and
      // must return JSON, not an HTML redirect.
      if (pathname.startsWith("/api")) return true;
      // The service worker + PWA assets must be publicly fetchable.
      if (pathname === "/sw.js" || pathname.startsWith("/swe-worker")) return true;
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        // Only who they are. What they may do is read from their role on
        // every request (lib/session.ts), so a change applies at once.
        token.uid = user.id as string;
        token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
