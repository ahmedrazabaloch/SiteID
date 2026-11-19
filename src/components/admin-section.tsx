"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, ToastKind, useToast } from "@/components/toast-provider";
import { SiteMasterManager } from "@/components/site-master-manager";

type Section = "daily" | "master" | "vehicles" | "roster";
type ImportPreview = { fileName?: string; rowCount?: number; errors?: { row: number; siteId: string; issue: string }[]; warnings?: { row: number; siteId: string; issue: string }[]; sample?: Record<string, unknown>[]; error?: string; imported?: number };
type ImportAudit = { imported_at: string; file_name: string; imported_rows: number; imported_by: string | null; full_name: string };
type VehicleRow = { route: string; field_shift: "day" | "night"; vehicle_number: string; driver: string; fueler_supervisor: string; team: string; notes: string; updated_at: string };
type ManagedUser = { id: string; username: string | null; email: string | null; phone: string | null; full_name: string; role: "super_admin" | "admin" | "operator"; operator_shift: "day" | "evening" | "night"; is_active: boolean; created_at: string };
type Notify = (message: string, kind?: ToastKind) => void;

export function AdminSection({ section }: { section: Section }) {
  const notify = useToast();
  if (section === "master") return <MasterSitesPanel notify={notify} />;
  if (section === "daily") return <ImportPanel key={section} kind={section} notify={notify} />;
  if (section === "vehicles") return <VehiclePanel notify={notify} />;
  return <RosterPanel notify={notify} />;
}

function MasterSitesPanel({ notify }: { notify: Notify }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [addSiteRequest, setAddSiteRequest] = useState(0);
  return <>
    <ImportPanel kind="master" notify={notify} onAddSite={() => setAddSiteRequest((value) => value + 1)} onCommitted={() => setRefreshToken((value) => value + 1)} />
    <SiteMasterManager notify={notify} refreshToken={refreshToken} addSiteRequest={addSiteRequest} />
  </>;
}

function ImportPanel({ kind, notify, onCommitted, onAddSite }: { kind: "daily" | "master"; notify: Notify; onCommitted?: () => void; onAddSite?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastImport, setLastImport] = useState<ImportAudit | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditFailed, setAuditFailed] = useState(false);
  const endpoint = kind === "daily" ? "/api/daily-import" : "/api/master-import";

  const loadLastImport = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from("import_runs").select("imported_at,file_name,imported_rows,imported_by").eq("import_type", kind).order("imported_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) { setLastImport(null); setAuditFailed(false); return; }
      let fullName = "Unknown user";
      if (data.imported_by) {
        const { data: profile, error: profileError } = await supabase.from("profiles").select("full_name").eq("id", data.imported_by).maybeSingle();
        if (profileError) throw profileError;
        fullName = profile?.full_name || "Name not set";
      }
      setLastImport({ ...data, full_name: fullName });
      setAuditFailed(false);
    } catch (cause) {
      setAuditFailed(true);
      notify(friendlyError(cause, "Could not load the last import details."), "warning");
    } finally { setAuditLoading(false); }
  }, [kind, notify]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Load the most recent import when this panel opens.
  useEffect(() => { void loadLastImport(); }, [loadLastImport]);

  async function send(mode: "preview" | "commit") {
    if (!file) { notify("Choose an Excel workbook first.", "warning"); return; }
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    try {
      const response = await fetch(endpoint, { method: "POST", body: form });
      const body = await response.json().catch(() => null) as ImportPreview | null;
      if (!response.ok) throw new Error(body?.error || "The workbook could not be processed. Please try again.");
      if (!body) throw new Error("The server returned an empty response. Please try again.");
      setPreview(body);
      if (mode === "commit") {
        setFile(null);
        notify(`${body.imported ?? 0} site records imported successfully.`, "success");
        await loadLastImport();
        onCommitted?.();
      } else if (body.errors?.length) {
        notify(`${body.errors.length} row${body.errors.length === 1 ? " needs" : "s need"} attention. Review the preview below.`, "warning");
      } else if (body.warnings?.length) {
        notify(`${body.rowCount ?? 0} records are ready; ${body.warnings.length} row${body.warnings.length === 1 ? " was" : "s were"} skipped with warnings. Review the details below.`, "warning");
      } else {
        notify(`${body.rowCount ?? 0} records are ready to import.`, "success");
      }
    } catch (cause) {
      notify(friendlyError(cause, "The workbook could not be processed. Please try again."), "error");
    } finally {
      setBusy(false);
    }
  }

  const lastImportSummary = <div className="import-audit last-import" aria-live="polite"><span className="import-audit-mark last-import-icon" aria-hidden="true">↻</span><div><strong>{auditLoading ? "Loading last update…" : auditFailed ? "Last update details unavailable" : lastImport ? "Last updated" : "No imports recorded yet"}</strong>{lastImport && !auditFailed && <p><time dateTime={lastImport.imported_at}>{formatImportDate(lastImport.imported_at)}</time><span>by <b>{lastImport.full_name}</b></span><span>{lastImport.imported_rows.toLocaleString("en-US")} {kind === "daily" ? "records" : "sites"}</span><span className="import-audit-file">{lastImport.file_name}</span></p>}</div></div>;

  return <section className={`admin-placeholder import-page ${kind}-import-page`}>
    {kind === "master" && <div className="master-import-actions"><button className="btn btn-primary" type="button" onClick={onAddSite}>Add a site</button></div>}
    <div className="admin-form card import-card">
      <div className="field"><label htmlFor={`${kind}-workbook`}>Excel workbook (.xlsx)</label><label className="file-drop" htmlFor={`${kind}-workbook`}><span className="file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6m-3-3 3 3 3-3"/></svg></span><span className="file-copy"><strong>{file?.name || `Choose a ${kind === "daily" ? "daily fueling" : "master sites"} workbook`}</strong><span>Accepted format: .xlsx · Review the preview before importing.</span></span><input id={`${kind}-workbook`} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label></div>
      <div className="button-row"><button className="primary-button" type="button" disabled={!file || busy} onClick={() => send("preview")}>{busy ? "Reading workbook…" : "Preview import"}</button>{lastImportSummary}</div>
    </div>
    {preview && !preview.error && <div className="preview-box card card-pad" aria-live="polite">
      <div className="preview-title"><strong>{preview.fileName}</strong><span className="preview-count">{preview.rowCount ?? 0} records ready</span></div>
      <p>{preview.errors?.length ?? 0} issues found · {preview.warnings?.length ?? 0} warnings</p>
      {!!preview.errors?.length && <><ul className="preview-errors">{preview.errors.slice(0, 8).map((error, index) => <li key={index}>Row {error.row} · Site {error.siteId}: {error.issue}</li>)}</ul>{preview.errors.length > 8 && <p className="muted">Showing 8 of {preview.errors.length} issues.</p>}</>}
      {!!preview.warnings?.length && <><ul className="preview-warnings">{preview.warnings.slice(0, 8).map((warning, index) => <li key={index}>Row {warning.row} · Site {warning.siteId}: {warning.issue}</li>)}</ul>{preview.warnings.length > 8 && <p className="muted">Showing 8 of {preview.warnings.length} warnings.</p>}</>}
      {preview.sample?.length ? <div className="table-wrap preview-table"><table><thead><tr>{Object.keys(preview.sample[0]).map((column) => <th key={column}>{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{preview.sample.map((row, index) => <tr key={index}>{Object.keys(preview.sample?.[0] ?? {}).map((column) => <td key={column}>{String(row[column] ?? "N/A")}</td>)}</tr>)}</tbody></table></div> : null}
      {preview.rowCount && !preview.errors?.length && preview.imported === undefined && <button className="primary-button" type="button" disabled={busy} onClick={() => send("commit")}>{busy ? "Importing…" : "Confirm and import"}</button>}
      {preview.imported !== undefined && <p className="success-text">{preview.imported} site records imported. Latest values are now saved.</p>}
    </div>}
  </section>;
}

function formatImportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" }).format(date);
}

function VehiclePanel({ notify }: { notify: Notify }) {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [editing, setEditing] = useState<{ route: string; field_shift: "day" | "night" } | null>(null);
  const [form, setForm] = useState({ route: "", field_shift: "day" as "day" | "night", team: "", vehicle_number: "", driver: "", fueler_supervisor: "" });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const closeEditor = useCallback(() => {
    setEditing(null);
    setForm({ route: "", field_shift: "day", team: "", vehicle_number: "", driver: "", fueler_supervisor: "" });
    setEditorOpen(false);
  }, []);

  const loadVehicles = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from("route_vehicles").select("route,field_shift,vehicle_number,driver,fueler_supervisor,team,notes,updated_at").order("field_shift").order("route");
      if (error) throw error;
      setVehicles((data ?? []) as VehicleRow[]);
    } catch (cause) { notify(friendlyError(cause, "Could not load vehicle assignments."), "error"); }
    finally { setLoading(false); }
  }, [notify]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetch once when this admin panel mounts.
  useEffect(() => { void loadVehicles(); }, [loadVehicles]);

  useEffect(() => {
    if (!editorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) closeEditor(); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("vehicle-editor-open");
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.classList.remove("vehicle-editor-open"); };
  }, [editorOpen, busy, closeEditor]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        route: form.route.trim(),
        field_shift: form.field_shift,
        team: form.team.trim(),
        vehicle_number: form.vehicle_number.trim(),
        driver: form.driver.trim(),
        fueler_supervisor: form.fueler_supervisor.trim(),
        notes: "",
        updated_by: user?.id,
      };
      if (editing) {
        const { data, error } = await supabase.from("route_vehicles").update(row).eq("route", editing.route).eq("field_shift", editing.field_shift).select("route").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("This vehicle assignment could not be found. Refresh the list and try again.");
        notify("Vehicle assignment updated.", "success");
      } else {
        const { error } = await supabase.from("route_vehicles").insert(row);
        if (error) throw error;
        notify("Vehicle assignment added.", "success");
      }
      setEditing(null);
      setForm({ route: "", field_shift: "day", team: "", vehicle_number: "", driver: "", fueler_supervisor: "" });
      setEditorOpen(false);
      await loadVehicles();
    } catch (cause) {
      notify(friendlyError(cause, "Could not save vehicle assignment."), "error");
    } finally { setBusy(false); }
  }
  function addVehicle() {
    setEditing(null);
    setForm({ route: "", field_shift: "day", team: "", vehicle_number: "", driver: "", fueler_supervisor: "" });
    setEditorOpen(true);
  }
  function editVehicle(vehicle: VehicleRow) {
    setEditing({ route: vehicle.route, field_shift: vehicle.field_shift });
    setForm({ route: vehicle.route, field_shift: vehicle.field_shift, team: vehicle.team, vehicle_number: vehicle.vehicle_number, driver: vehicle.driver, fueler_supervisor: vehicle.fueler_supervisor });
    setEditorOpen(true);
  }

  return <section className="admin-placeholder vehicle-page">
    <div className="vehicle-list-heading"><div><h2>Vehicle assignments</h2><p>Manage day and night vehicle crews and zone assignments.</p></div><div className="vehicle-heading-actions"><span>{vehicles.length} total</span><button className="btn btn-primary" type="button" onClick={addVehicle}>Add vehicle</button></div></div>
    {editorOpen && <div className="site-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeEditor(); }}>
      <section className="site-editor-dialog vehicle-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="vehicle-editor-title">
        <header className="site-editor-header"><div><span className="eyebrow">Route vehicles</span><h2 id="vehicle-editor-title">{editing ? "Edit vehicle assignment" : "Add vehicle assignment"}</h2><p>Enter the duty, zone, vehicle and crew details.</p></div><button className="site-editor-close" type="button" aria-label="Close vehicle editor" disabled={busy} onClick={closeEditor}>×</button></header>
        <form className="admin-grid vehicle-form vehicle-modal-form form-grid" onSubmit={save}>
          <label className="field">Duty<select value={form.field_shift} onChange={(event) => setForm((current) => ({ ...current, field_shift: event.target.value as "day" | "night" }))}><option value="day">Day</option><option value="night">Night</option></select></label>
          <label className="field">Vehicle number<input value={form.vehicle_number} onChange={(event) => setForm((current) => ({ ...current, vehicle_number: event.target.value }))} required /></label>
          <label className="field">Zone area<input value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value }))} required /></label>
          <label className="field">FormulaOne team name (optional)<input value={form.team} onChange={(event) => setForm((current) => ({ ...current, team: event.target.value }))} placeholder="Defaults to zone area" /></label>
          <label className="field">Driver<input value={form.driver} onChange={(event) => setForm((current) => ({ ...current, driver: event.target.value }))} /></label>
          <label className="field">Supervisor<input value={form.fueler_supervisor} onChange={(event) => setForm((current) => ({ ...current, fueler_supervisor: event.target.value }))} /></label>
          <div className="vehicle-modal-actions"><button className="btn btn-secondary" type="button" onClick={closeEditor} disabled={busy}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add vehicle"}</button></div>
        </form>
      </section>
    </div>}
    <div className="table-wrap vehicle-table"><table><thead><tr><th>Duty</th><th>FormulaOne team</th><th>Vehicle number</th><th>Zone area</th><th>Driver</th><th>Supervisor</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
      {vehicles.map((vehicle) => <tr key={`${vehicle.route}-${vehicle.field_shift}`}><td><span className={`duty-tag duty-${vehicle.field_shift}`}>{vehicle.field_shift === "day" ? "Day" : "Night"}</span></td><td>{vehicle.team || vehicle.route}</td><td><strong>{vehicle.vehicle_number}</strong></td><td>{vehicle.route}</td><td>{vehicle.driver || "—"}</td><td>{vehicle.fueler_supervisor || "—"}</td><td><button className="edit-button" type="button" onClick={() => editVehicle(vehicle)}>Edit</button></td></tr>)}
      {!vehicles.length && <tr><td colSpan={7}>{loading ? "Loading vehicle assignments…" : "No vehicle assignments yet. Add the first vehicle above."}</td></tr>}
    </tbody></table></div>
  </section>;
}

function RosterPanel({ notify }: { notify: Notify }) { return <UserManagementPanel notify={notify} />; }

function UserManagementPanel({ notify }: { notify: Notify }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", fullName: "", role: "operator" as "admin" | "operator", shift: "day" as "day" | "evening" | "night", password: "" });
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; password: string; fullName: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const closeEditor = useCallback(() => {
    setForm({ username: "", fullName: "", role: "operator", shift: "day", password: "" });
    setShowPassword(false);
    setEditorOpen(false);
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { users?: ManagedUser[]; currentUserId?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Could not load user accounts.");
      if (!body) throw new Error("The server returned an empty user list.");
      setUsers(body.users ?? []);
      setCurrentUserId(body.currentUserId ?? "");
    } catch (cause) { notify(friendlyError(cause, "Could not load user accounts."), "error"); }
    finally { setLoading(false); }
  }, [notify]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetch once when this admin panel mounts.
  useEffect(() => { void loadUsers(); }, [loadUsers]);

  useEffect(() => {
    if (!editorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) closeEditor(); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("user-editor-open");
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.classList.remove("user-editor-open"); };
  }, [editorOpen, busy, closeEditor]);

  function generatePassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%";
    const random = new Uint8Array(16);
    crypto.getRandomValues(random);
    const generated = Array.from(random, (byte) => alphabet[byte % alphabet.length]).join("") + "a7!";
    setForm((current) => ({ ...current, password: generated }));
    notify("A secure temporary password was generated.", "info");
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = form.username.trim();
    if (!/^03\d{9}$/.test(username)) { notify("Enter an 11-digit ID starting with 03, for example 03139090700.", "warning"); return; }
    if (!form.fullName.trim()) { notify("Enter the staff member’s name.", "warning"); return; }
    if (form.password.length < 10) { notify("Use at least 10 characters for the initial password.", "warning"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, fullName: form.fullName.trim(), role: form.role, shift: form.shift, password: form.password }) });
      const body = await response.json().catch(() => null) as { error?: string; user?: ManagedUser } | null;
      if (!response.ok) throw new Error(body?.error || "Could not create the user account.");
      setCreatedCredentials({ username, password: form.password, fullName: form.fullName.trim() });
      notify(`${form.fullName.trim()}’s ${form.role} account has been created.`, "success");
      setForm({ username: "", fullName: "", role: "operator", shift: "day", password: "" });
      setShowPassword(false);
      setEditorOpen(false);
      await loadUsers();
    } catch (cause) { notify(friendlyError(cause, "Could not create the user account."), "error"); }
    finally { setBusy(false); }
  }

  async function toggleAccount(user: ManagedUser) {
    if (user.id === currentUserId) { notify("You cannot deactivate your own super admin account.", "warning"); return; }
    const nextActive = !user.is_active;
    if (!window.confirm(`${nextActive ? "Reactivate" : "Deactivate"} ${user.full_name || user.username || "this account"}?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, isActive: nextActive }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Could not update this account.");
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, is_active: nextActive } : item));
      notify(`${user.full_name || user.username}’s account has been ${nextActive ? "reactivated" : "deactivated"}.`, "success");
    } catch (cause) { notify(friendlyError(cause, "Could not update this account."), "error"); }
    finally { setBusy(false); }
  }

  async function copyCredentials() {
    if (!createdCredentials) return;
    try {
      await navigator.clipboard.writeText(`Fuel Ops login\nID: ${createdCredentials.username}\nPassword: ${createdCredentials.password}`);
      notify("Login details copied. Share them directly with the staff member.", "success");
    } catch { notify("Clipboard access was blocked. Copy the ID and password manually.", "warning"); }
  }

  return <section className="admin-placeholder user-management-page">
    <div className="vehicle-list-heading user-list-heading"><div><h2>Accounts</h2><p>Create staff logins, assign roles and manage account access.</p></div><div className="vehicle-heading-actions"><span>{users.filter((user) => user.is_active).length} active · {users.length} total</span><button className="btn btn-primary" type="button" onClick={() => { setCreatedCredentials(null); setForm({ username: "", fullName: "", role: "operator", shift: "day", password: "" }); setShowPassword(false); setEditorOpen(true); }}>Add user</button></div></div>
    {editorOpen && <div className="site-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeEditor(); }}>
      <section className="site-editor-dialog user-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="user-editor-title">
        <header className="site-editor-header"><div><span className="eyebrow">Users & access</span><h2 id="user-editor-title">Create a staff account</h2><p>Set the login ID, account role, shift and initial password.</p></div><button className="site-editor-close" type="button" aria-label="Close account form" disabled={busy} onClick={closeEditor}>×</button></header>
        <form className="admin-grid user-create-form user-modal-form form-grid" onSubmit={createAccount}>
          <label className="field">ID number<input inputMode="numeric" autoComplete="off" maxLength={11} placeholder="03139090700" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value.replace(/\D/g, "").slice(0, 11) }))} required /></label>
          <label className="field">Full name<input autoComplete="off" maxLength={80} value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} required /></label>
          <label className="field">Account role<select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as "admin" | "operator" }))}><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
          <label className="field">Duty shift<select value={form.shift} onChange={(event) => setForm((current) => ({ ...current, shift: event.target.value as "day" | "evening" | "night" }))}><option value="day">Day · 08:00–16:00</option><option value="evening">Evening · 16:00–00:00</option><option value="night">Night · 00:00–08:00</option></select></label>
          <label className="user-password-field field field-full">Initial password<input type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required /><div className="password-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide password" : "Show password"}</button><button type="button" className="btn btn-secondary" onClick={generatePassword}>Generate password</button></div></label>
          <div className="user-modal-actions"><button className="btn btn-secondary" type="button" onClick={closeEditor} disabled={busy}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button></div>
        </form>
      </section>
    </div>}
    {createdCredentials && <div className="credentials-card"><div><strong>Share these login details with {createdCredentials.fullName}</strong><p>ID: <code>{createdCredentials.username}</code> · Password: <code>{createdCredentials.password}</code></p></div><button className="secondary-button" type="button" onClick={copyCredentials}>Copy login details</button><button className="credential-dismiss" type="button" onClick={() => setCreatedCredentials(null)} aria-label="Hide credentials">×</button></div>}
    <div className="table-wrap user-table"><table><thead><tr><th>Staff member</th><th>Login ID</th><th>Role</th><th>Duty shift</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {users.map((user) => <tr key={user.id}><td><strong>{user.full_name || "Name not set"}</strong></td><td>{user.username || user.email || user.phone || "—"}</td><td>{user.role.replace("_", " ")}</td><td>{user.operator_shift}</td><td><span className={`account-status ${user.is_active ? "account-active" : "account-inactive"}`}>{user.is_active ? "Active" : "Deactivated"}</span></td><td><button className="edit-button" type="button" disabled={busy || user.role === "super_admin"} onClick={() => void toggleAccount(user)}>{user.is_active ? "Deactivate" : "Reactivate"}</button></td></tr>)}
      {!users.length && <tr><td colSpan={6}>{loading ? "Loading accounts…" : "No accounts found."}</td></tr>}
    </tbody></table></div>
    <p className="user-security-note">Passwords are shown only once after account creation. Deactivated accounts cannot sign in or access site data.</p>
  </section>;
}
