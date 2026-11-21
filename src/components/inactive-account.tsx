"use client";

import { useState } from "react";
import Image from "next/image";
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
  return <main className="login-wrap"><section className="login-panel"><div className="brand-mark login-logo-mark"><Image src="/icon-512.png" alt="" width={50} height={50} priority /></div><h1>Account deactivated</h1><p className="muted">This account no longer has access to Search ID. Contact the super admin if you think this is a mistake.</p><button className="primary-button" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button></section></main>;
}
