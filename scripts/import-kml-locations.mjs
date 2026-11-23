import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

nextEnv.loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const requestedPath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const filePath = path.resolve(requestedPath || "C:/Users/Ahmed Raza/Desktop/On-Aired Sept 2026.kml");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");

const kml = await readFile(filePath, "utf8");
const decodeXml = (value) => value
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const tagValue = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
};
const byId = new Map();
for (const match of kml.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)) {
  const placemark = match[1];
  const siteId = tagValue(placemark, "name");
  const coordinatesText = tagValue(placemark, "coordinates");
  if (!siteId || !coordinatesText) continue;
  const [longitudeText, latitudeText] = coordinatesText.trim().split(/[\s,]+/);
  const longitude = Number(longitudeText);
  const latitude = Number(latitudeText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error(`Invalid KML coordinate for placemark ${siteId}.`);
  }
  if (byId.has(siteId)) throw new Error(`Duplicate KML Site ID ${siteId}; import stopped.`);
  byId.set(siteId, { site_id: siteId, latitude, longitude });
}
if (byId.size !== 4866) throw new Error(`Expected 4,866 unique KML placemarks; found ${byId.size}.`);

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const siteRows = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await supabase.from("site_master").select("site_id").order("site_id").range(from, from + 499);
  if (error) throw error;
  siteRows.push(...(data ?? []));
  if ((data ?? []).length < 500) break;
}
if (siteRows.length !== 427) throw new Error(`Expected 427 app Site IDs; found ${siteRows.length}.`);

const matching = siteRows.flatMap(({ site_id }) => {
  const coordinates = byId.get(String(site_id).trim());
  return coordinates ? [{ ...coordinates, location_source: path.basename(filePath), location_updated_at: new Date().toISOString() }] : [];
});
const missing = siteRows.map(({ site_id }) => String(site_id)).filter((siteId) => !byId.has(siteId.trim())).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (matching.length !== 396 || missing.length !== 31) throw new Error(`Match count changed: ${matching.length} matched, ${missing.length} missing. Expected 396 and 31.`);

console.log(`KML placemarks: ${byId.size}; app sites: ${siteRows.length}; exact matches: ${matching.length}; missing from KML: ${missing.length}.`);
console.log("Missing Site IDs: " + missing.join(", "));
if (dryRun) {
  console.log("Dry run complete; no database rows changed.");
} else {
  for (let offset = 0; offset < matching.length; offset += 100) {
    const { error } = await supabase.from("site_master").upsert(matching.slice(offset, offset + 100), { onConflict: "site_id" });
    if (error) throw error;
  }

  const { data: verify, error: verifyError } = await supabase.from("site_master")
    .select("site_id,latitude,longitude")
    .not("latitude", "is", null)
    .not("longitude", "is", null);
  if (verifyError) throw verifyError;
  if (verify?.length !== 396) throw new Error(`Import wrote coordinates, but verification expected 396 rows and found ${verify?.length ?? 0}.`);
  console.log(`Imported and verified ${verify.length} site coordinates.`);
}
