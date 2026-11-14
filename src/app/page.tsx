import { SignInForm } from "@/components/sign-in-form";
import { DashboardShell } from "@/components/dashboard-shell";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, operator_shift")
    .eq("id", user.id)
    .maybeSingle();

  return <DashboardShell profile={{ name: profile?.full_name || user.email || "Operator", role: profile?.role || "operator", shift: profile?.operator_shift || "day" }} />;
}
