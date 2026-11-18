import { SignInForm } from "@/components/sign-in-form";
import { DashboardShell } from "@/components/dashboard-shell";
import { InactiveAccount } from "@/components/inactive-account";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return (
      <main className="login-wrap">
        <section className="login-panel">
          <div className="brand-mark">F1</div>
          <p className="eyebrow">FORMULAONE OPERATIONS</p>
          <h1>Fuel Ops setup</h1>
          <p className="muted">App files are ready. Connect the Supabase project URL and publishable key, then run the database migration before inviting users.</p>
          <p className="setup-code">NEXT_PUBLIC_SUPABASE_URL<br />NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</p>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <SignInForm />;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, role, operator_shift, username, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.is_active === false) return <InactiveAccount />;
  if (profileError || !profile) {
    return <main className="login-wrap"><section className="login-panel"><h1>Account unavailable</h1><p className="muted">Your user profile could not be loaded. Contact the super admin before trying again.</p></section></main>;
  }

  return <DashboardShell profile={{ name: profile.full_name || user.email || user.phone || "Operator", role: profile.role, shift: profile.operator_shift, email: profile.username || user.email || user.phone || "" }} />;
}
