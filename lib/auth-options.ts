import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { emailAllowed } from "./auth-allowlist";

/** Credits granted to a freshly signed-up user (~$10 of generations). */
const STARTER_CREDITS = 250;

/**
 * NextAuth configuration: Google OAuth with database sessions stored in our
 * own Postgres via the Prisma adapter. Database (not JWT) sessions keep
 * everything revocable and in one place next to the credit ledger.
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  session: { strategy: "database" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    /**
     * Enforce the AUTH_ALLOWED_EMAILS roster before an account can exist.
     *
     * This runs ahead of the adapter's createUser, so a rejected address
     * leaves no User row and no credit grant behind — the check has to be
     * here rather than in `session`, which only ever sees people who already
     * got in.
     */
    signIn({ user, profile }) {
      return emailAllowed(user.email ?? profile?.email, process.env.AUTH_ALLOWED_EMAILS);
    },
    session({ session, user }) {
      if (session.user) {
        (session.user as typeof session.user & { id: string }).id = user.id;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: STARTER_CREDITS },
      });
    },
  },
};
