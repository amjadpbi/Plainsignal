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

## Phase 3 (built): honest modules

**Fee & profit calculator** (`/fees`) — pure integer-cents math on Etsy's
published fee schedule. Itemized fees always sum exactly to the total.

**Listing audit** (`/audit`) — paste a listing ID or Etsy URL and get a
0–100 score across title, tags, price, photos, and description. Every rule is
grounded in either a documented Etsy limit (140-char title; 13 tag slots of 20
chars) or **real competitor data** (price is judged against the median of
active listings for the keyword). No AI opinions. When competitor data is
unavailable, price is simply **not scored** rather than guessed at.

**Trademark risk** (`/trademark`) — checks a title/tags (or a listing) against a
register of trademarks and surfaces real matches with the mark, its status, and
its owner. Exact, whole-phrase, and close-spelling matches are reported; live
registrations rank above dead ones. **No AI judges infringement** — a match is
surfaced, not interpreted.

### Why trademark runs in mock mode

There is no official, keyless USPTO API that searches marks by text
(verified 2026-07-19):

- **TESS was retired** on 2023-11-30. Its replacement,
  [Trademark Search](https://tmsearch.uspto.gov/), is a web UI with **no public API**.
- **TSDR** has an API but requires an API key tied to a USPTO.gov account, and
  it retrieves *status and documents for a known serial/registration number* —
  it is not a free-text mark search.
- The **Open Data Portal** (data.uspto.gov) offers **bulk downloads** of the
  register and, since 2026-06-18, requires signing in with a USPTO.gov account.
  The legacy Developer Hub was decommissioned 2026-06-05.

So going live means ingesting the ODP bulk register yourself or subscribing to a
commercial search API. `HttpTrademarkClient` is the seam: set
`TRADEMARK_API_URL` and `TRADEMARK_API_KEY` and it switches over, normalizing
whatever comes back into the same shape the matching logic already consumes.

> Mock records use `MOCK-…` serial numbers so a placeholder identifier can never
> be mistaken for a genuine USPTO record. The mark texts and owners are real,
> well-known registrations; the identifiers are deliberately not.

## Phase 4 (built): pricing assistant — grounded AI

`/pricing` takes a keyword plus your costs and returns three price tiers.

**The AI never picks a number.** Tier prices are the real 25th/50th/75th
percentiles of active competitor listings; profit at each tier is computed by
the fee calculator. The model's only job is to explain the tradeoff between
figures it was handed.

### The grounding guard

A prompt saying "don't invent numbers" is not enforcement. `src/lib/ai/grounding.ts`
extracts every dollar amount and percentage from the model's response and checks
each against the exact set of figures we supplied. Anything else is a
fabrication, and the narrative is **discarded** in favour of a deterministic
summary — the UI says so explicitly.

The guard is provider-agnostic and sits between *any* provider's output and the
user. Verified against the real OpenRouter adapter:

| Model output | Result |
|---|---|
| `median … $30.00 … nets $19.70 after $3.30` | shown (all figures supplied) |
| `you should clear $2,400.00 in monthly revenue` | **discarded** — `$2,400.00` not in the data |
| `expect roughly 3.5% of viewers to convert` | **discarded** — `3.5%` not in the data |

### AI providers

| `AI_PROVIDER` / keys | Behavior |
|---|---|
| no keys | Mock mode — metrics still real, narrative is a computed summary |
| `OPENROUTER_API_KEY` | **Default.** OpenAI-compatible; free models need no paid billing |
| `ANTHROPIC_API_KEY` | Alternative; requires paid billing |

`OPENROUTER_MODEL` defaults to `openrouter/free` (the free auto-router) rather
than a pinned `:free` model, because OpenRouter's free lineup rotates.

## Phase 4 (built): AI seller coach

`/coach` is a chat assistant that answers from **your own saved data** — keyword
snapshots and scores, listing audits, and fee calculations, all read through the
tenant-scoped client. It gets no general Etsy knowledge to draw figures from.

Same guard as the pricing assistant, extended to bare numbers so competition
counts are checked too. The allowed set is derived from the **serialized
context** — literally every number in the JSON handed to the model — so a
figure is admissible only if we supplied it.

Real answer against real database rows (OpenRouter, `openrouter/free`):

> **Q: "How's my linen apron niche doing?"**
> "handmade linen apron" is rated STRONG with 104 competitors, 239.25 average
> favorites… "linen apron" alone is CROWDED with 98 competitors but commands
> higher prices ($43.40 median)… Your listing 77 scores 59: priced 247% above
> the $15 market median, only 8 of 13 tags used… At $30 sale price, you net
> $18.72 (53.49% margin).

Every figure there is a row in Postgres. Asked for data that doesn't exist
("how many sales and what's my conversion rate?"), it answers *"the data does
not include sales, revenue, or conversion rate"* and cites no numbers.

### Two guard bugs the end-to-end run caught

Unit tests passed while both of these were live — only running against real data
exposed them:

1. **Figures inside supplied prose were rejected.** An audit finding reads
   *"Priced 247% above the market median of $15.00"*. The allowed set was built
   from a hand-written list of structured fields, so `247%` looked invented and
   a correct answer was discarded. The set is now derived from the serialized
   context, which also fixed a second rejection over a listing id.
2. **A decimal percentage could ride on an unrelated integer.** The tolerance
   letting `53.49` be written "53%" matched on either precision — so `2.3%`
   passed whenever the integer `2` appeared anywhere in the data. Citations are
   now precision-aware: a decimal must match a supplied decimal.

The guard failed *safe* both times (real figures were shown), but the first bug
made it over-reject and the second made it under-reject.

## Phase 5 (built): access control — manual, no payment gateway

Signup starts a **7-day trial**. Gated actions (research, audit, pricing,
coach) stop once it lapses unless an admin activates the account. Blocked users
see a specific reason and a contact, never a generic error.

| `planStatus` | Effect |
|---|---|
| `TRIAL` | Full access until `trialEndsAt`; flips to EXPIRED automatically once passed |
| `ACTIVE` | Full access, ignores the trial clock (set by an admin) |
| `EXPIRED` | Blocked — "trial ended, contact …" |
| `DISABLED` | Blocked — set by the single-device rule |

### Single-device enforcement

The browser generates a device id once and sends it as `x-device-id`; the
server stores only a **hash**. A second device does **not** silently evict the
first — it sets `DISABLED` and shows an "active session on another device"
screen with a *request access* action. Both devices are then blocked until an
admin restores, which adopts the new device.

> This is an account-sharing deterrent, not a security boundary. A request with
> no `x-device-id` can't be compared, so it passes rather than locking someone
> out over a missing header.

### Admin panel

`/admin`, gated by `isAdmin` (seeded from `ADMIN_EMAILS`). A non-admin gets a
**404**, not a 403 — the panel isn't advertised. Actions: activate, restore a
disabled user onto their new device, extend a trial, end a trial, disable.

Configure in `.env`:

```
ADMIN_EMAILS="you@example.com"     # gets is_admin on provisioning
SUPPORT_CONTACT="you@example.com"  # shown on blocked screens
```

### Why no Stripe

Access state is deliberately provider-agnostic. `PlanStatus` is what the guard
reads, and `PlanTier` is untouched and waiting — a billing webhook can set
either later without rewriting any guard logic.

## Etsy API key states

| `ETSY_API_KEY` | Behavior |
|---|---|
| empty | Mock mode — deterministic synthetic data, labeled `MOCK DATA` in the UI |
| set + approved | Live Etsy data |
| set + pending approval | Calls fail with **HTTP 502 / `ETSY_AUTH_FAILED`**, quoting Etsy's message |

A key that Etsy has not yet approved returns
`403 API key not found or not active`. The app surfaces that verbatim and
**never silently falls back to mock data** — if you want mock mode while
waiting for approval, clear `ETSY_API_KEY`.

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
