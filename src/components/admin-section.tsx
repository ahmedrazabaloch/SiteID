"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, ToastKind, useToast } from "@/components/toast-provider";

type Section = "daily" | "master" | "vehicles" | "roster";
type ImportPreview = { fileName?: string; rowCount?: number; errors?: { row: number; siteId: string; issue: string }[]; sample?: Record<string, unknown>[]; error?: string; imported?: number };
type VehicleRow = { route: string; field_shift: "day" | "night"; vehicle_number: string; driver: string; fueler_supervisor: string; team: string; notes: string; updated_at: string };
type ManagedUser = { id: string; username: string | null; email: string | null; phone: string | null; full_name: string; role: "super_admin" | "admin" | "operator"; operator_shift: "day" | "evening" | "night"; is_active: boolean; created_at: string };
type Notify = (message: string, kind?: ToastKind) => void;

export function AdminSection({ section }: { section: Section }) {
  const notify = useToast();
  if (section === "daily" || section === "master") return <ImportPanel kind={section} notify={notify} />;
  if (section === "vehicles") return <VehiclePanel notify={notify} />;
  return <RosterPanel notify={notify} />;
}

function ImportPanel({ kind, notify }: { kind: "daily" | "master"; notify: Notify }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = kind === "daily" ? "/api/daily-import" : "/api/master-import";
  const title = kind === "daily" ? "Daily fueling update" : "Master sites";
  const subtitle = kind === "daily"
    ? "Upload the latest fueling workbook. Import Master Sites first so each fueling row can be matched to a site. The newest dated row replaces the current record for each site."
    : "Import site locations, teams, routes and contact details. Blank cells keep previously saved values.";

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
      } else if (body.errors?.length) {
        notify(`${body.errors.length} row${body.errors.length === 1 ? " needs" : "s need"} attention. Review the preview below.`, "warning");
      } else {
        notify(`${body.rowCount ?? 0} records are ready to import.`, "success");
      }
    } catch (cause) {
      notify(friendlyError(cause, "The workbook could not be processed. Please try again."), "error");
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

function VehiclePanel({ notify }: { notify: Notify }) {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [editing, setEditing] = useState<{ route: string; field_shift: "day" | "night" } | null>(null);
  const [form, setForm] = useState({ route: "", field_shift: "day" as "day" | "night", vehicle_number: "", driver: "", fueler_supervisor: "" });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        route: form.route.trim(),
        field_shift: form.field_shift,
        team: "",
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
      setForm({ route: "", field_shift: "day", vehicle_number: "", driver: "", fueler_supervisor: "" });
      await loadVehicles();
    } catch (cause) {
      notify(friendlyError(cause, "Could not save vehicle assignment."), "error");
    } finally { setBusy(false); }
  }
  function editVehicle(vehicle: VehicleRow) {
    setEditing({ route: vehicle.route, field_shift: vehicle.field_shift });
    setForm({ route: vehicle.route, field_shift: vehicle.field_shift, vehicle_number: vehicle.vehicle_number, driver: vehicle.driver, fueler_supervisor: vehicle.fueler_supervisor });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <section className="admin-placeholder vehicle-page"><h1>Route vehicles</h1><p className="muted">Manage the vehicle, area, duty, driver and supervisor assignments. A vehicle can have separate Day and Night assignments.</p>
    <form className="admin-grid vehicle-form" onSubmit={save}>
      <label>Duty<select value={form.field_shift} onChange={(event) => setForm((current) => ({ ...current, field_shift: event.target.value as "day" | "night" }))}><option value="day">Day</option><option value="night">Night</option></select></label>
      <label>Vehicle number<input value={form.vehicle_number} onChange={(event) => setForm((current) => ({ ...current, vehicle_number: event.target.value }))} required /></label>
      <label>Zone area<input value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value }))} required /></label>
      <label>Driver<input value={form.driver} onChange={(event) => setForm((current) => ({ ...current, driver: event.target.value }))} /></label>
      <label>Supervisor<input value={form.fueler_supervisor} onChange={(event) => setForm((current) => ({ ...current, fueler_supervisor: event.target.value }))} /></label>
      <div className="vehicle-form-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add vehicle"}</button>{editing && <button className="secondary-button" type="button" onClick={() => { setEditing(null); setForm({ route: "", field_shift: "day", vehicle_number: "", driver: "", fueler_supervisor: "" }); }}>Cancel edit</button>}</div>
    </form>
    <div className="vehicle-list-heading"><h2>Vehicle assignments</h2><span>{vehicles.length} total</span></div>
    <div className="table-wrap vehicle-table"><table><thead><tr><th>Duty</th><th>Vehicle number</th><th>Zone area</th><th>Driver</th><th>Supervisor</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
      {vehicles.map((vehicle) => <tr key={`${vehicle.route}-${vehicle.field_shift}`}><td><span className={`duty-tag duty-${vehicle.field_shift}`}>{vehicle.field_shift === "day" ? "Day" : "Night"}</span></td><td><strong>{vehicle.vehicle_number}</strong></td><td>{vehicle.route}</td><td>{vehicle.driver || "—"}</td><td>{vehicle.fueler_supervisor || "—"}</td><td><button className="edit-button" type="button" onClick={() => editVehicle(vehicle)}>Edit</button></td></tr>)}
      {!vehicles.length && <tr><td colSpan={6}>{loading ? "Loading vehicle assignments…" : "No vehicle assignments yet. Add the first vehicle above."}</td></tr>}
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
    <h1>Users & access</h1><p className="muted">As super admin, create Admin and Operator accounts with a unique 11-digit ID. Passwords are stored securely by Supabase and shown once after creation.</p>
    <form className="admin-grid user-create-form" onSubmit={createAccount}>
      <label>ID number<input inputMode="numeric" autoComplete="off" maxLength={11} placeholder="03139090700" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value.replace(/\D/g, "").slice(0, 11) }))} required /></label>
      <label>Full name<input autoComplete="off" maxLength={80} value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} required /></label>
      <label>Account role<select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as "admin" | "operator" }))}><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
      <label>Duty shift<select value={form.shift} onChange={(event) => setForm((current) => ({ ...current, shift: event.target.value as "day" | "evening" | "night" }))}><option value="day">Day · 08:00–16:00</option><option value="evening">Evening · 16:00–00:00</option><option value="night">Night · 00:00–08:00</option></select></label>
      <label className="user-password-field">Initial password<input type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required /><div className="password-actions"><button type="button" className="secondary-button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide password" : "Show password"}</button><button type="button" className="secondary-button" onClick={generatePassword}>Generate password</button></div></label>
      <div className="vehicle-form-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button></div>
    </form>
    {createdCredentials && <div className="credentials-card"><div><strong>Share these login details with {createdCredentials.fullName}</strong><p>ID: <code>{createdCredentials.username}</code> · Password: <code>{createdCredentials.password}</code></p></div><button className="secondary-button" type="button" onClick={copyCredentials}>Copy login details</button><button className="credential-dismiss" type="button" onClick={() => setCreatedCredentials(null)} aria-label="Hide credentials">×</button></div>}
    <div className="vehicle-list-heading"><h2>Accounts</h2><span>{users.length} total</span></div>
    <div className="table-wrap user-table"><table><thead><tr><th>Staff member</th><th>Login ID</th><th>Role</th><th>Duty shift</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {users.map((user) => <tr key={user.id}><td><strong>{user.full_name || "Name not set"}</strong></td><td>{user.username || user.email || user.phone || "—"}</td><td>{user.role.replace("_", " ")}</td><td>{user.operator_shift}</td><td><span className={`account-status ${user.is_active ? "account-active" : "account-inactive"}`}>{user.is_active ? "Active" : "Deactivated"}</span></td><td><button className="edit-button" type="button" disabled={busy || user.role === "super_admin"} onClick={() => void toggleAccount(user)}>{user.is_active ? "Deactivate" : "Reactivate"}</button></td></tr>)}
      {!users.length && <tr><td colSpan={6}>{loading ? "Loading accounts…" : "No accounts found."}</td></tr>}
    </tbody></table></div>
    <p className="user-security-note">Passwords are never displayed after the account is created. A deactivated account cannot sign in or access site data.</p>
  </section>;
}
