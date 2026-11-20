export type OfflineSnapshot = {
  userId: string;
  syncedAt: string;
  sites: Record<string, unknown>[];
  fuel: Record<string, unknown>[];
  vehicles: Record<string, unknown>[];
};

const databaseName = "search-id-offline";
const databaseVersion = 1;
const snapshotStore = "snapshots";
const maximumAgeMs = 7 * 24 * 60 * 60 * 1000;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(snapshotStore)) database.createObjectStore(snapshotStore, { keyPath: "userId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage is unavailable."));
  });
}

export async function saveOfflineSnapshot(snapshot: OfflineSnapshot) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(snapshotStore, "readwrite");
      const store = transaction.objectStore(snapshotStore);
      store.clear();
      store.put(snapshot);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save offline data."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save offline data."));
    });
  } finally {
    database.close();
  }
}

export async function readOfflineSnapshot(userId: string) {
  const database = await openDatabase();
  try {
    return await new Promise<OfflineSnapshot | null>((resolve, reject) => {
      const request = database.transaction(snapshotStore, "readonly").objectStore(snapshotStore).get(userId);
      request.onsuccess = () => resolve((request.result as OfflineSnapshot | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read offline data."));
    });
  } finally {
    database.close();
  }
}

export async function clearOfflineSnapshot(userId: string) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(snapshotStore, "readwrite");
      transaction.objectStore(snapshotStore).delete(userId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear offline data."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not clear offline data."));
    });
  } finally {
    database.close();
  }
}

export function isOfflineSnapshotFresh(snapshot: OfflineSnapshot) {
  const syncedAt = Date.parse(snapshot.syncedAt);
  return Number.isFinite(syncedAt) && Date.now() - syncedAt <= maximumAgeMs;
}

export function findOfflineSite(snapshot: OfflineSnapshot, searchTerm: string) {
  const term = searchTerm.trim();
  const site = snapshot.sites.find((candidate) => String(candidate.site_id ?? "").toLocaleLowerCase() === term.toLocaleLowerCase())
    ?? snapshot.sites.find((candidate) => {
      const match = term.match(/^(?:(?:mobile\s*)?dg\s*)?van\s*0?(\d{1,2})(?:\s*south[-\s]?1)?$/i);
      if (!match) return false;
      const number = Number(match[1]);
      return number >= 1 && number <= 10
        && String(candidate.site_id ?? "").toLocaleLowerCase() === `mobile dg van ${String(number).padStart(2, "0")} south-1`;
    });
  if (!site) return null;

  const siteId = String(site.site_id ?? "");
  const current = snapshot.fuel.find((record) => String(record.site_id ?? "") === siteId) ?? null;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const contact = hour >= 9 && hour < 21
    ? { label: "Cluster Owner", name: site.cluster_owner_name as string | null, phone: site.cluster_owner_phone as string | null }
    : { label: "Night On-Caller", name: site.night_on_caller_name as string | null, phone: site.night_on_caller_phone as string | null };
  return { site, current, vehicles: snapshot.vehicles, contact };
}
