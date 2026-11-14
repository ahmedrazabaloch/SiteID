# Fuel Ops PWA

PWA for tower fueling site lookup, last-fueling values, daily Excel updates, route vehicles, and the three-rotation operator roster.

## Deployment shape
- Next.js + TypeScript web app
- PostgreSQL and Supabase Auth
- Vercel for the first deployment; the Next.js app remains portable to a Node.js server or Docker/VPS
- Site data is online-first; the service worker caches only the manifest and app icon, never site records or API responses

## Local setup
1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key. These app keys do not grant database-migration access.
3. Install dependencies with `npm install`, then sign the Supabase CLI in once with `npx supabase login` and link the project with `npx supabase link --project-ref YOUR_PROJECT_REF`. The CLI prompts for the database password; it is separate from the publishable key and stays out of `.env.local`.
4. The original schema migration was already run manually in the hosted project. Register that existing migration once with `npm run db:baseline`, then apply new migrations with `npm run db:push`. Later migration updates only need `npm run db:push`. Use `npm run db:status` to inspect migration history. For a brand-new empty project, skip `db:baseline` and run `npm run db:push` to apply every migration.
5. Run `npm run dev`.

## Database changes
All schema changes belong in timestamped files in `supabase/migrations/`. Do not paste migrations into the dashboard SQL editor. The one-time baseline command only records that the first schema migration has already been applied; it does not execute or modify schema SQL. Real site and daily fueling workbook data is imported through the authenticated app import flow, which validates rows and ignores credential columns.

## First admin and users
Create/invite users through Supabase Auth. New profiles default to operator. After the first admin signs in once, promote that profile using a terminal command that reads the email from an environment variable:

```powershell
$env:ADMIN_EMAIL = "admin@example.com"
npx supabase db query --remote "update public.profiles set role = 'admin' where id = (select id from auth.users where email = :'ADMIN_EMAIL');"
Remove-Item Env:ADMIN_EMAIL
```

The admin can then set other roles in the app. Never put database passwords or service-role keys in `NEXT_PUBLIC_*` variables or commit them to Git. If you need to promote the first account before opening the app, use the CLI instead of the dashboard editor:

```powershell
npx supabase db query --remote "update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');"
```

## Deployment
Set the same two environment variables in Vercel and deploy the project. For a later VPS move, build and run with Node.js or Docker behind HTTPS; keep PostgreSQL separate during the app move if that makes cutover easier.

## Data rule
One current fueling row per site. Daily imports replace the last state by Site ID. Average consumption is calculated internally from the previous visit's total fuel minus this visit's available fuel, divided by valid running hours. The Last Fueling card shows only the agreed fields.

## Workbook import
The import accepts the current workbook tabs `Site ID & Addresses` and `Daily-Reports`, as well as the app template tabs `Master Sites` and `Daily Update`. For a history-style `Daily-Reports` upload, it keeps only the newest dated row for each Site ID. Password and login ID columns are ignored. The current master tab does not contain day/night team assignments, routes, or Night On-Caller contacts; those columns must be added and filled before those details can appear in site lookup.
