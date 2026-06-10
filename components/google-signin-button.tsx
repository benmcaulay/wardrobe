"use client";

import { signIn } from "next-auth/react";

export function GoogleSignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/closet" })}
      className="rounded-full bg-ink text-paper px-8 py-3 text-sm tracking-wide hover:bg-ink-soft transition"
    >
      Continue with Google
    </button>
  );
}
