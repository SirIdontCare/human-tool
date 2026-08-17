# BUILD_SPEC.md

## 0. Sprint 1 Objective
Build the smallest production-shaped system that proves:

```text
AI agent
→ requests quote
→ creates human task
→ human accepts
→ human submits structured result
→ agent retrieves result
```

No live payments in Sprint 1.

## 1. Stack
- Next.js
- TypeScript
- Neon PostgreSQL
- Vercel
- REST API first
- MCP comes after the internal API contract is stable

Do not add Supabase unless a concrete missing capability requires it.

## 2. Core Task Types
Only:
- LANDING_PAGE_REVIEW
- ARCHITECTURE_SANITY_CHECK
- EXPERT_FACT_VERIFICATION

## 3. Required Endpoints
Suggested shape; implementation may vary if justified without changing scope.

### `POST /api/quotes`
Input:
- task_type
- task payload
- optional deadline

Output:
- available
- quote_id
- price_usd
- estimated_minutes
- required_capability

### `POST /api/tasks`
Creates a task from a valid quote.

### `GET /api/tasks/:id`
Returns current task state and metadata.

### `POST /api/tasks/:id/accept`
Worker accepts task.

### `POST /api/tasks/:id/start`
Marks task in progress.

### `POST /api/tasks/:id/submit`
Worker submits structured result.

### `GET /api/tasks/:id/result`
Agent retrieves structured result if available.

## 4. Task State Machine
Canonical states (single source of truth; see DECISIONS.md — Sprint 1.1 Hardening):

```text
QUOTED
↓
OFFERED
↓
ACCEPTED
↓
IN_PROGRESS
↓
COMPLETED
```

`CREATED` and `SUBMITTED` are not part of the contract. Task creation produces `OFFERED` directly; accepted results transition to `COMPLETED` atomically.

Terminal/alternate states:
- CANCELLED
- EXPIRED
- FAILED

Invalid transitions must be blocked (enforced by `tasks_status_check` in the database).

## 5. Minimal Data Model
Required tables:

### task_types
- id
- code
- title
- active
- customer_price_usd
- target_payout_usd
- default_sla_minutes
- required_capability
- result_schema
- risk_level

### workers
- id
- display_name
- status
- created_at

### worker_capabilities
- worker_id
- capability_code
- score or status
- verified_at

### quotes
- id
- task_type_id
- input_payload
- quoted_price_usd
- estimated_minutes
- expires_at
- created_at

### tasks
- id
- quote_id
- task_type_id
- status
- input_payload
- assigned_worker_id nullable
- created_at
- updated_at

### task_offers
- id
- task_id
- worker_id
- status
- offered_at
- responded_at

### task_results
- id
- task_id
- worker_id
- result_payload
- submitted_at
- accepted_at nullable

### events
- id
- event_type
- entity_type
- entity_id
- payload
- created_at

## 6. Worker UI
Minimal worker page only:
- task summary
- compensation
- SLA
- accept
- start
- structured submission form
- success confirmation

No worker marketplace, browsing, profile system, feed or chat.

Mock workers are acceptable in Sprint 1.

## 7. Agent/API UX
API must be:
- deterministic,
- structured,
- documented,
- easy to wrap in MCP later.

No business logic should live only inside MCP.

## 8. Validation & Security
Implement:
- server-side schema validation,
- valid state-transition enforcement (DB-level CHECK constraints),
- authorization boundaries:
  - `GET /api/tasks/:id` and `GET /api/tasks/:id/result` fail closed (require a valid agent token or, for task state, a valid worker offer token),
  - worker identity for `accept`/`start`/`submit` comes from the per-offer bearer token, never `worker_id` alone,
  - `GET /api/events` and `GET /api/internal/worker-auth` are internal-only and fail closed unless `INTERNAL_DEV_SECRET` is set and the `x-internal-key` header matches (no fallback/dev key),
  - `target_payout_usd` is internal-only; authenticated workers see worker-only `compensation_usd`; agent-facing responses never contain worker credentials,
- protection against duplicate submissions,
- basic concurrency handling around task acceptance (atomic single-transaction claim; second claim → `409 TASK_ALREADY_ACCEPTED`),
- idempotency where it materially prevents duplicate task creation (keyed by `quote_id`; replays rotate the agent token and revoke the previous one),
- logging of failures (internal messages are logged server-side; clients receive a fixed public message).

Do not overbuild auth.

## 9. Event Logging
Log at minimum:
- quote_requested
- quote_created
- task_created
- task_offered
- task_accepted
- task_started
- task_submitted
- task_completed
- task_failed
- result_retrieved

This data is mandatory because it seeds the future pricing/routing models.

## 10. Tests
Minimum:
- task lifecycle happy path
- invalid state transitions
- two workers attempting to accept same task
- malformed result payload
- expired quote
- duplicate submission
- result retrieval before completion
- unsupported task type

## 11. Seed Data
Seed the 3 MVP task types and several mock workers/capabilities.

## 12. Explicit Non-Goals
Do NOT implement:
- live payments
- Stripe
- Tavus
- dynamic AI pricing
- bidding
- chat
- native mobile app
- worker social features
- multi-country support
- legal task flow
- full KYC
- full marketplace search
- autonomous operations agent

## 13. Definition of Done
Sprint 1 is done when a test/demo can show:

1. API quote request
2. task creation
3. worker acceptance
4. worker structured submission
5. task completion
6. agent/API retrieves result
7. all major lifecycle events were recorded

Build, lint and tests must pass.
