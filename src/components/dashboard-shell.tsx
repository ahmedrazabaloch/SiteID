"use client";

import { FormEvent, useMemo, useState } from "react";
import { AdminSection } from "@/components/admin-section";
import { createClient } from "@/lib/supabase/client";

type Profile = { name: string; role: string; shift: string };
type SiteResult = {
  site: Record<string, unknown>;
  current: Record<string, unknown> | null;
  contact: { label: string; name: string | null; phone: string | null };
  vehicles: Record<string, unknown>[];
};
type Section = "lookup" | "daily" | "master" | "vehicles" | "roster";

const navItems: { id: Section; label: string; admin?: boolean }[] = [
  { id: "lookup", label: "Site lookup" },
  { id: "daily", label: "Daily import", admin: true },
  { id: "master", label: "Master sites", admin: true },
  { id: "vehicles", label: "Route vehicles", admin: true },
  { id: "roster", label: "Duty roster", admin: true },
];

export function DashboardShell({ profile }: { profile: Profile }) {
  const isAdmin = profile.role === "admin";
  const [section, setSection] = useState<Section>("lookup");
  const [siteId, setSiteId] = useState("");
  const [litres, setLitres] = useState("");
  const [targetShift, setTargetShift] = useState<"day" | "night">("day");
  const [result, setResult] = useState<SiteResult | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const shiftLabel = useMemo(() => ({ day: "Day · 08:00-16:00", evening: "Evening · 16:00-00:00", night: "Night · 00:00-08:00" }[profile.shift] ?? "Day · 08:00-16:00"), [profile.shift]);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setResult(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/site-lookup?siteId=${encodeURIComponent(siteId.trim())}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Site lookup failed.");
      setResult(body as SiteResult);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Site lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  const site = result?.site ?? {};
  const current = result?.current ?? {};
  const route = String(site[targetShift === "day" ? "day_route" : "night_route"] ?? "Route not set");
  const team = String(site[targetShift === "day" ? "day_team" : "night_team"] ?? "Team not set");
  const activeVehicle = result?.vehicles?.find((vehicle) => vehicle.route === route && vehicle.field_shift === targetShift);
  const message = result
    ? [
        `Fuel Request - Site ${String(site.site_id ?? siteId)}`,
        `Requested Fuel: ${litres || "[L]"} L`,
        `FormulaOne Team: ${team}`,
        `Route: ${route}`,
        `Day Team: ${String(site.day_team ?? "Not set")}`,
        `Night Team: ${String(site.night_team ?? "Not set")}`,
        `${result.contact.label}: ${result.contact.name ?? "Not set"}${result.contact.phone ? ` / ${result.contact.phone}` : ""}`,
      ].join("\n")
    : "";

  async function copyMessage() {
    await navigator.clipboard.writeText(message);
    setNotice("Forward message copied. WhatsApp mein FormulaOne group select karke paste karein.");
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand"><span className="brand-mark small">F1</span><span>Fuel Ops</span></div>
        <div className="top-meta"><span>Karachi</span><span className="shift-pill">Duty: {shiftLabel}</span><span className="user-name">{profile.name}</span><button className="quiet-button" onClick={signOut}>Sign out</button></div>
      </header>
      <div className="mobile-nav" aria-label="Navigation">
        {navItems.filter((item) => !item.admin || isAdmin).map((item) => <button key={item.id} className={section === item.id ? "mobile-active" : ""} onClick={() => setSection(item.id)}>{item.label}</button>)}
      </div>
      <div className="layout">
        <aside className="sidebar">
          <p className="nav-caption">WORKSPACE</p>
          {navItems.filter((item) => !item.admin || isAdmin).map((item) => <button key={item.id} className={section === item.id ? "nav-item active" : "nav-item"} onClick={() => setSection(item.id)}>{item.label}</button>)}
          <p className="sidebar-note">{isAdmin ? "Admin access: import and edit operations data." : "Lookup access: view site details and prepare a forward."}</p>
        </aside>
        <main className="content">
          {section === "lookup" ? (
            <>
              <div className="page-heading"><div><p className="eyebrow">OPERATIONS</p><h1>Complaint lookup</h1><p className="muted">Site ID dalo, team aur last fueling details dekho.</p></div></div>
              <form className="lookup-form" onSubmit={lookup}>
                <label>Site ID<input value={siteId} onChange={(event) => setSiteId(event.target.value)} inputMode="numeric" placeholder="e.g. 112" required /></label>
                <label>Requested fuel (L)<input value={litres} onChange={(event) => setLitres(event.target.value)} inputMode="decimal" placeholder="e.g. 120" required /></label>
                <button className="primary-button" disabled={busy}>{busy ? "Searching..." : "Show site"}</button>
              </form>
              {notice && <p className="notice" role="status">{notice}</p>}
              {result && (
                <section className="result-panel">
                  <div className="site-heading"><div><p className="eyebrow">SITE {String(site.site_id ?? "")}</p><h2>{String(site.address ?? "Address not set")}</h2><p className="muted">{String(site.site_area ?? "")}</p></div><span className="status-pill">Lookup ready</span></div>
                  <div className="result-grid">
                    <section className="data-section"><h3>Fueling teams and contacts</h3><div className="data-grid">
                      <Value label="Day team / route" value={`${String(site.day_team ?? "Not set")} / ${String(site.day_route ?? "Not set")}`} />
                      <Value label="Night team / route" value={`${String(site.night_team ?? "Not set")} / ${String(site.night_route ?? "Not set")}`} />
                      <Value label="Cluster Owner" value={contactValue(site.cluster_owner_name, site.cluster_owner_phone)} />
                      <Value label="Night On-Caller" value={contactValue(site.night_on_caller_name, site.night_on_caller_phone)} />
                      <Value label="I-Engineering lead" value={contactValue(site.ie_lead_name, site.ie_lead_phone)} />
                      <Value label="Zong lead" value={contactValue(site.zong_lead_name, site.zong_lead_phone)} />
                      <Value label="Security SO" value={contactValue(site.security_so_name, site.security_so_phone)} />
                      <Value label="Vehicle" value={String(activeVehicle?.vehicle_number ?? "Not assigned")} />
                    </div></section>
                    <section className="data-section"><h3>Last Fueling</h3><div className="last-fueling">
                      <Value label="Available fuel" value={formatValue(current.available_fuel, " L")} />
                      <Value label="Fuel poured" value={formatValue(current.fuel_poured, " L")} />
                      <Value label="Total Fuel" value={formatValue(current.total_fuel, " L")} />
                      <Value label="DG meter status" value={String(current.dg_meter_status ?? "N/A")} />
                      <Value label="Previous reading" value={formatValue(current.previous_reading)} />
                      <Value label="Current Reading" value={formatValue(current.current_reading)} />
                      <Value label="Running Hours" value={formatValue(current.running_hours, " h")} />
                      <Value label="Average consumption" value={formatValue(current.average_consumption, " L/h")} highlight />
                    </div></section>
                  </div>
                  <div className="message-section"><div className="message-head"><div><h3>Forward to FormulaOne group</h3><p className="muted">Address aur Security SO message mein include nahi honge.</p></div>
                    <label>Team to notify<select value={targetShift} onChange={(event) => setTargetShift(event.target.value as "day" | "night")}><option value="day">Day team</option><option value="night">Night team</option></select></label>
                  </div>
                    <pre className="message-preview">{message}</pre>
                    <div className="button-row"><button type="button" className="primary-button" onClick={copyMessage}>Copy message</button><a className="secondary-button" href="https://wa.me/" target="_blank" rel="noreferrer">Open WhatsApp</a></div>
                  </div>
                </section>
              )}
            </>
          ) : <AdminSection section={section} />}
        </main>
      </div>
    </div>
  );
}

function Value({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div className={highlight ? "data-value average-value" : "data-value"}><span className="data-label">{label}</span><strong>{value || "N/A"}</strong></div>;
}
function formatValue(value: unknown, suffix = "") {
  if (value === null || value === undefined || value === "") return "N/A";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(numeric)}${suffix}` : String(value);
}
function contactValue(name: unknown, phone: unknown) {
  return [name, phone].filter(Boolean).join(" / ") || "Not set";
}