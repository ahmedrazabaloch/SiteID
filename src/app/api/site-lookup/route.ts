import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function contactWindow() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return hour >= 9 && hour < 21 ? "cluster-owner" : "night-on-caller";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = url.searchParams.get("siteId")?.trim();
    if (!siteId) return NextResponse.json({ error: "Enter a Site ID." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

    const { data: site, error: siteError } = await supabase
      .from("site_master")
      .select("*")
      .eq("site_id", siteId)
      .maybeSingle();
    if (siteError) throw siteError;
    if (!site) return NextResponse.json({ error: `Site ID ${siteId} was not found in Master Sites.` }, { status: 404 });

    const [{ data: current, error: currentError }, { data: vehicles, error: vehicleError }] = await Promise.all([
      supabase.from("site_latest").select("*").eq("site_id", siteId).maybeSingle(),
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
