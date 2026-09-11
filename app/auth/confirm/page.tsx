/**
 * The click that a mail scanner will not make.
 *
 * The emailed link lands here instead of on the sign-in callback, and this
 * page consumes nothing: a scanner that prefetches it finds an inert page and
 * the token is still unspent when the person arrives. Pressing the button is
 * what runs the callback.
 *
 * Server-rendered on purpose. The forwarded URL is validated against this
 * origin before it is ever put in the markup, so a crafted link cannot make
 * the page into an open redirect wearing the site's own domain.
 */

import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { CONFIRM_PARAM, safeCallbackUrl } from "@/lib/auth-confirm-link";
import { appOrigin } from "@/lib/app-origin";

export const dynamic = "force-dynamic";

export default function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const raw = searchParams[CONFIRM_PARAM];
  const target = safeCallbackUrl(Array.isArray(raw) ? raw[0] : raw, appOrigin());

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="font-serif text-3xl">Sign in to {APP_NAME}</h1>
      {target ? (
        <>
          <p className="text-sm text-ink-muted">
            One more tap — this is here so the link in your inbox can&rsquo;t be used by
            anything that scans it before you do.
          </p>
          {/*
            A plain link, not a redirect: the point is that a machine fetching
            this page does not follow it, and a person pressing it does.
          */}
          <Link
            href={target}
            prefetch={false}
            className="rounded-full bg-ink px-8 py-3 text-center text-sm tracking-wide text-paper transition hover:bg-ink-soft"
          >
            Continue
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            This link isn&rsquo;t valid. It may have expired, or already been used.
          </p>
          <Link href="/" className="text-sm underline">
            Start again
          </Link>
        </>
      )}
    </main>
  );
}
