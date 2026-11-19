import type { DefaultSession } from "next-auth";

// The session carries only who someone is. Their role and permissions are read
// from the database on every request (lib/session.ts getRequestUser).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
  }
}
