# DECISIONS.md

## 2026-08-17 — Founding Decisions

- Product is an **agent-first human capability layer**, not a freelancer marketplace.
- Agent buys an outcome, not a worker profile or hourly labor.
- Initial market: **USA-first**.
- Demand can be global and English-first.
- UK is the likely second supply market.
- Company should be **AI-native and extremely lean**.
- Do not hire internal humans until AI has been shown insufficient for that function.
- No active fundraising initially; inbound investor interest is welcome.
- No bidding in MVP.
- Initial pricing is fixed/catalogue-based.
- Every transaction must generate structured pricing, capability and lifecycle data.
- North Star: successful agent-initiated human tasks per week.
- Sprint 1 task types:
  - LANDING_PAGE_REVIEW
  - ARCHITECTURE_SANITY_CHECK
  - EXPERT_FACT_VERIFICATION
- Legal review remains strategically important but starts later as a controlled private pilot.
- Local photo verification remains a demo/viral capability initially.
- Main stack: Next.js + TypeScript + Neon + Vercel.
- No live payments in Sprint 1.
- No Tavus integration in Sprint 1.
- No native mobile app.
- No worker marketplace UI.
- No chat.
- No dynamic AI pricing yet.
- No multi-country complexity yet.
- REST/internal API contract comes before MCP.
- MCP should later be a thin adapter over core APIs.
- Catalogue-based task types reduce risk but do not replace parameter-level safety checks.
- First supply can be tiny: one primary + one backup per category is enough for validation.
- First demand must be real users/agents, not only technical demos.
- Founder/CAO operating principle: truth over validation; challenge bad ideas and decisions directly.

## 2026-08-17 — Sprint 1.1 Security Hardening Decisions

- Worker identity comes from an opaque **per-offer bearer token** (`otk_`, SHA-256 hashed at rest), never from `worker_id` alone. `worker_id` is at most a label.
- `GET /api/tasks/:id` and `GET /api/tasks/:id/result` **fail closed**: missing/null/invalid tokens → `401`.
- Task acceptance is one **atomic Postgres transaction** (claim + offer update + event insert); competing workers get `409 TASK_ALREADY_ACCEPTED`.
- `GET /api/events` is **internal-only**: requires `INTERNAL_DEV_SECRET` set + exact `x-internal-key` match; the `dev-internal-key` fallback was removed.
- Worker credentials are delivered **out-of-band** via `GET /api/internal/worker-auth` (secret-gated); each delivery **rotates** the per-offer token and revokes previously delivered tokens. Agent-facing responses never serialize worker credentials.
- Idempotent task replay (same `quote_id`) returns the existing task and **rotates the agent token**; the previous agent token is revoked.
- `target_payout_usd` is internal-only and never serialized. Authenticated workers see worker-only `compensation_usd`, derived server-side from the target payout after offer-token validation.
- Canonical task states are `OFFERED → ACCEPTED → IN_PROGRESS → COMPLETED` (+ terminal `CANCELLED`/`EXPIRED`/`FAILED`). `CREATED` and `SUBMITTED` are dropped from the contract to match implementation and DB.
- `result_schema` for each task type lives in **one place** (`src/lib/catalogue.ts` → `RESULT_SCHEMAS`) and must equal the DB catalogue row and the Zod validator.
- Task creation idempotency is keyed by `quote_id`; the public `idempotency_key` input field was removed.
- Schema is managed exclusively by numbered migrations; legacy `schema.sql`/`seed.sql`/`seed.ts` and `npm run db:seed` were removed.
- Internal exception details are logged server-side; clients receive a fixed public `INTERNAL_ERROR` message.
- `INTERNAL_DEV_SECRET` and `DATABASE_URL` must not be committed or exposed.
