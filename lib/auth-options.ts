import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import EmailProvider from "next-auth/providers/email";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { createTransport } from "nodemailer";
import { APP_NAME } from "./brand";
import { emailAllowed } from "./auth-allowlist";
import { confirmUrlFor } from "./auth-confirm-link";

/** Credits granted to a freshly signed-up user (~$10 of generations). */
const STARTER_CREDITS = 250;

/**
 * NextAuth configuration: email magic links with database sessions stored in our
 * own Postgres via the Prisma adapter. Database (not JWT) sessions keep
 * everything revocable and in one place next to the credit ledger.
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  session: { strategy: "database" },
  providers: [
    /*
     * Magic links rather than OAuth or passwords.
     *
     * Passwords would mean storing hashes and building reset flows for two
     * people, and NextAuth v4 only permits credential auth with JWT sessions —
     * which would give up the database sessions this app deliberately uses, so
     * that a login stays revocable and lives next to the credit ledger. The
     * email provider keeps those sessions and stores no secret at all.
     *
     * VerificationToken already exists in the schema as part of the adapter, so
     * this needs no migration.
     */
    EmailProvider({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
      // A link that lives long enough to survive switching to a phone, and not
      // much longer. NextAuth's default is 24h, which is a long window for a
      // credential sitting in an inbox.
      maxAge: 30 * 60,
      /*
       * Send people to a page that needs a click, not straight to the
       * callback.
       *
       * Mail providers prefetch links to scan them, and a magic-link token is
       * single use — so the scanner spent it, took the session, and the
       * person clicking landed back on the signed-out page. Measured here:
       * the link was opened 8 seconds after it was requested.
       */
      async sendVerificationRequest({ identifier, url, provider }) {
        const confirm = confirmUrlFor(url);
        const transport = createTransport(provider.server);
        await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: `Sign in to ${APP_NAME}`,
          text: `Sign in to ${APP_NAME}\n\nOpen this link and press the button:\n${confirm}\n\nIt expires in 30 minutes. If you did not ask for this, ignore it.`,
          html: `<body style="font-family:system-ui,sans-serif;line-height:1.5">
  <p>Sign in to <strong>${APP_NAME}</strong>.</p>
  <p><a href="${confirm}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">Continue</a></p>
  <p style="color:#666;font-size:13px">You will be asked to confirm on the next page. The link expires in 30 minutes; ignore this email if you did not ask for it.</p>
</body>`,
        });
      },
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
    signIn({ user, email }) {
      const allowed = emailAllowed(user.email, process.env.AUTH_ALLOWED_EMAILS);
      /*
       * For the email provider this callback runs twice: once when the link is
       * requested (email.verificationRequest) and again when it is followed.
       * Rejecting on the first pass is what matters — it means an address off
       * the roster never receives a link, rather than receiving one that fails
       * later. Enumeration is unchanged either way: the UI says the same thing
       * to everyone.
       */
      if (!allowed && email?.verificationRequest) return false;
      return allowed;
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
