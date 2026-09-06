"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

/**
 * Magic-link sign-in.
 *
 * `redirect: false` so the "check your inbox" confirmation renders in place.
 * NextAuth's own /api/auth/verify-request page would work, but it is unstyled
 * and drops the user out of the landing page mid-flow.
 */
export function EmailSignInForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setState({ kind: "sending" });
    const res = await signIn("email", { email: email.trim(), redirect: false, callbackUrl: "/closet" });
    /*
     * Deliberately identical copy whether or not the address is on the roster.
     * Saying "not authorised" here would turn the form into a membership
     * oracle for anyone who found the URL.
     */
    if (res?.error && res.error !== "AccessDenied") {
      setState({ kind: "error", message: "Could not send the link. Try again in a moment." });
      return;
    }
    setState({ kind: "sent" });
  }

  if (state.kind === "sent") {
    return (
      <p className="text-sm text-ink-muted max-w-xs text-center">
        If that address has access, a sign-in link is on its way. It expires in
        30 minutes.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-center gap-3">
      <label htmlFor="signin-email" className="sr-only">
        Email address
      </label>
      <input
        id="signin-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="rounded-full border border-ink/20 bg-paper/70 px-6 py-3 text-sm tracking-wide text-ink placeholder:text-ink-muted/60 backdrop-blur-sm outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
      />
      <button
        type="submit"
        disabled={state.kind === "sending"}
        className="rounded-full bg-ink text-paper px-8 py-3 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-60"
      >
        {state.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state.kind === "error" && <p className="text-sm text-ink-muted">{state.message}</p>}
    </form>
  );
}
