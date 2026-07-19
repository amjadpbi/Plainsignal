# Plainsignal — project spec (founding context for Claude Code)

This file is the standing context for every Claude Code session on this project.
Read it before making changes. It defines what we're building, the stack, the data
model, the build order, and the rules that keep the system coherent across sessions.

---

## 1. What this is

An analytics and workflow SaaS for Etsy sellers. It does keyword research, niche
validation, pricing strategy, fee calculation, listing audits, trademark risk checks,
and AI seller coaching.

**Internal-tool first, sold as SaaS later.** Build for multi-tenant from the data model
up, but the first usable version is for the owner's own Etsy business.

### The core principle (do not violate this)

Every metric shown to a user must be grounded in real data, not invented by a language
model. The reference product we're improving on (Etsify) wrapped an LLM and presented its
guesses as analytics — that is the failure mode we are avoiding. Real Etsy marketplace
signals are the moat; the LLM is a reasoning layer on top of real numbers, never a
substitute for them.

### The honest-data constraint

- Etsy's Open API v3 exposes: active-listing **counts** per query (real competition),
  per-listing favorites/views/price/tags, and autosuggest (real long-tail keywords).
- Etsy exposes **no search-volume endpoint.** Confirmed in Etsy's own developer forum.
  Where volume is shown, it must come from the Google Keyword Planner (Google Ads API)
  as a proxy and be **labeled as a Google proxy** in the UI. Never present a fabricated
  volume as if it were Etsy's.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | Next.js + TypeScript | One framework for UI and API routes; scales; strong Claude Code support |
| Database | PostgreSQL (via Prisma ORM) | Saved searches, users, historical tracking — the compounding value |
| Cache / queue | Redis | Etsy rate limits make response caching mandatory; also backs job queues |
| Background jobs | BullMQ (on Redis) | Scheduled Etsy ingestion, keyword-tracking snapshots |
| Auth | Supabase Auth (auth only) | Managed auth from day one; identity issuer only — app data stays in our own Postgres |
| Access control | Manual, admin-driven (no gateway) | Trial + admin activation + single-device lock. `PlanStatus` is provider-agnostic so automated billing can drive it later without a rework |
| Billing | Deferred | No payment provider is integrated. `PlanTier` exists for when one is |
| AI layer | OpenRouter (default) or Anthropic — provider-agnostic | Grounded prompts only — real numbers passed in as context. OpenRouter has free models, so no paid billing is required; Anthropic is an opt-in alternative. A numeric **grounding guard** sits between ANY provider's output and the user and discards narratives citing figures we didn't supply |
| Deploy | Docker | Deferred to the deploy phase — NOT part of local setup (see below) |

**Local setup (current):** run the app with plain `npm run dev`. Postgres is a
hosted Neon connection string (`DATABASE_URL`, keep `sslmode=require`); Redis is
optional locally — when `REDIS_URL` is empty the app falls back to an in-process
cache/rate-limit store. No Docker or local database daemon is required to develop.

**Docker is deferred:** containerization / `docker-compose` will be reintroduced
only at the deploy phase for reproducible cloud builds. Do not add Dockerfiles or
compose files to the local workflow before then.

Rules: TypeScript everywhere. Prisma migrations for all schema changes. No secrets in
code — environment variables only. Don't over-architect early; split services out only
when load justifies it.

---

## 3. Data model (first cut — evolve via Prisma migrations)

- **User** — id, email, supabase_auth_id (the verified identity from Supabase), plan tier, created_at
- **Shop** — id, user_id, etsy_shop_id (nullable until connected), name
- **Search** — id, user_id, seed_keyword, created_at (saved research runs)
- **KeywordSnapshot** — id, keyword, competition_count, avg_favorites, price_min/med/max,
  captured_at (time-series — this is what lets us show trends competitors can't)
- **KeywordScore** — derived difficulty/demand/opportunity for a snapshot
- **AuditRun** — id, shop_id, listing_id, score, findings_json, created_at

Multi-tenant from the start: every user-owned row carries user_id and is filtered by it.

---

## 4. Modules (full suite — built in the order in section 5)

1. **Keyword & niche research** — seed → autosuggest expansion → real competition counts
   + favorites → difficulty/demand/opportunity scores → niche verdict. THE CORE.
2. **Niche validation** — deeper rollup on a niche: saturation, price viability, gem count.
3. **Fee & profit calculator** — pure math on Etsy's real fee structure. Honest, easy.
4. **Listing audit** — pulls a real listing, scores title/tags/price against the data.
5. **Pricing assistant** — competitor price spread (real) + AI-suggested tiers (grounded).
6. **Trademark risk** — real check against USPTO's trademark search API, not an LLM opinion.
7. **AI seller coach** — chat assistant; always fed the user's real shop/keyword data.

Modules 3, 4, 6 are data/math-grounded and honest by nature — prioritize them over the
AI-flavored ones. Modules 5 and 7 use the LLM but only over real numbers.

---

## 5. Build order (one focus per session)

**Phase 1 — spine**
1. Repo scaffold: Next.js + TS + Prisma + Docker + env structure.
2. Postgres schema + migrations for the data model above.
3. Etsy API client: real calls, Redis caching, rate limiting (5 req/s, 5000/day).
4. Keyword research module (backend service + scoring, then UI). Mock mode until key set.

**Phase 2 — accounts & persistence**
5. Supabase Auth (auth only) + multi-tenant enforcement. Verify the Supabase JWT on
   every request, resolve it to our User row via supabase_auth_id, and filter every
   user-owned query by user_id in app code. Tenant isolation lives in the application
   layer (Prisma), NOT Supabase RLS — our tables are in our own Postgres. One missed
   user_id filter is a cross-tenant data leak; centralize the filter so it can't be
   forgotten (a scoped Prisma client or a shared query helper).
6. Saved searches + KeywordSnapshot history + a simple trend view.

**Phase 3 — honest modules**
7. Fee calculator. 8. Listing audit. 9. Trademark risk (USPTO API).

**Phase 4 — AI layer (grounded)**
10. Pricing assistant. 11. AI seller coach. Both receive real data in every prompt.

**Phase 5 — access control (replaces the Stripe plan for now)**
12. Manual, admin-driven access control. **No payment gateway.**
    - `User.planStatus` (TRIAL / ACTIVE / EXPIRED / DISABLED), `trialEndsAt`,
      `isAdmin`, `activeDeviceId`.
    - Signup starts a **7-day trial**. Once it lapses, ALL product features
      are blocked unless an admin sets ACTIVE — research, audit, pricing,
      coach, fee calculator, trademark check. The block states *why* with a
      contact, never a generic error. `/api/me` stays ungated so a blocked
      user can load the screen explaining the block.
    - **Single-device enforcement:** a second device does NOT evict the first.
      It sets DISABLED and shows an "active session on another device" screen
      with a "request access" action, which an admin resolves.
    - Admin panel at `/admin`, gated by `isAdmin` (seeded from `ADMIN_EMAILS`),
      denying with a 404 so it isn't advertised. Actions: activate, restore a
      disabled user onto their new device, extend/end a trial, disable.
    - Keep this provider-agnostic: a billing webhook should be able to drive
      `planStatus`/`PlanTier` later without touching the guard logic.

Ship and use each phase before starting the next.

---

## 6. Subagents & model routing

This is how we get "stronger model for hard work, cheaper model for routine work"
without manual switching mid-task. Define these as Claude Code subagents:

- **architect** — pinned to the strongest available model. Owns schema design, the Etsy
  client, scoring logic, security-sensitive code, and any multi-file refactor.
- **builder** — mid-tier model. Owns UI components, CRUD endpoints, wiring, styling.
- **scaffolder** — cheaper/faster model. Owns boilerplate, config files, test stubs,
  repetitive edits.

The orchestrating session routes each task to the right agent by its nature. Note: model
availability and any Fable-tier safeguard routing are controlled by Anthropic, not by this
config — the config picks among what's available to your account, it can't override
platform routing.

---

## 7. Working rules for Claude Code

- One module/phase per session; don't sprawl across the whole suite at once.
- Every schema change is a Prisma migration, never a hand-edit.
- No metric ships without a real data source behind it (see section 1).
- Label any Google-proxy volume as such in the UI.
- Write tests for scoring logic and the Etsy client — those are the load-bearing parts.
- Keep secrets in env vars; never commit keys.
- When a task is ambiguous, ask before building — don't guess at product direction.
