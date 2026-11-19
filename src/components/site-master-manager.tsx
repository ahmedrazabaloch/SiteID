"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/components/toast-provider";

type Site = Record<string, string | null> & { site_id: string; updated_at?: string; updated_by?: string | null };
type Notify = (message: string, kind?: "success" | "warning" | "error" | "info") => void;

const groups: { title: string; fields: readonly (readonly [string, string])[] }[] = [
  { title: "Site details", fields: [["site_id", "Site ID"], ["address", "Address"], ["site_area", "Site area"], ["f1_zone", "F1 zone"]] },
  { title: "FormulaOne teams and routes", fields: [["day_team", "Day team"], ["day_route", "Day route"], ["night_team", "Night team"], ["night_route", "Night route"]] },
  { title: "Site contacts", fields: [["cluster_owner_name", "Cluster Owner (9 AM–9 PM)"], ["cluster_owner_phone", "Cluster Owner phone"], ["night_on_caller_name", "Night On-Caller"], ["night_on_caller_phone", "Night On-Caller phone"]] },
  { title: "Client leads", fields: [["ie_lead_name", "I-Engineering lead"], ["ie_lead_phone", "I-Engineering lead phone"], ["zong_lead_name", "Zong lead"], ["zong_lead_phone", "Zong lead phone"]] },
  { title: "Security and access", fields: [["security_company", "Security company"], ["security_so_name", "Security SO / supervisor"], ["security_so_phone", "Security contact"], ["access_notes", "Access notes"]] },
  { title: "Generator and notes", fields: [["dg_brand", "DG brand / model"], ["dg_serial_number", "DG serial number"], ["dg_meter_status", "DG meter status"], ["site_status", "Site status"], ["other_notes", "Other notes"]] },
];

const emptyForm: Record<string, string> = Object.fromEntries(groups.flatMap((group) => group.fields).map(([key]) => [key, key === "dg_meter_status" ? "unknown" : ""]));

export function SiteMasterManager({ notify, refreshToken }: { notify: Notify; refreshToken: number }) {
  const [sites, setSites] = useState<Site[]>([]);
  const [updaterNames, setUpdaterNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [form, setForm] = useState<Record<string, string>>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const from = (page - 1) * pageSize;
      let sitesQuery = supabase.from("site_master").select("*", { count: "exact" });
      const needle = search.trim().replace(/[^a-zA-Z0-9\s-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
      if (needle) sitesQuery = sitesQuery.or(["site_id", "address", "site_area", "f1_zone", "cluster_owner_name"].map((field) => field + ".ilike.%" + needle + "%").join(","));
      const { data, error, count } = await sitesQuery.order("site_id").range(from, from + pageSize - 1);
      if (error) throw error;
      const updaterIds = [...new Set((data ?? []).map((site) => site.updated_by).filter((id): id is string => Boolean(id)))];
      const { data: profiles, error: profileError } = updaterIds.length
        ? await supabase.from("profiles").select("id,full_name").in("id", updaterIds)
        : { data: [], error: null };
      if (profileError) throw profileError;
      setSites((data ?? []) as Site[]);
      setTotalCount(count ?? 0);
      setUpdaterNames(Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile.full_name || "Name not set"])));
    } catch (cause) { notify(friendlyError(cause, "Could not load master site records."), "error"); }
    finally { setLoading(false); }
  }, [notify, page, pageSize, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const firstRow = totalCount ? (page - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(page * pageSize, totalCount);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetch the active server-side page and refresh after imports.
  useEffect(() => { void loadSites(); }, [loadSites, refreshToken]);

  useEffect(() => {
    if (!editorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setEditorOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("site-editor-open");
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.classList.remove("site-editor-open"); };
  }, [editorOpen, busy]);

  function resetForm() { setForm(emptyForm); setEditingId(null); setEditorOpen(false); }
  function addSite() { setForm(emptyForm); setEditingId(null); setEditorOpen(true); }
  function editSite(site: Site) {
    const next = { ...emptyForm };
    for (const group of groups) for (const [key] of group.fields) next[key] = String(site[key] ?? "");
    setForm(next); setEditingId(site.site_id); setEditorOpen(true);
  }

  async function saveSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newId = form.site_id.trim();
    if (!newId) { notify("Enter a Site ID.", "warning"); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const payload: Record<string, string | null> = { ...form, site_id: newId, updated_at: new Date().toISOString(), updated_by: user?.id ?? null };
      if (editingId) {
        const { data, error } = await supabase.from("site_master").update(payload).eq("site_id", editingId).select("site_id").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("This site could not be found. Refresh the list and try again.");
        notify(newId === editingId ? "Site " + newId + " updated." : "Site ID changed from " + editingId + " to " + newId + ". Linked latest fueling data was updated too.", "success");
      } else {
        const { error } = await supabase.from("site_master").insert(payload);
        if (error) throw error;
        notify("Site " + newId + " added to Master Sites.", "success");
      }
      resetForm(); await loadSites();
    } catch (cause) { notify(friendlyError(cause, "Could not save the site record."), "error"); }
    finally { setBusy(false); }
  }

  return <section className="site-master-manager">
    <div className="site-manager-heading section-toolbar"><div><h2>Master site records</h2><p>Search, review and edit site details. Add a site when a new tower comes online.</p></div><div className="site-manager-actions"><span className="site-total pill pill-green">{totalCount.toLocaleString("en-US")} sites</span><button className="btn btn-primary" type="button" onClick={addSite}>Add a site</button></div></div>
    {editorOpen && <div className="site-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) resetForm(); }}>
      <section className="site-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="site-editor-title">
        <header className="site-editor-header"><div><span className="eyebrow">Master data</span><h2 id="site-editor-title">{editingId ? `Edit site ${editingId}` : "Add a site"}</h2><p>Enter location, team, contact and generator details.</p></div><button className="site-editor-close" type="button" aria-label="Close site editor" disabled={busy} onClick={resetForm}>×</button></header>
        <form className="site-master-form card card-pad" onSubmit={saveSite}>
      {groups.map((group) => <fieldset className="site-form-group form-section" key={group.title}><legend className="form-section-title">{group.title}</legend><div className="site-form-grid form-grid">
        {group.fields.map(([key, label]) => <label className={key === "address" || key === "access_notes" || key === "other_notes" ? "site-field field field-full" : "site-field field"} key={key}>{label}
          {key === "dg_meter_status" ? <select value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}><option value="unknown">N/A / Unknown</option><option value="working">Working</option><option value="faulty">Faulty</option><option value="replaced">Replaced</option><option value="missing">No meter</option><option value="suspected">Needs review</option></select>
            : key === "address" || key === "access_notes" || key === "other_notes" ? <textarea rows={key === "address" ? 2 : 3} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />
            : <input value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} required={key === "site_id"} />}
        </label>)}
      </div></fieldset>)}
      <p className="site-derived-note">Vehicle driver and supervisor are derived from the route vehicle assignment and are not duplicated in the site record.</p>
      <div className="site-form-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editingId ? "Save site changes" : "Add site"}</button>{editingId && <button className="btn btn-secondary" type="button" onClick={resetForm}>Cancel edit</button>}</div>
        </form>
      </section>
    </div>}
    <div className="site-list-heading section-toolbar"><div className="site-list-controls table-controls"><label className="site-page-size field">Rows per page<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label><label className="site-search field">Search sites<input aria-label="Search master site records by Site ID, address, area, F1 zone, or Cluster Owner" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="e.g. 1260 or Gulshan" /></label></div></div>
    <div className="table-wrap site-master-table"><table><thead><tr><th>Site ID</th><th>Address</th><th>Site area</th><th>F1 zone</th><th>Cluster Owner</th><th>Last updated</th><th>Updated by</th><th>Action</th></tr></thead><tbody>
      {sites.map((site) => <tr key={site.site_id}><td><strong>{site.site_id}</strong></td><td>{site.address || "—"}</td><td>{site.site_area || "—"}</td><td>{site.f1_zone || "—"}</td><td>{site.cluster_owner_name || "—"}</td><td>{site.updated_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" }).format(new Date(site.updated_at)) : "—"}</td><td>{site.updated_by ? updaterNames[site.updated_by] || "User" : "—"}</td><td><button className="edit-button" type="button" onClick={() => editSite(site)}>Edit</button></td></tr>)}
      {!sites.length && <tr><td colSpan={8}>{loading ? "Loading sites…" : query ? "No sites match your search." : "No sites yet. Import a workbook or add the first site above."}</td></tr>}
    </tbody></table></div>
    <div className="mobile-records site-mobile-records">{sites.map((site) => <article className="record-card" key={site.site_id}><div className="record-card-head"><div><strong>Site {site.site_id}</strong><span>{site.address || "Address not provided"}</span></div><span className="pill pill-gray">{site.f1_zone || "No zone"}</span></div><div className="record-fields"><div className="record-field"><label>Site area</label><strong>{site.site_area || "—"}</strong></div><div className="record-field"><label>Cluster Owner</label><strong>{site.cluster_owner_name || "—"}</strong></div><div className="record-field"><label>Last updated</label><strong>{site.updated_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Karachi" }).format(new Date(site.updated_at)) : "—"}</strong></div><div className="record-field"><label>Updated by</label><strong>{site.updated_by ? updaterNames[site.updated_by] || "User" : "—"}</strong></div></div><div className="record-card-actions"><button className="btn btn-secondary btn-sm" type="button" onClick={() => editSite(site)}>Edit site</button></div></article>)}</div>
    <div className="site-pagination table-footer"><span>Showing {firstRow}–{lastRow} of {totalCount.toLocaleString("en-US")}</span><div className="pagination"><button className="btn btn-secondary btn-sm" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button className="btn btn-secondary btn-sm" type="button" disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>
  </section>;
}
