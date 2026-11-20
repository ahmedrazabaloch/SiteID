import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function contactWindow() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return hour >= 9 && hour < 21 ? "cluster-owner" : "night-on-caller";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const searchTerm = url.searchParams.get("siteId")?.trim();
    if (!searchTerm) return NextResponse.json({ error: "Enter a Site ID or mobile DG van number." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

    const { data: profile, error: profileError } = await supabase.from("profiles").select("is_active").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.is_active) return NextResponse.json({ error: "This account is inactive." }, { status: 403 });

    const { data: exactSite, error: siteError } = await supabase
      .from("site_master")
      .select("*")
      .eq("site_id", searchTerm)
      .maybeSingle();
    if (siteError) throw siteError;
    let site = exactSite;
    if (!site) {
      const vanMatch = searchTerm.match(/^(?:(?:mobile\s*)?dg\s*)?van\s*0?(\d{1,2})(?:\s*south[-\s]?1)?$/i);
      if (vanMatch) {
        const vanNumber = Number(vanMatch[1]);
        if (vanNumber >= 1 && vanNumber <= 10) {
          const canonicalVanId = `Mobile DG Van ${String(vanNumber).padStart(2, "0")} South-1`;
          const { data: vanSite, error: vanError } = await supabase
            .from("site_master")
            .select("*")
            .ilike("site_id", canonicalVanId)
            .maybeSingle();
          if (vanError) throw vanError;
          site = vanSite;
        }
      }
    }
    if (!site) return NextResponse.json({ error: `Site ID or mobile DG van ${searchTerm} was not found in Master Sites.` }, { status: 404 });

    const [{ data: current, error: currentError }, { data: vehicles, error: vehicleError }] = await Promise.all([
      supabase.from("site_latest").select("*").eq("site_id", site.site_id).maybeSingle(),
      supabase.from("route_vehicles").select("*"),
    ]);
    if (currentError) throw currentError;
    if (vehicleError) throw vehicleError;

    const selectedContact = contactWindow() === "cluster-owner"
      ? { label: "Cluster Owner", name: site.cluster_owner_name, phone: site.cluster_owner_phone }
      : { label: "Night On-Caller", name: site.night_on_caller_name, phone: site.night_on_caller_phone };

    return NextResponse.json({ site, current, vehicles: vehicles ?? [], contact: selectedContact });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
