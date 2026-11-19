# Fuel Ops PWA

PWA for tower fueling site lookup, last-fueling values, daily Excel updates, route vehicles, and the three-rotation operator roster.

## Deployment shape
- Next.js + TypeScript web app
- PostgreSQL and Supabase Auth
- Vercel for the first deployment; the Next.js app remains portable to a Node.js server or Docker/VPS
- Site data is online-first; the service worker caches only the manifest and app icon, never site records or API responses

## Local setup
1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key. Add `SUPABASE_SECRET_KEY` for server-side user provisioning (or the legacy `SUPABASE_SERVICE_ROLE_KEY`); it must never use a `NEXT_PUBLIC_` prefix or be committed to Git.
3. Install dependencies with `npm install`, then sign the Supabase CLI in once with `npx supabase login` and link the project with `npx supabase link --project-ref YOUR_PROJECT_REF`. The CLI prompts for the database password; it is separate from the publishable key and stays out of `.env.local`.
4. The original schema migration was already run manually in the hosted project. Register that existing migration once with `npm run db:baseline`, then apply new migrations with `npm run db:push`. Later migration updates only need `npm run db:push`. Use `npm run db:status` to inspect migration history. For a brand-new empty project, skip `db:baseline` and run `npm run db:push` to apply every migration.
5. Run `npm run dev`.

## Database changes
All schema changes belong in timestamped files in `supabase/migrations/`. Do not paste migrations into the dashboard SQL editor. The one-time baseline command only records that the first schema migration has already been applied; it does not execute or modify schema SQL. Real site and daily fueling workbook data is imported through the authenticated app import flow, which validates rows and ignores credential columns.

## Super admin and user accounts
The `20261119000000_super_admin_user_access.sql` migration promotes the only existing Admin profile to `super_admin`. It stops if the database does not contain exactly one Admin profile, so check the existing accounts first if you have already created more than one. It restricts role, login ID, and activation changes to the super admin. New Auth profiles are inactive by default; only the protected super-admin route activates them after assigning the ID and role. Run `npm run db:push` after pulling these files.

Set `SUPABASE_SECRET_KEY` in local `.env.local` and as a server-side Vercel environment variable. Use the Supabase secret key (`sb_secret_…`) or the legacy service-role key. The Users & access screen uses it only from a protected server route to create accounts. Staff sign in with their 11-digit ID and password; no phone provider, SMS, Twilio account, or staff email address is needed. Internally, the app maps each ID to a confirmed `@users.fuelops.invalid` Auth email alias. No messages are sent to that alias. The first super admin can continue signing in with the existing email. Do not expose the secret key in browser code or `NEXT_PUBLIC_*` variables.

The vehicle roster is inserted by `20261119000100_seed_current_vehicle_assignments.sql` as part of the migration sequence, so normal `npm run db:push` applies it without `--include-seed`. The same vehicle can have separate Day and Night assignments. User passwords are never saved in the app database or shown again after the one-time creation screen; deactivated accounts are denied access by both the app and database policies.

## Deployment
Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY` in Vercel, then deploy the project. For a later VPS move, build and run with Node.js or Docker behind HTTPS; keep PostgreSQL separate during the app move if that makes cutover easier.

## Data rule
One current fueling row per site. Daily imports replace the last state by Site ID. Average consumption is calculated internally from the previous visit's total fuel minus this visit's available fuel, divided by valid running hours. The Last Fueling card shows only the agreed fields.

## Workbook import
The import accepts the current workbook tabs `Site ID & Addresses` and `Daily-Reports`, as well as the app template tabs `Master Sites` and `Daily Update`. For a history-style `Daily-Reports` upload, it keeps only the newest dated row for each Site ID. Password and login ID columns are ignored. The current master tab does not contain day/night team assignments, routes, or Night On-Caller contacts; those columns must be added and filled before those details can appear in site lookup.
