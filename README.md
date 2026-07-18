# Plainsignal

Analytics and workflow SaaS for Etsy sellers. Honest, data-grounded metrics —
every number traces back to a real Etsy signal (see [CLAUDE.md](CLAUDE.md) for the
full product spec and principles).

## Phase 1 (built)

- Next.js + TypeScript app (App Router) with Tailwind UI.
- Prisma schema for the full data model (multi-tenant from the start).
- Etsy Open API v3 client with Redis caching + rate limiting (5 req/s, 5000/day).
- **Keyword research module**, end to end, running in **mock mode** until an
  Etsy API key is set.

## Phase 2, step 5 (built): auth + tenant isolation

Supabase is the **identity issuer only** — all application data lives in our own
Postgres (CLAUDE.md §2).

- `/signup` and `/login` pages backed by Supabase Auth.
- The browser attaches the Supabase access token as `Authorization: Bearer …`
  (see `authedFetch` in `src/lib/supabase/browser.ts`).
- **Every protected API route** calls `requireUser()`
  (`src/lib/auth/require-user.ts`), which:
  1. verifies the JWT server-side via GoTrue (never trusts unverified claims),
  2. resolves it to our `User` row via `supabase_auth_id`, provisioning on first
     sight, and
  3. returns a **tenant-scoped DB** bound to that user's id.
- **Tenant isolation is centralized** in `tenantDb(userId)`
  (`src/lib/db/tenant.ts`). Every method hard-codes the `userId` filter on reads
  and stamps it on writes, so a route cannot forget it.

  > **Rule:** routes must use `tenantDb(...)` for user-owned models
  > (Shop / Search and their children) and never the raw `prisma` client.

Protected routes: `GET /api/me`, `GET /api/searches`,
`POST /api/keywords/research`, `GET /api/trends`, `GET /api/trends/series`.

## Phase 2, step 6 (built): snapshot history + trend view

Every research run writes a dated `KeywordSnapshot` (+ its `KeywordScore`) for
each analyzed keyword, in one atomic nested write tied to that `Search`. Run the
same keyword again later and you get another point in its time-series.

- `/trends` — pick a tracked keyword and see competition, opportunity, and avg
  favorites over time (dependency-free inline SVG charts), plus a table of every
  capture and the first→latest deltas.
- History is tenant-scoped through the owning search (`search: { userId }`), so
  one account can never read another's capture history.

> **In mock mode the numbers don't move.** Mock data is deterministic per
> keyword, so repeated runs record identical values at different timestamps —
> the history mechanism works, but the lines are flat by construction. Real
> movement appears once `ETSY_API_KEY` is set.

## Local setup

No Docker, no local database daemon required.

1. **Install**
   ```bash
   npm install
   ```

2. **Environment** — copy the example and fill in values:
   ```bash
   cp .env.example .env
   ```
   - `DATABASE_URL` — a hosted Neon Postgres connection string (keep
     `sslmode=require`). Only needed once you persist searches/snapshots (Phase 2).
   - `REDIS_URL` — leave empty for local dev; the app falls back to an in-process
     cache + rate-limit store. Set a hosted Redis (e.g. Upstash) when you need
     shared caching or run multiple instances.
   - `ETSY_API_KEY` — leave empty to run in **mock mode**. Set it to make real,
     rate-limited Etsy calls.

3. **Prisma client** (safe without a live DB):
   ```bash
   npm run prisma:generate
   ```
   Once `DATABASE_URL` points at your Neon database, apply migrations:
   ```bash
   npm run prisma:migrate:deploy
   ```

4. **Run**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 and research a seed keyword.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (scoring, rate limiter, Etsy client, service) |
| `npm run prisma:generate` | Generate the Prisma client |
| `npm run prisma:migrate` | Create/apply a dev migration |

## Mock mode

While `ETSY_API_KEY` is empty, the Etsy client returns **deterministic synthetic
data** (clearly labeled `MOCK DATA` in the UI and in the API response's `isMock`
flag). This exists to exercise the pipeline without credentials — it is never
presented as real marketplace data.

> Docker is intentionally **not** part of local setup. It returns at the deploy
> phase for reproducible cloud builds (see CLAUDE.md §2).
