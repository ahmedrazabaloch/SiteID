"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, ToastProvider, useToast } from "@/components/toast-provider";

export function InactiveAccount() { return <ToastProvider><InactiveAccountContent /></ToastProvider>; }

function InactiveAccountContent() {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      window.location.reload();
    } catch (cause) { notify(friendlyError(cause, "Could not sign out. Please try again."), "error"); }
    finally { setBusy(false); }
  }
  return <main className="login-wrap"><section className="login-panel"><div className="brand-mark tower-brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7 11 34m9-27 9 27M14 25h12M16 19h8M18 13h4M13 34h14M16 7a5.7 5.7 0 0 1 8 0M12.5 3.5a10.6 10.6 0 0 1 15 0" /></svg></div><h1>Account deactivated</h1><p className="muted">This account no longer has access to Search ID. Contact the super admin if you think this is a mistake.</p><button className="primary-button" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button></section></main>;
}
