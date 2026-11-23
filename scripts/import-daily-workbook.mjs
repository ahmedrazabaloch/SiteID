import nextEnv from "@next/env";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";

nextEnv.loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const inputPath = process.argv.slice(2).find((argument) => argument !== "--dry-run");
const filePath = path.resolve(inputPath || "C:/Users/Ahmed Raza/Desktop/daily-reports.xlsx");
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
function asNumber(value) {
  const text = cellText(value).replace(/,/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function asDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 1000) return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  const text = cellText(value);
  const date = new Date(text);
  return text && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
function meterStatus(value) {
  const status = cellText(value).toLowerCase();
  if (status.includes("suspect") || status.includes("temper")) return "suspected";
  if (status.includes("replace") || status.includes("change")) return "replaced";
  if (status.includes("missing") || status === "no meter") return "missing";
  if (status.includes("fault") || status.includes("not working") || status.includes("damage")) return "faulty";
  if (status === "working" || status === "ok" || status === "yes") return "working";
  return "unknown";
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(filePath);
const sheet = workbook.getWorksheet("Daily Update") ?? workbook.getWorksheet("Daily-Reports") ?? workbook.worksheets[0];
if (!sheet || sheet.rowCount < 2) throw new Error("Workbook does not contain daily fueling rows.");
const headers = sheet.getRow(1).values.slice(1).map(normalize);
const index = (aliases) => headers.findIndex((header) => aliases.includes(header));
const columns = {
  site_id: index(["site id", "site code", "siteid"]),
  date: index(["fueling date", "date"]),
  status: index(["dg meter status", "meter status"]),
  previous_reading: index(["previous reading", "last reading"]),
  current_reading: index(["current reading", "current dg reading", "present reading"]),
  available: index(["available fuel", "fuel available", "fuel available before l", "fuel available before", "previous stock"]),
  poured: index(["fuel poured", "fuel added", "fuel added l", "quantity filled"]),
  total: index(["total maintained", "total fuel"]),
};
if (["site_id", "date", "current_reading", "available", "poured"].some((name) => columns[name] < 0)) {
  throw new Error("Required columns: Site ID, Date, Previous Stock/Available Fuel, Quantity Filled/Fuel Poured, and Present Reading.");
}

const historyBySite = new Map();
const invalidRows = [];
for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
  const row = sheet.getRow(rowNumber);
  const siteId = cellText(row.getCell(columns.site_id + 1).value);
  if (!siteId) continue;
  const fuelingDate = asDate(row.getCell(columns.date + 1).value);
  const available = asNumber(row.getCell(columns.available + 1).value);
  const poured = asNumber(row.getCell(columns.poured + 1).value);
  if (!fuelingDate || available === null || poured === null || available < 0 || poured < 0) {
    invalidRows.push({ siteId, rowNumber, fuelingDate });
    continue;
  }
  const record = {
    site_id: siteId,
    rowNumber,
    fueling_date: fuelingDate,
    dg_meter_status: columns.status < 0 ? "unknown" : meterStatus(row.getCell(columns.status + 1).value),
    previous_reading: columns.previous_reading < 0 ? null : asNumber(row.getCell(columns.previous_reading + 1).value),
    current_reading: asNumber(row.getCell(columns.current_reading + 1).value),
    available_fuel: available,
    fuel_poured: poured,
    total_fuel: columns.total < 0 ? available + poured : asNumber(row.getCell(columns.total + 1).value) ?? available + poured,
  };
  const records = historyBySite.get(siteId) ?? [];
  records.push(record);
  historyBySite.set(siteId, records);
}

for (const [siteId, records] of historyBySite) {
  records.sort((a, b) => a.fueling_date.localeCompare(b.fueling_date) || a.rowNumber - b.rowNumber);
  const latest = records.at(-1);
  const olderInvalid = invalidRows.filter((row) => row.siteId === siteId && row.fuelingDate
    && (row.fuelingDate < latest.fueling_date || (row.fuelingDate === latest.fueling_date && row.rowNumber < latest.rowNumber)));
  if (invalidRows.some((row) => row.siteId === siteId) && olderInvalid.length !== invalidRows.filter((row) => row.siteId === siteId).length) {
    throw new Error("Site " + siteId + " has an invalid latest row; no data was written.");
  }
}
const latestRecords = [];
for (const [siteId, records] of historyBySite) {
  records.sort((a, b) => a.fueling_date.localeCompare(b.fueling_date) || a.rowNumber - b.rowNumber);
  const latest = records.at(-1);
  const previous = records.length > 1 ? records.at(-2) : null;
  const consumed = previous ? previous.total_fuel - latest.available_fuel : null;
  let runningHours = null;
  let average = null;
  let averageStatus = "n_a";
  const isMeterUsable = latest.dg_meter_status !== "faulty" && latest.dg_meter_status !== "missing";
  let baselineValid = isMeterUsable && latest.current_reading !== null;
  if (isMeterUsable && latest.previous_reading !== null && latest.current_reading !== null) {
    const difference = latest.current_reading - latest.previous_reading;
    const elapsedHours = previous ? Math.max(0, (Date.parse(latest.fueling_date) - Date.parse(previous.fueling_date)) / 3600000) : 0;
    if (difference < 0 || (elapsedHours > 0 && difference > elapsedHours) || (consumed !== null && consumed < 0)) {
      averageStatus = "check";
      baselineValid = false;
    } else {
      runningHours = difference;
      if (difference > 0 && consumed !== null && consumed >= 0) {
        average = consumed / difference;
        averageStatus = "valid";
      } else if (!previous) averageStatus = "baseline";
    }
  } else if (isMeterUsable && latest.current_reading !== null && !previous) {
    averageStatus = "baseline";
  }
  latestRecords.push({
    site_id: siteId,
    fueling_date: latest.fueling_date,
    available_fuel: latest.available_fuel,
    fuel_poured: latest.fuel_poured,
    previous_total_fuel: previous?.total_fuel ?? null,
    fuel_consumed_since_last: consumed !== null && consumed >= 0 ? consumed : null,
    dg_meter_status: latest.dg_meter_status,
    previous_reading: latest.previous_reading,
    current_reading: latest.current_reading,
    running_hours: runningHours,
    average_consumption: average,
    average_status: averageStatus,
    baseline_valid: baselineValid,
  });
}
if (latestRecords.length !== 255) throw new Error("Expected 255 distinct sites in the workbook; found " + latestRecords.length + ".");
if (invalidRows.length !== 1 || invalidRows[0].siteId !== "61336" || invalidRows[0].rowNumber !== 1139) {
  throw new Error("Unexpected malformed historical rows found; no data was written.");
}
const averageCount = latestRecords.filter((row) => row.average_status === "valid").length;
const checkCount = latestRecords.filter((row) => row.average_status === "check").length;
if (dryRun) {
  console.log("Dry run: " + latestRecords.length + " latest site records are ready.");
  console.log("Latest fueling date: " + latestRecords.map((row) => row.fueling_date).sort().at(-1) + ".");
  console.log("Valid averages: " + averageCount + "; meter/reading checks: " + checkCount + ".");
  console.log("Would skip historical malformed row 1139 (Site 61336, 2026-10-21); a newer valid row exists.");
  process.exit(0);
}

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: admins, error: adminError } = await supabase.from("profiles").select("id").eq("role", "super_admin").eq("is_active", true).limit(2);
if (adminError) throw adminError;
if (admins?.length !== 1) throw new Error("Expected exactly one active super admin for the import audit.");
const adminId = admins[0].id;
const ids = latestRecords.map((record) => record.site_id);
const known = new Set();
for (let offset = 0; offset < ids.length; offset += 100) {
  const { data, error } = await supabase.from("site_master").select("site_id").in("site_id", ids.slice(offset, offset + 100));
  if (error) throw error;
  for (const site of data ?? []) known.add(site.site_id);
}
const unknown = ids.filter((id) => !known.has(id));
if (unknown.length) throw new Error("These Site IDs are missing from Master Sites: " + unknown.slice(0, 10).join(", "));

const now = new Date().toISOString();
const payload = latestRecords.map((record) => ({ ...record, last_imported_by: adminId, updated_at: now }));
const { error: upsertError } = await supabase.from("site_latest").upsert(payload, { onConflict: "site_id" });
if (upsertError) throw upsertError;
const { error: auditError } = await supabase.from("import_runs").insert({
  import_type: "daily",
  file_name: path.basename(filePath),
  imported_rows: payload.length,
  imported_by: adminId,
});
if (auditError) throw auditError;

const { count, error: countError } = await supabase.from("site_latest").select("site_id", { count: "exact", head: true });
if (countError) throw countError;
if (count !== 255) throw new Error("Import verification found " + count + " latest fueling rows; expected 255.");
console.log("Imported and verified " + count + " newest per-site fueling records.");
console.log("Latest fueling date in the workbook: " + latestRecords.map((row) => row.fueling_date).sort().at(-1) + ".");
console.log("Average consumption calculated for " + averageCount + " sites; " + checkCount + " readings marked for review; faulty/missing meters remain N/A.");
console.log("Skipped historical malformed row 1139 (Site 61336, 2026-10-21); a newer valid row was selected.");
