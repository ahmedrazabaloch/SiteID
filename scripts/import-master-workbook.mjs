import nextEnv from "@next/env";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";

nextEnv.loadEnvConfig(process.cwd());

const filePath = path.resolve(process.argv[2] || "C:/Users/Ahmed Raza/Desktop/mastersheet.xlsx");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");

function cellText(value) {
  if (value && typeof value === "object") {
    if ("text" in value && value.text) return String(value.text).trim();
    if ("result" in value && value.result !== undefined) return String(value.result).trim();
    if ("richText" in value && value.richText) return value.richText.map((part) => part.text).join("").trim();
  }
  return value === null || value === undefined ? "" : String(value).trim();
}
const normalize = (value) => cellText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(filePath);
const sheet = workbook.getWorksheet("Site ID & Addresses") ?? workbook.worksheets[0];
if (!sheet || sheet.rowCount < 2) throw new Error("Workbook does not contain site rows.");
const headers = sheet.getRow(1).values.slice(1).map(normalize);
const index = (aliases) => headers.findIndex((header) => aliases.includes(header));
const columns = {
  site_id: index(["site id", "site code", "siteid"]),
  address: index(["address"]),
  site_area: index(["site area", "area"]),
  f1_zone: index(["f1 zone", "zone f1", "f1zone"]),
  cluster_owner_name: index(["cluster owner"]),
  ie_lead_name: index(["i engineering team lead", "ie team lead", "ie lead", "ie tgl"]),
  zong_lead_name: index(["zong team lead", "zong lead", "cmpak tgl"]),
};
if (Object.values(columns).some((column) => column < 0)) throw new Error("Required site, address, zone, or lead columns are missing.");

const rows = [];
const seen = new Set();
const duplicates = [];
for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
  const row = sheet.getRow(rowNumber);
  const siteId = cellText(row.getCell(columns.site_id + 1).value);
  if (!siteId) continue;
  if (seen.has(siteId)) { duplicates.push({ siteId, row: rowNumber }); continue; }
  seen.add(siteId);
  rows.push({
    site_id: siteId,
    address: cellText(row.getCell(columns.address + 1).value),
    site_area: cellText(row.getCell(columns.site_area + 1).value),
    f1_zone: cellText(row.getCell(columns.f1_zone + 1).value),
    cluster_owner_name: cellText(row.getCell(columns.cluster_owner_name + 1).value),
    ie_lead_name: cellText(row.getCell(columns.ie_lead_name + 1).value),
    zong_lead_name: cellText(row.getCell(columns.zong_lead_name + 1).value),
  });
}
if (rows.length !== 427) throw new Error("Expected 427 unique sites; found " + rows.length + ". Review the workbook before importing.");
if (duplicates.some(({ siteId }) => !["62305", "62666"].includes(siteId))) throw new Error("Unexpected duplicate Site ID found; import stopped for review.");

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: admins, error: adminError } = await supabase.from("profiles").select("id,full_name").eq("role", "super_admin").eq("is_active", true).limit(2);
if (adminError) throw adminError;
if (admins?.length !== 1) throw new Error("Expected one active super admin for import audit; found " + (admins?.length ?? 0) + ".");
const admin = admins[0];
const updatedAt = new Date().toISOString();
const payload = rows.map((row) => ({ ...row, updated_at: updatedAt, updated_by: admin.id }));

for (let offset = 0; offset < payload.length; offset += 100) {
  const { error } = await supabase.from("site_master").upsert(payload.slice(offset, offset + 100), { onConflict: "site_id" });
  if (error) throw error;
}
const { error: auditError } = await supabase.from("import_runs").insert({
  import_type: "master",
  file_name: path.basename(filePath),
  imported_rows: payload.length,
  imported_by: admin.id,
});
if (auditError) throw auditError;

const { count, error: countError } = await supabase.from("site_master").select("site_id", { count: "exact", head: true });
if (countError) throw countError;
if (count !== 427) throw new Error("Import completed but verification found " + count + " site rows, expected 427.");
const { data: special, error: verifyError } = await supabase.from("site_master").select("site_id,address,site_area,f1_zone").in("site_id", ["62305", "62666"]).order("site_id");
if (verifyError) throw verifyError;
console.log("Imported and verified " + count + " unique site records.");
console.log("Kept first workbook row for duplicate IDs: " + duplicates.map(({ siteId, row }) => siteId + " (duplicate row " + row + ")").join(", ") + ".");
console.log("North Karachi F1 zone rows: " + rows.filter((row) => normalize(row.f1_zone) === "north karachi").length + "; day uses North Nazimabad vehicle; night remains unassigned.");
console.log("Duplicate sample records verified: " + (special?.length ?? 0) + ".");
