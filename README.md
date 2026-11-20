# Search ID

Search ID is the tower operations workspace for site lookup, current fueling records, master site data, route vehicles, and staff access. It is a Next.js PWA backed by Supabase Auth and PostgreSQL.

## Offline lookup

When an active user opens the app while connected, Search ID syncs only the site, latest fueling, and vehicle fields needed for lookup into that browser's IndexedDB. The snapshot is private, refreshed on app open and reconnect, and usable offline for up to seven days. Offline mode is read-only. Sign out clears the local snapshot. Use offline lookup only on a trusted, password-protected device; the browser cannot check account deactivation while disconnected.

The service worker caches the offline search screen, app icons, and versioned Next.js static assets. It never caches API responses or personalized dashboard HTML. Android Chrome can install the PWA from the browser menu; iPhone users can add it from Safari's Share menu.

## Local setup

1. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key. Add `SUPABASE_SECRET_KEY` for server-side user provisioning; never expose it in browser code or commit it.
2. Install dependencies with `npm install`.
3. Link Supabase and apply pending migrations with `npm run db:push`.
4. Run `npm run dev`.

## Data and performance

- Master site records are server-paginated at 10, 20, or 50 rows per page.
- Site lookup fetches one site and its latest fuel record, plus the small vehicle assignment list.
- The offline snapshot endpoint verifies the signed-in, active account and paginates table reads in batches of 500.
- Daily workbook parsing runs in the authenticated server route; large workbooks still depend on hosting request-size and execution limits.

## Android package

The PWA is the primary mobile install target. A store-ready Android package can be wrapped after the production HTTPS domain and Android signing identity are confirmed. Keep the PWA as the source of truth so web and installed clients receive the same updates.
