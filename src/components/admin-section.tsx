"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Section = "daily" | "master" | "vehicles" | "roster";
type ImportPreview = { fileName?: string; rowCount?: number; errors?: { row: number; siteId: string; issue: string }[]; sample?: Record<string, unknown>[]; error?: string; imported?: number };
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
  const title = kind === "daily" ? "Daily fueling update" : "Master sites";
  const subtitle = kind === "daily"
    ? "Upload the latest fueling workbook. Import Master Sites first so each fueling row can be matched to a site. The newest dated row replaces the current record for each site."
    : "Import site locations, teams, routes and contact details. Blank cells keep previously saved values.";

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
    <h1>{title}</h1><p className="muted">{subtitle}</p>
    <div className="admin-form">
      <label>Excel workbook (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label>
      {file && <p className="selected-file">Selected: <strong>{file.name}</strong></p>}
      <div className="button-row"><button className="primary-button" type="button" disabled={!file || busy} onClick={() => send("preview")}>{busy ? "Reading workbook…" : "Preview import"}</button></div>
    </div>
    {preview?.error && <p className="error-text" role="alert">{preview.error}</p>}
    {preview && !preview.error && <div className="preview-box" aria-live="polite">
      <div className="preview-title"><strong>{preview.fileName}</strong><span className="preview-count">{preview.rowCount ?? 0} records ready</span></div>
      <p>{preview.errors?.length ?? 0} issues found</p>
      {!!preview.errors?.length && <><ul className="preview-errors">{preview.errors.slice(0, 8).map((error, index) => <li key={index}>Row {error.row} · Site {error.siteId}: {error.issue}</li>)}</ul>{preview.errors.length > 8 && <p className="muted">Showing 8 of {preview.errors.length} issues.</p>}</>}
      {preview.sample?.length ? <div className="table-wrap preview-table"><table><thead><tr>{Object.keys(preview.sample[0]).map((column) => <th key={column}>{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{preview.sample.map((row, index) => <tr key={index}>{Object.keys(preview.sample?.[0] ?? {}).map((column) => <td key={column}>{String(row[column] ?? "N/A")}</td>)}</tr>)}</tbody></table></div> : null}
      {preview.rowCount && !preview.errors?.length && preview.imported === undefined && <button className="primary-button" type="button" disabled={busy} onClick={() => send("commit")}>{busy ? "Importing…" : "Confirm and import"}</button>}
      {preview.imported !== undefined && <p className="success-text">{preview.imported} site records imported. Latest values are now saved.</p>}
    </div>}
  </section>;
}

function VehiclePanel() {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(""); setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
      formElement.reset();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not save assignment.");
    } finally { setBusy(false); }
  }
  return <section className="admin-placeholder"><h1>Route vehicles</h1><p className="muted">Set the current vehicle, driver and fueler/supervisor for each route and field shift.</p>
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

  return <section className="admin-placeholder"><h1>Staff & shifts</h1><p className="muted">Manage existing users, access roles and operator shifts. Create or invite new accounts in Supabase Authentication first.</p>
    <div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Operator shift</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><input aria-label="Full name" value={row.full_name} onChange={(event) => patch(row.id, "full_name", event.target.value)} /></td><td><select value={row.role} onChange={(event) => patch(row.id, "role", event.target.value)}><option value="operator">Operator</option><option value="admin">Admin</option></select></td><td><select value={row.operator_shift} onChange={(event) => patch(row.id, "operator_shift", event.target.value)}><option value="day">Day · 08:00-16:00</option><option value="evening">Evening · 16:00-00:00</option><option value="night">Night · 00:00-08:00</option></select></td></tr>)}
      {!rows.length && <tr><td colSpan={3}>No users yet. Invite users first.</td></tr>}
    </tbody></table></div>
    <button className="primary-button" type="button" onClick={save} disabled={busy || !rows.length}>{busy ? "Saving..." : "Save roster"}</button>
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
