# Fuel Ops PWA

PWA for tower fueling site lookup, last-fueling values, daily Excel updates, route vehicles, and the three-rotation operator roster.

## Deployment shape
- Next.js + TypeScript web app
- PostgreSQL and Supabase Auth
- Vercel for the first deployment; the Next.js app remains portable to a Node.js server or Docker/VPS
- Site data is online-first; the service worker caches only the manifest and app icon, never site records or API responses

## Local setup
1. Create a Supabase project.
2. Run the SQL migration in `supabase/migrations/001_fuel_ops.sql`.
3. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key.
4. Create/invite users in Supabase Auth. Profiles default to operator. After the first admin has signed in once, promote that profile in Supabase SQL Editor with `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'ADMIN_EMAIL');`; then the admin can set other roles in the app.
5. Install dependencies with `npm install` and run `npm run dev`.

## Deployment
Set the same two environment variables in Vercel and deploy the project. For a later VPS move, build and run with Node.js or Docker behind HTTPS; keep PostgreSQL separate during the app move if that makes cutover easier.

## Data rule
One current fueling row per site. Daily imports replace the last state by Site ID. Average consumption is calculated internally from the previous visit's total fuel minus this visit's available fuel, divided by valid running hours. The Last Fueling card shows only the agreed fields.

## Workbook import
The import accepts the current workbook tabs `Site ID & Addresses` and `Daily-Reports`, as well as the app template tabs `Master Sites` and `Daily Update`. For a history-style `Daily-Reports` upload, it keeps only the newest dated row for each Site ID. Password and login ID columns are ignored. The current master tab does not contain day/night team assignments, routes, or Night On-Caller contacts; those columns must be added and filled before those details can appear in site lookup.
