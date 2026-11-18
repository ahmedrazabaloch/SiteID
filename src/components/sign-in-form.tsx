"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, ToastProvider, useToast } from "@/components/toast-provider";

export function SignInForm() { return <ToastProvider><SignInContent /></ToastProvider>; }

function SignInContent() {
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const login = String(form.get("login") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const supabase = createClient();
      const credentials = login.includes("@")
        ? { email: login.toLowerCase(), password }
        : { email: idLoginEmail(login), password };
      const { data, error: authError } = await supabase.auth.signInWithPassword(credentials);
      if (authError) throw authError;
      if (!data.user) throw new Error("Sign-in did not return a user account.");
      const { data: profile, error: profileError } = await supabase.from("profiles").select("is_active").eq("id", data.user.id).maybeSingle();
      if (profileError || !profile?.is_active) {
        await supabase.auth.signOut();
        throw new Error("This account is inactive or not fully configured. Contact the super admin.");
      }
      router.refresh();
    } catch (cause) {
      notify(friendlyError(cause, "Sign-in failed. Check your ID and password."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <section className="login-panel">
        <div className="brand-mark">F1</div>
        <p className="eyebrow">FORMULAONE OPERATIONS</p>
        <h1>Fuel Ops</h1>
        <p className="muted">Sign in with your ID number and password.</p>
        <form onSubmit={submit} className="form-stack">
          <label>ID number or email<input name="login" autoComplete="username" inputMode="numeric" placeholder="03139090700" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}

function idLoginEmail(value: string) {
  const compact = value.replace(/[\s()-]/g, "");
  if (/^03\d{9}$/.test(compact)) return `${compact}@users.fuelops.invalid`;
  throw new Error("Enter your 11-digit ID number (starting with 03) or use your existing email account.");
}
