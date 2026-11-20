import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function clean(value: unknown): string {
  if (value && typeof value === "object") {
    const v = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (v.text) return v.text.trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v.richText) return v.richText.map((part) => part.text).join("").trim();
  }
  return value === null || value === undefined ? "" : String(value).trim();
}
function key(value: unknown) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function isBlank(value: unknown) { const normalized = clean(value).toLowerCase(); return !normalized || normalized === "-" || normalized === "n/a"; }
function asNumber(value: unknown): number | null {
  const normalized = clean(value).replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function meterStatus(value: unknown): string | null {
  const status = clean(value).toLowerCase();
  if (!status) return null;
  if (status.includes("suspect") || status.includes("temper")) return "suspected";
  if (status.includes("replace") || status.includes("change")) return "replaced";
  if (status.includes("missing") || status === "no meter") return "missing";
  if (status.includes("fault") || status.includes("not working") || status.includes("damage")) return "faulty";
  if (status === "working" || status === "running" || status === "ok" || status === "yes") return "working";
  return "unknown";
}
function asDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 1000) return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  const text = clean(value);
  const date = new Date(text);
  return text && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
function firstIndex(headers: string[], choices: string[]) { return headers.findIndex((header) => choices.includes(header)); }
const requiredColumns = [
  ["site id", "site code", "siteid"],
  ["done date", "completion date", "completed date", "fueling date", "date"],
  ["available fuel", "fuel available", "fuel available before l", "fuel available before", "previous stock"],
  ["fuel poured", "fuel added", "fuel added l", "quantity filled"],
  ["current reading", "current dg reading", "present reading"],
];

function findHeaderRow(sheet: ExcelJS.Worksheet) {
  const scanLimit = Math.min(sheet.rowCount, 20);
  for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber++) {
    const values = sheet.getRow(rowNumber).values as unknown[];
    const headers = values.slice(1).map(key);
    if (requiredColumns.every((aliases) => firstIndex(headers, aliases) >= 0)) return { rowNumber, headers };
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

    const { data: profile, error: profileError } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.is_active) return NextResponse.json({ error: "This account is inactive." }, { status: 403 });
    if (profile.role !== "admin" && profile.role !== "super_admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const form = await request.formData();
    const file = form.get("file");
    const mode = form.get("mode");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel file." }, { status: 400 });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Daily Update") ?? workbook.getWorksheet("Daily-Reports") ?? workbook.getWorksheet("Daily Reports") ?? workbook.getWorksheet("Entery") ?? workbook.getWorksheet("Entry") ?? workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) return NextResponse.json({ error: "The workbook has no daily rows." }, { status: 400 });

    const header = findHeaderRow(sheet);
    if (!header) return NextResponse.json({ error: "Could not find a header row in the first 20 rows. Required columns: Site ID, Date, Available Fuel, Fuel Added, and Current Reading." }, { status: 400 });
    const { rowNumber: headerRowNumber, headers } = header;
    const idCol = firstIndex(headers, requiredColumns[0]);
    const doneDateCol = firstIndex(headers, ["done date", "completion date", "completed date"]);
    const dateCol = doneDateCol >= 0 ? doneDateCol : firstIndex(headers, ["fueling date", "date"]);
    const availableCol = firstIndex(headers, requiredColumns[2]);
    const pouredCol = firstIndex(headers, requiredColumns[3]);
    const readingCol = firstIndex(headers, requiredColumns[4]);
    const previousReadingCol = firstIndex(headers, ["previous reading", "last reading"]);
    const previousTotalCol = firstIndex(headers, ["total maintained", "total fuel", "maintain"]);
    const meterStatusCol = firstIndex(headers, ["dg meter status", "meter status"]);
    const ticketStatusCol = firstIndex(headers, ["ticket status", "status"]);
    const needed = [idCol, dateCol, availableCol, pouredCol, readingCol];
    if (needed.some((index) => index < 0)) {
      return NextResponse.json({ error: "Required columns: Site ID, Fueling Date, Available Fuel, Fuel Poured, Current Reading." }, { status: 400 });
    }

    const latestBySite = new Map<string, { rowNumber: number; fuelingDate: string; item: Record<string, unknown> }>();
    const validRowsBySite = new Map<string, { rowNumber: number; fuelingDate: string; item: Record<string, unknown> }[]>();
    const invalidRows: { row: number; siteId: string; fuelingDate: string | null; issue: string }[] = [];
    const errors: { row: number; siteId: string; issue: string }[] = [];
    const warnings: { row: number; siteId: string; issue: string }[] = [];
    for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const siteId = clean(row.getCell(idCol + 1).value);
      if (!siteId) continue;
      const ticketStatus = ticketStatusCol < 0 ? "" : clean(row.getCell(ticketStatusCol + 1).value).toLowerCase();
      if (ticketStatus.includes("cancel")) {
        warnings.push({ row: rowNumber, siteId, issue: "Ticket is cancelled; row skipped" });
        continue;
      }
      if (doneDateCol >= 0 && isBlank(row.getCell(doneDateCol + 1).value)) {
        warnings.push({ row: rowNumber, siteId, issue: "Done Date is blank; fueling is not marked complete, row skipped" });
        continue;
      }
      const fuelingDate = asDate(row.getCell(dateCol + 1).value);
      const availableRaw = row.getCell(availableCol + 1).value;
      const pouredRaw = row.getCell(pouredCol + 1).value;
      const availableFuel = asNumber(availableRaw);
      const fuelPoured = asNumber(pouredRaw);
      const currentReading = asNumber(row.getCell(readingCol + 1).value);
      const previousReading = previousReadingCol < 0 ? null : asNumber(row.getCell(previousReadingCol + 1).value);
      const dgMeterStatus = meterStatusCol < 0 ? null : meterStatus(row.getCell(meterStatusCol + 1).value);
      if (isBlank(availableRaw) && isBlank(pouredRaw)) {
        warnings.push({ row: rowNumber, siteId, issue: "No fuel amounts recorded; row skipped" });
        continue;
      }
      if (!fuelingDate || availableFuel === null || fuelPoured === null || availableFuel < 0 || fuelPoured < 0) {
        invalidRows.push({ row: rowNumber, siteId, fuelingDate, issue: "Missing/invalid date or non-negative fuel amount" });
        continue;
      }
      const sourceTotalFuel = previousTotalCol < 0 ? null : asNumber(row.getCell(previousTotalCol + 1).value);
      const item = {
        site_id: siteId,
        fueling_date: fuelingDate,
        available_fuel: availableFuel,
        fuel_poured: fuelPoured,
        current_reading: currentReading,
        source_previous_reading: previousReading,
        source_previous_fueling_date: null,
        source_total_fuel: sourceTotalFuel,
        ...(dgMeterStatus ? { dg_meter_status: dgMeterStatus } : {}),
      };
      const candidates = validRowsBySite.get(siteId) ?? [];
      candidates.push({ rowNumber, fuelingDate, item });
      validRowsBySite.set(siteId, candidates);
      const previous = latestBySite.get(siteId);
      if (!previous || fuelingDate > previous.fuelingDate || (fuelingDate === previous.fuelingDate && rowNumber > previous.rowNumber)) {
        latestBySite.set(siteId, { rowNumber, fuelingDate, item });
      }
    }

    for (const invalid of invalidRows) {
      const latest = latestBySite.get(invalid.siteId);
      const isOlderThanLatest = latest && invalid.fuelingDate
        && (invalid.fuelingDate < latest.fuelingDate || (invalid.fuelingDate === latest.fuelingDate && invalid.row < latest.rowNumber));
      (isOlderThanLatest ? warnings : errors).push({
        row: invalid.row,
        siteId: invalid.siteId,
        issue: isOlderThanLatest ? invalid.issue + "; older row skipped because a newer valid entry exists" : invalid.issue,
      });
    }

    const rows: Record<string, unknown>[] = [...latestBySite.entries()].map(([siteId, latest]) => {
      const previous = (validRowsBySite.get(siteId) ?? [])
        .filter((entry) => entry.fuelingDate < latest.fuelingDate || (entry.fuelingDate === latest.fuelingDate && entry.rowNumber < latest.rowNumber))
        .sort((a, b) => b.fuelingDate.localeCompare(a.fuelingDate) || b.rowNumber - a.rowNumber)[0];
      return {
        ...latest.item,
        source_previous_fueling_date: previous?.fuelingDate ?? null,
        source_previous_total_fuel: previous?.item.source_total_fuel ?? null,
      };
    });
    const ids = rows.map((row) => String(row.site_id));
    const known = new Set<string>();
    if (ids.length) {
      const { data: sites, error } = await supabase.from("site_master").select("site_id").in("site_id", ids);
      if (error) throw error;
      for (const site of sites ?? []) known.add(String(site.site_id));
    }
    const validRows = rows.filter((row, index) => {
      const id = String(row.site_id);
      if (known.has(id)) return true;
      warnings.push({ row: latestBySite.get(id)?.rowNumber ?? index + 2, siteId: id, issue: "Site ID does not exist in Master Sites; row skipped" });
      return false;
    });

    if (mode === "commit") {
      if (errors.length) return NextResponse.json({ error: "Fix the listed rows before importing.", errors }, { status: 422 });
      if (!validRows.length) return NextResponse.json({ error: "No valid rows to import." }, { status: 422 });
      const { data, error } = await supabase.rpc("apply_daily_import", { p_rows: validRows, p_file_name: file.name });
      if (error) throw error;
      return NextResponse.json({ imported: validRows.length, result: data });
    }
    return NextResponse.json({ fileName: file.name, rowCount: validRows.length, errors, warnings, sample: validRows.slice(0, 8) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
