import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function text(value: unknown): string {
  if (value && typeof value === "object") {
    const v = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (v.text) return v.text.trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v.richText) return v.richText.map((part) => part.text).join("").trim();
  }
  return value === null || value === undefined ? "" : String(value).trim();
}
function normalize(value: unknown) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function column(headers: string[], options: string[]) { return headers.findIndex((header) => options.includes(header)); }
function valueAt(row: ExcelJS.Row, headers: string[], aliases: string[]) {
  const index = column(headers, aliases);
  return index < 0 ? "" : text(row.getCell(index + 1).value);
}
const fields: Record<string, string[]> = {
  site_id: ["site id", "site code", "siteid"],
  address: ["address"],
  site_area: ["site area", "area"],
  day_team: ["day team"],
  day_route: ["day route", "route day"],
  day_fueler: ["day fueler supervisor", "day fueler", "day supervisor"],
  day_driver: ["day driver"],
  night_team: ["night team"],
  night_route: ["night route", "route night"],
  night_fueler: ["night fueler supervisor", "night fueler", "night supervisor"],
  night_driver: ["night driver"],
  cluster_owner_name: ["cluster owner"],
  cluster_owner_phone: ["cluster owner phone", "cluster owner number", "cluster owner contact"],
  night_on_caller_name: ["night on caller", "night on caller name"],
  night_on_caller_phone: ["night on caller phone", "night on caller number", "night on caller contact"],
  ie_lead_name: ["i engineering team lead", "ie team lead", "ie lead", "ie tgl"],
  ie_lead_phone: ["i engineering team lead phone", "ie team lead phone", "ie lead phone"],
  zong_lead_name: ["zong team lead", "zong lead"],
  zong_lead_phone: ["zong team lead phone", "zong lead phone"],
  security_company: ["security company"],
  security_so_name: ["security supervisor so", "security so", "so supervisor"],
  security_so_phone: ["security contact", "security so phone", "so number"],
  access_notes: ["guarded access notes", "access notes", "short remarks"],
  dg_brand: ["dg brand model", "dg brand"],
  dg_serial_number: ["dg serial number", "dg serial"],
  dg_meter_status: ["dg meter status", "meter status"],
  site_status: ["site status"],
  other_notes: ["other notes", "remarks"],
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const form = await request.formData();
    const file = form.get("file");
    const mode = form.get("mode");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel file." }, { status: 400 });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Master Sites") ?? workbook.getWorksheet("Site ID & Addresses") ?? workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) return NextResponse.json({ error: "The workbook has no site rows." }, { status: 400 });

    const headerValues = sheet.getRow(1).values as unknown[];
    const headers = headerValues.slice(1).map(normalize);
    if (column(headers, fields.site_id) < 0) return NextResponse.json({ error: "A Site ID column is required." }, { status: 400 });
    const rows: Record<string, string>[] = [];
    const errors: { row: number; siteId: string; issue: string }[] = [];
    const seen = new Set<string>();

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const siteId = valueAt(row, headers, fields.site_id);
      if (!siteId) continue;
      if (seen.has(siteId)) { errors.push({ row: rowNumber, siteId, issue: "Duplicate Site ID in this file" }); continue; }
      seen.add(siteId);
      const item: Record<string, string> = {};
      for (const [field, aliases] of Object.entries(fields)) item[field] = valueAt(row, headers, aliases);
      item.site_id = siteId;
      if (!item.address) errors.push({ row: rowNumber, siteId, issue: "Address is blank" });
      rows.push(item);
    }

    if (mode === "commit") {
      if (errors.length) return NextResponse.json({ error: "Fix the listed rows before importing.", errors }, { status: 422 });
      const { data, error } = await supabase.rpc("apply_master_import", { p_rows: rows, p_file_name: file.name });
      if (error) throw error;
      return NextResponse.json({ imported: rows.length, result: data });
    }
    return NextResponse.json({ fileName: file.name, rowCount: rows.length, errors, sample: rows.slice(0, 3).map(({ site_id, address, day_team, night_team }) => ({ site_id, address, day_team, night_team })) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Master import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
