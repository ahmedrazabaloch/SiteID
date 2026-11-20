import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function loadAll<T>(readPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required to sync offline data." }, { status: 401 });

    const { data: profile, error: profileError } = await supabase.from("profiles").select("is_active").eq("id", user.id).maybeSingle();
    if (profileError) throw new Error("Could not verify your account.");
    if (!profile?.is_active) return NextResponse.json({ error: "This account is inactive." }, { status: 403 });

    const [sites, fuel, vehicles] = await Promise.all([
      loadAll<Record<string, unknown>>(async (from, to) => await supabase.from("site_master")
        .select("site_id,address,site_area,f1_zone,day_team,day_route,day_driver,day_fueler,night_team,night_route,night_driver,night_fueler,cluster_owner_name,cluster_owner_phone,night_on_caller_name,night_on_caller_phone,ie_lead_name,ie_lead_phone,zong_lead_name,zong_lead_phone,security_so_name,security_so_phone,other_notes")
        .order("site_id").range(from, to)),
      loadAll<Record<string, unknown>>(async (from, to) => await supabase.from("site_latest")
        .select("site_id,fueling_date,available_fuel,fuel_poured,total_fuel,dg_meter_status,previous_reading,current_reading,running_hours,average_consumption")
        .order("site_id").range(from, to)),
      loadAll<Record<string, unknown>>(async (from, to) => await supabase.from("route_vehicles")
        .select("route,field_shift,team,vehicle_number,driver,fueler_supervisor,notes").order("field_shift").order("route").range(from, to)),
    ]);

    return NextResponse.json({ userId: user.id, syncedAt: new Date().toISOString(), sites, fuel, vehicles }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({ error: "Could not sync offline data. Please try again when connected." }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
