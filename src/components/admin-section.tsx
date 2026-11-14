"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Section = "daily" | "master" | "vehicles" | "roster";
type ImportPreview = { fileName?: string; rowCount?: number; errors?: { row: number; siteId: string; issue: string }[]; sample?: Record<string, string>[]; error?: string; imported?: number };
type ProfileRow = { id: string; full_name: string; role: string; operator_shift: string };

export function AdminSection({ section }: { section: Section }) {
  if (section === "daily" || section === "master") return <ImportPanel kind={section} />;
  if (section === "vehicles") return <VehiclePanel />;
  return <RosterPanel />;
}

function ImportPanel({ kind }: { kind: "daily" | "master" }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = kind === "daily" ? "/api/daily-import" : "/api/master-import";
  const title = kind === "daily" ? "Daily Update import" : "Master Sites import";
  const subtitle = kind === "daily"
    ? "Site ID se latest fueling values replace karein. Duplicate ya unknown Site IDs par import rukega."
    : "Site/team/access mapping load karein. Baad ke uploads par blank cells existing values ko clear nahi karenge.";

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    try {
      const response = await fetch(endpoint, { method: "POST", body: form });
      const body = await response.json() as ImportPreview;
      if (!response.ok) throw new Error(body.error || "Import failed");
      setPreview(body);
      if (mode === "commit") setFile(null);
    } catch (cause) {
      setPreview({ error: cause instanceof Error ? cause.message : "Import failed" });
    } finally {
      setBusy(false);
    }
  }

  return <section className="admin-placeholder">
    <p className="eyebrow">ADMIN</p><h1>{title}</h1><p className="muted">{subtitle}</p>
    <div className="admin-form">
      <label>Excel file<input type="file" accept=".xlsx,.xls" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label>
      <div className="button-row"><button className="primary-button" type="button" disabled={!file || busy} onClick={() => send("preview")}>{busy ? "Processing..." : "Preview file"}</button></div>
    </div>
    {preview?.error && <p className="error-text" role="alert">{preview.error}</p>}
    {preview && !preview.error && <div className="preview-box" aria-live="polite">
      <strong>{preview.fileName}</strong>
      <p>{preview.rowCount} rows ready · {preview.errors?.length ?? 0} issues</p>
      {!!preview.errors?.length && <ul>{preview.errors.map((error, index) => <li key={index}>Row {error.row} · Site {error.siteId}: {error.issue}</li>)}</ul>}
      {preview.sample?.length ? <pre>{JSON.stringify(preview.sample, null, 2)}</pre> : null}
      {preview.rowCount && !preview.errors?.length && <button className="primary-button" type="button" disabled={busy} onClick={() => send("commit")}>Confirm import</button>}
      {preview.imported !== undefined && <p className="success-text">{preview.imported} rows imported. Latest site values updated.</p>}
    </div>}
  </section>;
}

function VehiclePanel() {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        route: String(form.get("route") ?? "").trim(),
        field_shift: String(form.get("field_shift") ?? "day"),
        team: String(form.get("team") ?? "").trim(),
        vehicle_number: String(form.get("vehicle_number") ?? "").trim(),
        driver: String(form.get("driver") ?? "").trim(),
        fueler_supervisor: String(form.get("fueler_supervisor") ?? "").trim(),
        notes: String(form.get("notes") ?? "").trim(),
        updated_by: user?.id,
      };
      const { error } = await supabase.from("route_vehicles").upsert(row, { onConflict: "route,field_shift" });
      if (error) throw error;
      setNotice("Route vehicle assignment saved.");
      event.currentTarget.reset();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not save assignment.");
    } finally { setBusy(false); }
  }
  return <section className="admin-placeholder"><p className="eyebrow">ADMIN</p><h1>Route Vehicles</h1><p className="muted">Route + field shift ke against current vehicle assignment save karein.</p>
    <form className="admin-grid" onSubmit={save}>
      <label>Route<input name="route" required /></label>
      <label>Field shift<select name="field_shift"><option value="day">Day</option><option value="night">Night</option></select></label>
      <label>Team<input name="team" /></label>
      <label>Vehicle number<input name="vehicle_number" required /></label>
      <label>Driver<input name="driver" /></label>
      <label>Fueler / Supervisor<input name="fueler_supervisor" /></label>
      <label className="span-two">Notes<input name="notes" /></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving..." : "Save assignment"}</button>
    </form>
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}

function RosterPanel() {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("profiles").select("id,full_name,role,operator_shift").order("full_name").then(({ data, error }) => {
      if (error) setNotice(error.message);
      else setRows((data ?? []) as ProfileRow[]);
    });
  }, []);

  async function save() {
    setBusy(true); setNotice("");
    try {
      const supabase = createClient();
      for (const row of rows) {
        const { error } = await supabase.from("profiles").update({ full_name: row.full_name, role: row.role, operator_shift: row.operator_shift }).eq("id", row.id);
        if (error) throw error;
      }
      setNotice("Duty roster saved.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not save roster."); }
    finally { setBusy(false); }
  }

  function patch(id: string, key: "full_name" | "role" | "operator_shift", value: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value } : row));
  }

  return <section className="admin-placeholder"><p className="eyebrow">ADMIN</p><h1>Duty roster</h1><p className="muted">Existing users ko Day, Evening, ya Night operator shift assign karein. Naye accounts pehle authentication dashboard se invite honge.</p>
    <div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Operator shift</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><input aria-label="Full name" value={row.full_name} onChange={(event) => patch(row.id, "full_name", event.target.value)} /></td><td><select value={row.role} onChange={(event) => patch(row.id, "role", event.target.value)}><option value="operator">Operator</option><option value="admin">Admin</option></select></td><td><select value={row.operator_shift} onChange={(event) => patch(row.id, "operator_shift", event.target.value)}><option value="day">Day · 08:00-16:00</option><option value="evening">Evening · 16:00-00:00</option><option value="night">Night · 00:00-08:00</option></select></td></tr>)}
      {!rows.length && <tr><td colSpan={3}>No users yet. Invite users first.</td></tr>}
    </tbody></table></div>
    <button className="primary-button" type="button" onClick={save} disabled={busy || !rows.length}>{busy ? "Saving..." : "Save roster"}</button>
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
