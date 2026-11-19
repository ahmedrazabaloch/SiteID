"use client";

import { FormEvent, ReactNode, useState } from "react";
import { AdminSection } from "@/components/admin-section";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, ToastProvider, useToast } from "@/components/toast-provider";

type Profile = { name: string; role: string; shift: string; email: string };
type SiteResult = {
  site: Record<string, unknown>;
  current: Record<string, unknown> | null;
  contact: { label: string; name: string | null; phone: string | null };
  vehicles: Record<string, unknown>[];
};
type Section = "lookup" | "master" | "daily" | "vehicles" | "roster" | "profile";

const navItems: { id: Section; label: string; icon: IconName; admin?: boolean; superAdminOnly?: boolean }[] = [
  { id: "lookup", label: "Complaint lookup", icon: "search" },
  { id: "master", label: "Master sites", icon: "site", admin: true },
  { id: "daily", label: "Daily fueling", icon: "fuel", admin: true },
  { id: "vehicles", label: "Route vehicles", icon: "vehicle", admin: true },
  { id: "roster", label: "Users & access", icon: "people", admin: true, superAdminOnly: true },
  { id: "profile", label: "My profile", icon: "user" },
];

export function DashboardShell({ profile }: { profile: Profile }) {
  return <ToastProvider><DashboardContent profile={profile} /></ToastProvider>;
}

function DashboardContent({ profile }: { profile: Profile }) {
  const notify = useToast();
  const isAdmin = profile.role === "admin" || profile.role === "super_admin";
  const isSuperAdmin = profile.role === "super_admin";
  const visibleNav = navItems.filter((item) => item.id !== "profile" && (!item.admin || isAdmin) && (!item.superAdminOnly || isSuperAdmin));
  const [displayName, setDisplayName] = useState(profile.name);
  const [section, setSection] = useState<Section>("lookup");
  const [siteId, setSiteId] = useState("");
  const [litres, setLitres] = useState("");
  const [targetShift, setTargetShift] = useState<"day" | "night">("day");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [result, setResult] = useState<SiteResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/site-lookup?siteId=${encodeURIComponent(siteId.trim())}`);
      const body = await response.json().catch(() => null) as ({ error?: string } & SiteResult) | null;
      if (response.status === 404) { notify(body?.error || `Site ID ${siteId.trim()} was not found in Master Sites.`, "warning"); return; }
      if (!response.ok) throw new Error(body?.error || "We could not look up this site. Please try again.");
      if (!body) throw new Error("The lookup returned an empty response. Please try again.");
      setResult(body as SiteResult);
      notify("Site details loaded.", "success");
    } catch (cause) {
      notify(friendlyError(cause, "We could not look up this site. Please try again."), "error");
    } finally {
      setBusy(false);
    }
  }

  const site = result?.site ?? {};
  const current = result?.current ?? {};
  const siteArea = normalizeArea(site.site_area);
  const f1Zone = normalizeArea(site.f1_zone);
  function assignedVehicle(shift: "day" | "night") {
    const savedRoute = String(site[shift === "day" ? "day_route" : "night_route"] ?? "");
    return result?.vehicles?.find((vehicle) => {
      if (vehicle.field_shift !== shift) return false;
      const assignedAreas = String(vehicle.route ?? "").split("&").map(normalizeArea);
      if (f1Zone === "northkarachi") return shift === "day" && assignedAreas.includes("northnazimabad");
      return (f1Zone && assignedAreas.includes(f1Zone)) || normalizeArea(vehicle.route) === normalizeArea(savedRoute) || assignedAreas.includes(siteArea);
    });
  }
  const dayVehicle = assignedVehicle("day");
  const nightVehicle = assignedVehicle("night");
  const activeVehicle = targetShift === "day" ? dayVehicle : nightVehicle;
  const routeFor = (shift: "day" | "night", vehicle: Record<string, unknown> | undefined) => {
    const saved = String(site[shift === "day" ? "day_route" : "night_route"] ?? "");
    if (saved) return saved;
    if (!vehicle && shift === "night" && f1Zone === "northkarachi") return "No vehicle assigned";
    return String(vehicle?.route ?? site.f1_zone ?? "Route not set");
  };
  const teamFor = (shift: "day" | "night", vehicle: Record<string, unknown> | undefined) =>
    String(site[shift === "day" ? "day_team" : "night_team"] || vehicle?.team || vehicle?.route || "Not assigned");
  const route = routeFor(targetShift, activeVehicle);
  const crewLabel = (vehicle: Record<string, unknown> | undefined, shift: "day" | "night") => vehicle
    ? String(vehicle.vehicle_number ?? "Vehicle") + " · Driver: " + String(vehicle.driver || "Not set") + " · Supervisor: " + String(vehicle.fueler_supervisor || "Not set")
    : shift === "night" && f1Zone === "northkarachi" ? "No Night vehicle assigned" : "Not assigned";
  const dayTeam = teamFor("day", dayVehicle);
  const nightTeam = teamFor("night", nightVehicle);
  const message = result
    ? [
        `Fuel Request — Site ${String(site.site_id ?? siteId)}`,
        `Requested fuel: ${litres.trim() ? `${litres.trim()} L` : "[L]"}`,
        "FormulaOne team: " + (targetShift === "day" ? dayTeam : nightTeam),
        `Route: ${route}`,
        "Day team: " + dayTeam,
        "Night team: " + nightTeam,
        `${result.contact.label}: ${result.contact.name ?? "Not set"}${result.contact.phone ? ` / ${result.contact.phone}` : ""}`,
      ].join("\n")
    : "";

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      notify("Request copied. Paste it into the FormulaOne WhatsApp group.", "success");
    } catch {
      notify("Clipboard access was blocked. Select and copy the request text manually.", "warning");
    }
  }

  async function signOut() {
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.reload();
    } catch (cause) { notify(friendlyError(cause, "Could not sign out. Please try again."), "error"); }
  }

  return (
    <div className="app-frame">
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-brand"><span className="drop-mark"><DropIcon /></span><span><strong>Fuel Ops</strong><small>Tower Operations</small></span></div>
          <nav className="sidebar-nav" aria-label="Workspace">
            {visibleNav.map((item) => <button key={item.id} className={section === item.id ? "nav-item active" : "nav-item"} onClick={() => setSection(item.id)}><AppIcon name={item.icon} /><span>{item.label}</span></button>)}
          </nav>
        </aside>
        <main className="content">
          <header className="workspace-bar">
            <div className="mobile-brand"><span className="drop-mark"><DropIcon /></span><span><strong>Fuel Ops</strong><small>Tower Operations</small></span></div>
            <button className="mobile-menu-button" onClick={() => setMobileMenuOpen((open) => !open)} aria-expanded={mobileMenuOpen} aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}><AppIcon name={mobileMenuOpen ? "close" : "menu"} /></button>
            <div className="top-meta"><button className="account-trigger" onClick={() => setSection("profile")} aria-label="Open profile"><span className="avatar-mark">{displayName.trim().slice(0, 1).toUpperCase() || "U"}</span></button></div>
          </header>
          {mobileMenuOpen && <nav className="mobile-nav" aria-label="Workspace">{visibleNav.map((item) => <button key={item.id} className={section === item.id ? "mobile-active" : ""} onClick={() => { setSection(item.id); setMobileMenuOpen(false); }}><AppIcon name={item.icon} />{item.label}</button>)}<button onClick={() => { setSection("profile"); setMobileMenuOpen(false); }}><AppIcon name="user" />My profile</button></nav>}
          <div className="workspace-content">{section === "profile" ? <ProfilePanel profile={{ ...profile, name: displayName }} onNameSaved={setDisplayName} onSignOut={signOut} /> : section === "lookup" ? (
            <>
              <div className="page-heading"><div><h1>Complaint lookup</h1><p className="muted">Find a site and prepare a fuel request for your team.</p></div></div>
              <form className="lookup-form" onSubmit={lookup}>
                <label>Site ID<input value={siteId} onChange={(event) => setSiteId(event.target.value)} inputMode="numeric" placeholder="e.g. 112" required /></label>
                <label>Requested fuel (L)<input value={litres} onChange={(event) => setLitres(event.target.value)} inputMode="decimal" placeholder="e.g. 120" /></label>
                <button className="primary-button" disabled={busy}>{busy ? "Finding site…" : <><AppIcon name="search" />Find site</>}</button>
              </form>
              {result && (
                <section className="result-panel">
                  <div className="result-grid">
                    <section className="data-section"><h3 className="section-title"><AppIcon name="site" />Site details · {String(site.site_id ?? "")}</h3><div className="site-detail-list">
                      <DetailRow icon="pin" label="Site address" value={[site.address, site.site_area].filter(Boolean).join(", ") || "Address not set"} />
                      <DetailRow icon="route" label="F1 zone" value={String(site.f1_zone ?? "Not set")} />
                      <DetailRow icon="vehicle" label="Day vehicle crew" value={crewLabel(dayVehicle, "day")} />
                      <DetailRow icon="vehicle" label="Night vehicle crew" value={crewLabel(nightVehicle, "night")} />
                      <DetailRow icon="route" label="Routing details" value={"Day · " + routeFor("day", dayVehicle) + "  /  Night · " + routeFor("night", nightVehicle)} />
                      <DetailRow icon="people" label="FormulaOne teams" value={"Day · " + dayTeam + "  /  Night · " + nightTeam} />
                      <DetailRow icon="user" label="Cluster Owner" value={contactValue(site.cluster_owner_name, site.cluster_owner_phone)} />
                      <DetailRow icon="user" label="Night On-Caller" value={contactValue(site.night_on_caller_name, site.night_on_caller_phone)} />
                      <DetailRow icon="people" label="I-Engineering lead" value={contactValue(site.ie_lead_name, site.ie_lead_phone)} />
                      <DetailRow icon="people" label="Zong lead" value={contactValue(site.zong_lead_name, site.zong_lead_phone)} />
                      <DetailRow icon="people" label="Security SO" value={contactValue(site.security_so_name, site.security_so_phone)} />
                    </div></section>
                    <section className="data-section"><h3 className="section-title"><AppIcon name="fuel" />Last fueling</h3><div className="last-fueling">
                      <Value label="Available fuel" value={formatValue(current.available_fuel, " L")} />
                      <Value label="Fuel poured" value={formatValue(current.fuel_poured, " L")} />
                      <Value label="Total fuel" value={formatValue(current.total_fuel, " L")} />
                      <Value label="DG meter status" value={meterLabel(current.dg_meter_status)} />
                      <Value label="Previous reading" value={formatValue(current.previous_reading)} />
                      <Value label="Current reading" value={formatValue(current.current_reading)} />
                      <Value label="Running hours" value={formatValue(current.running_hours, " h")} />
                      <Value label="Average consumption" value={formatValue(current.average_consumption, " L/h")} highlight />
                    </div></section>
                  </div>
                  <div className="message-section"><div className="message-head"><div><h3 className="section-title"><AppIcon name="message" />Forward to FormulaOne team</h3><p className="muted">Review the request before sharing it in WhatsApp.</p></div>
                    <label>Team to notify<select value={targetShift} onChange={(event) => setTargetShift(event.target.value as "day" | "night")}><option value="day">Day team</option><option value="night">Night team</option></select></label>
                  </div>
                    <div className="message-preview"><pre>{message}</pre><button type="button" className="secondary-button copy-button" onClick={copyMessage}><AppIcon name="copy" />Copy</button></div>
                  </div>
                </section>
              )}
            </>
          ) : <AdminSection section={section} />}</div>
        </main>
      </div>
    </div>
  );
}

function ProfilePanel({ profile, onNameSaved, onSignOut }: { profile: Profile; onNameSaved: (name: string) => void; onSignOut: () => void }) {
  const notify = useToast();
  const [name, setName] = useState(profile.name);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { notify("Enter a display name before saving.", "warning"); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("update_my_profile", { p_full_name: name.trim() });
      if (rpcError) throw rpcError;
      onNameSaved(name.trim());
      notify("Your name has been updated.", "success");
    } catch (cause) { notify(friendlyError(cause, "Could not save your name. Please try again."), "error"); }
    finally { setBusy(false); }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) { notify("Use a password with at least 8 characters.", "warning"); return; }
    if (password !== confirmPassword) { notify("The passwords do not match.", "warning"); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword(""); setConfirmPassword(""); notify("Your password has been updated.", "success");
    } catch (cause) { notify(friendlyError(cause, "Could not update your password. Please try again."), "error"); }
    finally { setBusy(false); }
  }

  return <section className="profile-page">
    <div className="profile-hero"><span className="avatar-large">{profile.name.trim().slice(0, 1).toUpperCase() || "U"}</span><div><h1>My profile</h1><p>Login ID: {profile.email} <span className="role-chip">{profile.role.replaceAll("_", " ")}</span></p></div><button className="quiet-button profile-signout" onClick={onSignOut}>Sign out</button></div>
    <div className="profile-cards">
      <form className="profile-card" onSubmit={saveName}><div><h2>Profile details</h2><p className="muted">Your name appears in the app header and staff list.</p></div><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label><button className="primary-button" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save name"}</button></form>
      <form className="profile-card" onSubmit={savePassword}><div><h2>Change password</h2><p className="muted">Use at least 8 characters for your new password.</p></div><label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} /></label><button className="primary-button" disabled={busy}>{busy ? "Updating…" : "Update password"}</button></form>
    </div>
  </section>;
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
  return [name, phone].filter(Boolean).join(" / ") || "Not provided";
}

function normalizeArea(value: unknown) {
  const normalized = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "northn" ? "northnazimabad" : normalized;
}

function meterLabel(value: unknown) {
  const labels: Record<string, string> = { working: "Working", faulty: "Faulty", replaced: "Replaced", missing: "No meter", suspected: "Needs review", unknown: "N/A" };
  return value ? labels[String(value)] ?? String(value) : "N/A";
}

function DetailRow({ icon, label, value }: { icon: "pin" | "route" | "people" | "user" | "vehicle"; label: string; value: string }) {
  return <div className="detail-row"><AppIcon name={icon} /><div><strong>{label}</strong><span>{value || "Not provided"}</span></div></div>;
}

function DropIcon() { return <svg viewBox="0 0 32 40" aria-hidden="true"><path d="M16 1.8C13 8.2 3.4 17.6 3.4 25.2A12.6 12.6 0 0 0 28.6 25C28.6 17.6 19 8.2 16 1.8Z" fill="currentColor"/><path d="M10.2 26a6.1 6.1 0 0 0 6.1 6.1" fill="none" stroke="#123b36" strokeWidth="2.3" strokeLinecap="round"/></svg>; }

type IconName = "search" | "site" | "fuel" | "vehicle" | "people" | "user" | "message" | "copy" | "chevron" | "pin" | "route" | "menu" | "close";
function AppIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.2" /><path d="m15.5 15.5 4.2 4.2" /></>,
    site: <><path d="M4 20h16M6.5 20V8l5.5-4 5.5 4v12M9 10h1m4 0h1m-6 4h1m4 0h1m-4 6v-3h2v3" /></>,
    fuel: <><path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M4 21h13M7 7h7M7 11h7M17 8h1.5l2 2v7a2 2 0 0 1-4 0v-4" /></>,
    vehicle: <><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" /><circle cx="7" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1a5.5 5.5 0 0 1 11 0v1M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4V20" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
    message: <><path d="M4 5.5h16v12H9l-5 3z" /><path d="M8 10h8M8 13.5h5" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    route: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h5a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h5"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };
  return <svg className={`icon icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
