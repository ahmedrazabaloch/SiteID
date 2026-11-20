"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, ToastProvider, useToast } from "@/components/toast-provider";
import { clearOfflineSnapshot, findOfflineSite, isOfflineSnapshotFresh, readOfflineSnapshot, saveOfflineSnapshot, type OfflineSnapshot } from "@/lib/offline-cache";

const AdminSection = dynamic(() => import("@/components/admin-section").then((module) => module.AdminSection), {
  ssr: false,
  loading: () => <div className="card card-pad">Loading section…</div>,
});

type Profile = { id: string; name: string; role: string; shift: string; email: string };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
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
  const [result, setResult] = useState<SiteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [offlineSyncedAt, setOfflineSyncedAt] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    let active = true;
    const syncOfflineData = async (force = false) => {
      if (!navigator.onLine) return;
      try {
        const saved = await readOfflineSnapshot(profile.id);
        if (saved && !force && Date.now() - Date.parse(saved.syncedAt) < 4 * 60 * 60 * 1000) {
          if (active) setOfflineSyncedAt(saved.syncedAt);
          return;
        }
        const response = await fetch("/api/offline-data", { cache: "no-store" });
        if (!response.ok) return;
        const snapshot = await response.json() as OfflineSnapshot;
        await saveOfflineSnapshot(snapshot);
        if (active) setOfflineSyncedAt(snapshot.syncedAt);
      } catch {
        // Offline caching is optional until one full sync has completed.
      }
    };
    const updateNetwork = () => {
      if (active) setNetworkOnline(navigator.onLine);
      if (navigator.onLine) void syncOfflineData(true);
    };
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    const handleInstall = (event: Event) => {
      event.preventDefault();
      if (event instanceof Event) setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstall);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Read current browser connectivity and cached sync state after mount.
    setNetworkOnline(navigator.onLine);
    void readOfflineSnapshot(profile.id).then((snapshot) => {
      if (active && snapshot) setOfflineSyncedAt(snapshot.syncedAt);
    }).catch(() => undefined);
    void syncOfflineData();
    return () => {
      active = false;
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      window.removeEventListener("beforeinstallprompt", handleInstall);
    };
  }, [profile.id]);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setBusy(true);
    try {
      if (!navigator.onLine) {
        const snapshot = await readOfflineSnapshot(profile.id);
        if (!snapshot || !isOfflineSnapshotFresh(snapshot)) {
          notify("Offline site data is not synced or has expired. Connect to the internet and reopen Search ID to sync.", "warning");
          return;
        }
        const cachedResult = findOfflineSite(snapshot, siteId);
        if (!cachedResult) {
          notify(`Site or mobile DG van ${siteId.trim()} was not found in the offline data.`, "warning");
          return;
        }
        setResult(cachedResult);
        notify(`Offline result · synced ${new Date(snapshot.syncedAt).toLocaleString()}.`, "info");
        return;
      }
      const response = await fetch(`/api/site-lookup?siteId=${encodeURIComponent(siteId.trim())}`);
      const body = await response.json().catch(() => null) as ({ error?: string } & SiteResult) | null;
      if (response.status === 404) { notify(body?.error || `Site ID ${siteId.trim()} was not found in Master Sites.`, "warning"); return; }
      if (!response.ok) throw new Error(body?.error || "We could not look up this site. Please try again.");
      if (!body) throw new Error("The lookup returned an empty response. Please try again.");
      setResult(body as SiteResult);
      notify("Site details loaded.", "success");
    } catch (cause) {
      if (cause instanceof TypeError) {
        try {
          const snapshot = await readOfflineSnapshot(profile.id);
          if (snapshot && isOfflineSnapshotFresh(snapshot)) {
            const cachedResult = findOfflineSite(snapshot, siteId);
            if (cachedResult) {
              setResult(cachedResult);
              notify(`Offline result · synced ${new Date(snapshot.syncedAt).toLocaleString()}.`, "info");
              return;
            }
          }
        } catch { /* Fall through to the standard network error toast. */ }
      }
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
    const shiftVehicles = result?.vehicles?.filter((vehicle) => vehicle.field_shift === shift) ?? [];
    if (f1Zone === "northkarachi" && shift === "day") {
      const northKarachiAssignment = shiftVehicles.find((vehicle) => normalizeArea(vehicle.route) === "northkarachi");
      if (northKarachiAssignment) return northKarachiAssignment;
      const northNazimabadAssignment = shiftVehicles.find((vehicle) => String(vehicle.route ?? "").split("&").map(normalizeArea).includes("northnazimabad"));
      if (northNazimabadAssignment) return northNazimabadAssignment;
    }
    if (f1Zone === "northkarachi" && shift === "night") {
      const northNazimabadAndGulshanAssignment = shiftVehicles.find((vehicle) => {
        const areas = String(vehicle.route ?? "").split("&").map(normalizeArea);
        return areas.includes("northnazimabad") && areas.includes("gulshan");
      });
      if (northNazimabadAndGulshanAssignment) return northNazimabadAndGulshanAssignment;
    }
    return shiftVehicles.find((vehicle) => {
      const assignedAreas = String(vehicle.route ?? "").split("&").map(normalizeArea);
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
      try { await clearOfflineSnapshot(profile.id); } catch { /* Continue with sign out even if local cleanup fails. */ }
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.reload();
    } catch (cause) { notify(friendlyError(cause, "Could not sign out. Please try again."), "error"); }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <div className="shell app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><TowerIcon /></span><span><strong className="brand-name">Search ID</strong><small className="brand-sub">Tower Operations</small></span></div>
        <div className="nav-caption">Operations</div>
        <nav className="nav" aria-label="Workspace">
          {visibleNav.map((item) => <button key={item.id} className={section === item.id ? "nav-link active" : "nav-link"} onClick={() => setSection(item.id)}><AppIcon name={item.icon} /><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-spacer" />
        <Link className="sidebar-download-link" href="/download"><AppIcon name="download" /><span>Download Android app</span></Link>
        <div className="sidebar-note"><strong>Karachi tower operations</strong><span>Site data, fuel records and field-team assignments in one workspace.</span></div>
        <button className="sidebar-profile" onClick={() => setSection("profile")}><span className="avatar">{displayName.trim().slice(0, 1).toUpperCase() || "U"}</span><span><span className="profile-name">{displayName}</span><span className="profile-role">{profile.role.replaceAll("_", " ")}</span></span><AppIcon name="chevron" /></button>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumbs"><span>Search ID</span><span className="crumb-dot" /><strong>{sectionLabel(section)}</strong></div>
          <div className="top-actions">{installPrompt && <button className="install-app-button" onClick={() => void installApp()}>Install app</button>}<div className={networkOnline ? "connectivity-label" : "connectivity-label is-offline"}><span />{networkOnline ? offlineSyncedAt ? "Offline data ready" : "Online · syncing" : "Offline mode"}</div><button className="account-trigger" onClick={() => setSection("profile")}><span className="avatar">{displayName.trim().slice(0, 1).toUpperCase() || "U"}</span><span className="account-name">{displayName}</span><AppIcon name="chevron" /></button></div>
        </header>
        <div className="content">{!networkOnline && <div className="offline-notice"><strong>Offline mode</strong><span>Lookups use this device’s saved copy from {offlineSyncedAt ? new Date(offlineSyncedAt).toLocaleString() : "the last successful sync"}. Changes will not sync until you reconnect.</span></div>}{section === "profile" ? <ProfilePanel profile={{ ...profile, name: displayName }} onNameSaved={setDisplayName} onSignOut={signOut} /> : section === "lookup" ? (
            <>
              <div className="card search-card"><form className="lookup-form search-grid" onSubmit={lookup}>
                <label>Site ID or mobile DG van<input value={siteId} onChange={(event) => setSiteId(event.target.value)} placeholder="e.g. 112 or Van 07" required /></label>
                <label>Requested fuel (L)<input value={litres} onChange={(event) => setLitres(event.target.value)} inputMode="decimal" placeholder="e.g. 120" /></label>
                <button className="btn btn-primary" disabled={busy}>{busy ? "Finding site…" : <><AppIcon name="search" />Find site</>}</button>
              </form><p className="search-helper">Search by Site ID or type a mobile DG van number, such as Van 01–10. Requested fuel can be left blank.</p></div>
              {result && (
                <section className="result-panel">
                  <div className="lookup-grid">
                    <section className="card"><div className="card-header"><div><div className="card-title"><AppIcon name="site" />Site details</div><div className="card-subtitle">Location, field crews and client contacts</div></div><span className="pill pill-gray site-id-badge">ID {String(site.site_id ?? "")}</span></div><div className="site-detail-list info-list">
                      <DetailRow icon="pin" label="Site address" value={[site.address, site.site_area].filter(Boolean).join(", ") || "Address not set"} />
                      <DetailRow icon="route" label="F1 zone" value={String(site.f1_zone ?? "Not set")} />
                      <div className="crew-detail-grid">
                        <CrewDetail shift="Day" vehicle={dayVehicle} fallback="Not assigned" />
                        <CrewDetail shift="Night" vehicle={nightVehicle} fallback={f1Zone === "northkarachi" ? "No Night vehicle assigned" : "Not assigned"} />
                      </div>
                      <div className="contact-detail-grid contact-grid-three">
                        <DetailRow icon="user" label="Cluster Owner" value={contactValue(site.cluster_owner_name, site.cluster_owner_phone)} />
                        <DetailRow icon="user" label="Night On-Caller" value={contactValue(site.night_on_caller_name, site.night_on_caller_phone)} />
                        <DetailRow icon="people" label="I-Engineering lead" value={contactValue(site.ie_lead_name, site.ie_lead_phone, "N/A")} />
                      </div>
                      <div className="contact-detail-grid contact-grid-two">
                      <DetailRow icon="people" label="Zong lead" value={contactValue(site.zong_lead_name, site.zong_lead_phone, "N/A")} />
                      <DetailRow icon="people" label="Security SO" value={contactValue(site.security_so_name, site.security_so_phone)} />
                      </div>
                      <div className="site-additional-notes"><span className="info-icon"><AppIcon name="message" /></span><div><span className="info-label">Additional Notes</span><p className="info-value">{String(site.other_notes ?? "").trim() || "No additional notes provided."}</p></div></div>
                    </div></section>
                    <section className="card"><div className="card-header"><div><div className="card-title"><AppIcon name="fuel" />Last fueling</div><div className="card-subtitle">Most recent recorded generator fueling</div></div><span className="pill pill-gray fuel-date-badge">{formatFuelingDate(current.fueling_date)}</span></div><div className="last-fueling fuel-card-body">
                      <Value label="Fueling date" value={formatFuelingDate(current.fueling_date)} />
                      <Value label="Available fuel" value={formatValue(current.available_fuel, " L")} />
                      <Value label="Fuel poured" value={formatValue(current.fuel_poured, " L")} />
                      <Value label="Total fuel" value={formatValue(current.total_fuel, " L")} />
                      <Value label="DG meter status" value={meterLabel(current.dg_meter_status)} />
                      <Value label="Previous reading" value={formatReading(current.previous_reading)} />
                      <Value label="Current reading" value={formatReading(current.current_reading)} />
                      <Value label="Running hours" value={formatValue(current.running_hours, " h")} />
                      <Value label="Average consumption" value={formatValue(current.average_consumption, " L/h")} highlight />
                    </div></section>
                  </div>
                  <div className="message-section card forward-card"><div className="message-head forward-head"><div><h3 className="section-title forward-title"><AppIcon name="message" />Prepare fuel request</h3><p className="muted forward-sub">Review, copy and paste this request into WhatsApp manually.</p></div>
                    <label>Team to notify<select value={targetShift} onChange={(event) => setTargetShift(event.target.value as "day" | "night")}><option value="day">Day team</option><option value="night">Night team</option></select></label>
                  </div>
                    <div className="message-preview forward-body"><pre>{message}</pre><button type="button" className="btn btn-secondary copy-button" onClick={copyMessage}><AppIcon name="copy" />Copy message</button></div>
                  </div>
                </section>
              )}
            </>
          ) : <AdminSection section={section} />}</div>
        <footer className="app-attribution">Designed &amp; developed by <a href="https://www.linkedin.com/in/ahmedrazabaloch" target="_blank" rel="noreferrer">Ahmed Raza</a></footer>
      </main>
      <nav className="mobile-bottom-nav" aria-label="Workspace">
        {visibleNav.map((item) => <button key={item.id} className={section === item.id ? "mobile-active" : ""} onClick={() => setSection(item.id)}><AppIcon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
    </div>
  );
}

function sectionLabel(section: Section) {
  return navItems.find((item) => item.id === section)?.label ?? "My profile";
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
    <div className="profile-page-actions"><button className="btn btn-secondary" onClick={onSignOut}>Sign out</button></div>
    <div className="profile-layout">
      <section className="card profile-summary"><div className="profile-identity"><span className="profile-avatar-large">{profile.name.trim().slice(0, 1).toUpperCase() || "U"}</span><div><h2>{profile.name}</h2><p>{profile.role.replaceAll("_", " ")} · Search ID</p></div></div><div className="profile-kv"><span>Login ID</span><strong>{profile.email}</strong></div><div className="profile-kv"><span>Account role</span><strong>{profile.role.replaceAll("_", " ")}</strong></div><div className="profile-kv"><span>Account status</span><strong><span className="pill pill-green">Active</span></strong></div><div className="security-hint">Your permissions are managed through your assigned account role.</div></section>
      <div className="profile-settings-stack">
        <form className="card profile-form-card" onSubmit={saveName}><div className="card-title"><AppIcon name="user" />Personal details</div><div className="card-subtitle">Update the name displayed in the Search ID workspace.</div><div className="form-grid" style={{ marginTop: 17 }}><label className="field field-full">Display name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label><div><button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save changes"}</button></div></div></form>
        <form className="card profile-form-card" onSubmit={savePassword}><div className="card-title"><AppIcon name="user" />Change password</div><div className="card-subtitle">Use at least 8 characters for your new password.</div><div className="form-grid" style={{ marginTop: 17 }}><label className="field">New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label><label className="field">Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} /></label><div className="field-full"><button className="btn btn-primary" disabled={busy}>{busy ? "Updating…" : "Update password"}</button></div></div></form>
      </div>
    </div>
  </section>;
}

function Value({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div className={highlight ? "data-value reading-row average-value" : "data-value reading-row"}><span className="data-label">{label}</span><strong>{value || "N/A"}</strong></div>;
}
function formatValue(value: unknown, suffix = "") {
  if (value === null || value === undefined || value === "") return "N/A";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(numeric)}${suffix}` : String(value);
}
function formatReading(value: unknown) {
  if (value === null || value === undefined || value === "") return "N/A";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, useGrouping: false }).format(numeric) : String(value);
}
function formatFuelingDate(value: unknown) {
  if (value === null || value === undefined || value === "") return "N/A";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const [, year, month, day] = match;
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return `${Number(day)}-${monthNames[Number(month) - 1]}-${year}`;
}
function contactValue(name: unknown, phone: unknown, fallback = "Not provided") {
  const parts = [name, phone].map((value) => {
    if (value && typeof value === "object") {
      const cell = value as { text?: unknown; result?: unknown; richText?: { text?: unknown }[] };
      if (typeof cell.text === "string") value = cell.text;
      else if (cell.result !== undefined && (typeof cell.result === "string" || typeof cell.result === "number")) value = cell.result;
      else if (cell.richText) value = cell.richText.map((part) => typeof part.text === "string" ? part.text : "").join("");
      else return "";
    }
    const text = String(value ?? "").trim();
    return /^\[object object\]$/i.test(text) ? "" : text;
  }).filter(Boolean);
  return parts.join(" / ") || fallback;
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
  return <div className="detail-row info-row"><span className="info-icon"><AppIcon name={icon} /></span><div><span className="info-label">{label}</span><span className="info-value">{value || "Not provided"}</span></div></div>;
}

function CrewDetail({ shift, vehicle, fallback }: { shift: "Day" | "Night"; vehicle?: Record<string, unknown>; fallback: string }) {
  return <div className="detail-row info-row crew-detail"><span className="info-icon"><AppIcon name="vehicle" /></span><div><span className="info-label">{shift} Vehicle Crew</span>{vehicle
    ? <span className="info-value">Driver: <strong>{String(vehicle.driver || "Not set")}</strong> · Supervisor: <strong>{String(vehicle.fueler_supervisor || "Not set")}</strong></span>
    : <span className="info-value">{fallback}</span>}</div></div>;
}

function TowerIcon() { return <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7 11 34m9-27 9 27M14 25h12M16 19h8M18 13h4M13 34h14"/><path d="M16 7a5.7 5.7 0 0 1 8 0M12.5 3.5a10.6 10.6 0 0 1 15 0"/></svg>; }

type IconName = "search" | "site" | "fuel" | "vehicle" | "people" | "user" | "message" | "copy" | "chevron" | "pin" | "route" | "menu" | "close" | "download";
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
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  };
  return <svg className={`icon icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
