# builtbyRyder — Client Dashboard

Next.js + Neon (Postgres) client / project / referral tracker. Deploys to Vercel.

---

## What you're setting up (5 steps, ~15 min)

1. Create a Neon database (free) and get its connection string.
2. Create the `projects` table.
3. Run it locally to confirm it works + import your existing clients.
4. Push to GitHub.
5. Import to Vercel with the two env vars.

---

## STEP 0 — SAVE YOUR CURRENT DATA FIRST (do this before anything else)

Your existing clients live only in your old dashboard's browser storage.
Open the old `builtbyRyder-Client-Dashboard.html`, click the `•••` menu → **Backup (JSON)**.
Keep that file. You'll import it in Step 3. Nothing can be lost once you have it.

---

## STEP 1 — Neon database

1. Go to https://neon.com and sign up (free, no card).
2. Create a project (any name, e.g. `builtbyryder`). Pick the region closest to you.
3. On the project dashboard click **Connect**.
4. Copy the **Pooled connection** string. It looks like:
   `postgresql://user:pass@ep-xxxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`

## STEP 2 — Create the table

In the Neon dashboard, open **SQL Editor**, paste the whole contents of
`db/schema.sql`, and click **Run**. That's it — the table exists.

## STEP 3 — Run locally + import your clients

```bash
# in this project folder
npm install

# create your local env file
cp .env.example .env.local
```

Open `.env.local` and set:
- `DATABASE_URL` = the pooled string from Step 1
- `DASHBOARD_PASSWORD` = a password you choose (recommended). Leave blank to run with no login.

Then:

```bash
npm run dev
```

Open http://localhost:3000. Log in (if you set a password), then `•••` menu →
**Import (JSON backup)** → pick the file you saved in Step 0. Your clients are
now in Neon.

## STEP 4 — Push to GitHub

```bash
git init
git add .
git commit -m "builtbyRyder client dashboard"
git branch -M main
# create an empty repo on github.com first (no README), then:
git remote add origin https://github.com/YOUR_USERNAME/builtbyryder-dashboard.git
git push -u origin main
```

(Your `.env.local` is gitignored — secrets are never pushed.)

## STEP 5 — Deploy to Vercel

1. Go to https://vercel.com → **Add New… → Project** → import your GitHub repo.
2. Before deploying, open **Environment Variables** and add:
   - `DATABASE_URL` = your Neon pooled string
   - `DASHBOARD_PASSWORD` = your password
3. Click **Deploy**. Done — you'll get a live URL.

Your data already lives in Neon, so the deployed site shows the same clients you
imported locally. Any device that opens the URL (and logs in) sees the same data.

---

## Notes

- **Login:** controlled entirely by `DASHBOARD_PASSWORD`. Set it = locked (30-day
  login). Unset = open to anyone with the URL. With real client data on a public
  URL, keep it set.
- **Backups:** the app saves every edit straight to Neon. Neon's free tier keeps
  a 6-hour instant-restore window — short. Use `•••` → **Backup (JSON)** now and
  then for a real off-database copy.
- **Free forever:** this app uses a tiny fraction of Neon's free limits
  (0.5 GB storage, 100 compute-hours/month).
- **Stack:** Next.js 14 (App Router), `@neondatabase/serverless`, plain SQL. One
  table, no ORM — easy to extend.
