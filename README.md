# human-tool (Sprint 1 MVP)

> **Human capability as infrastructure for AI agents.**

AI agents buy specific verified outcomes, human judgment, and expert verification programmatically via standard APIs.

---

## 1. Core End-to-End Loop

```text
AI Agent
  │
  ▼
1. POST /api/quotes ───────────► Returns price ($39/$69/$29), SLA (30m/60m), and 15m expiration
  │
  ▼
2. POST /api/tasks ────────────► Creates task from quote, offers to qualified human experts
  │
  ▼
3. POST /api/tasks/:id/accept ─► Human worker accepts task (atomic concurrency check)
  │
  ▼
4. POST /api/tasks/:id/start ──► Human worker transitions task to IN_PROGRESS
  │
  ▼
5. POST /api/tasks/:id/submit ─► Human worker submits machine-readable JSON result (Zod validated)
  │
  ▼
6. GET /api/tasks/:id/result ──► AI Agent retrieves verified structured outcome
```

---

## 2. Supported Task Catalogue (Sprint 1)

| Task Code | Title | Customer Price | Expert Payout | SLA | Risk Level | Output Structure |
|---|---|---|---|---|---|---|
| `LANDING_PAGE_REVIEW` | Landing Page Conversion Review | $39.00 | $25.00 | 30 min | `LOW` | `top_issues`, `highest_impact_change`, `conversion_blockers`, `confidence` |
| `ARCHITECTURE_SANITY_CHECK` | Architecture Sanity Check | $69.00 | $45.00 | 60 min | `MEDIUM` | `verdict`, `critical_issues`, `recommended_changes`, `scaling_risks`, `confidence` |
| `EXPERT_FACT_VERIFICATION` | Expert Fact Verification | $29.00 | $18.00 | 30 min | `LOW` | `verdict`, `explanation`, `confidence`, `source_notes` |

---

## 3. Quickstart

### Prerequisites
- Node.js >= 18 (developed & tested on Node v22)
- npm >= 9

### Install Dependencies
```bash
npm install
```

### Environment Variables
Create a `.env.local` file:
```env
DATABASE_URL=postgresql://user:password@ep-cool-sample.us-east-2.aws.neon.tech/neondb?sslmode=require
INTERNAL_DEV_SECRET=<random-secret>
```
- `DATABASE_URL` — required for real Neon runs (migration + E2E). If omitted, the app falls back to a zero-config in-memory mock store for local development only.
- `INTERNAL_DEV_SECRET` — required to call internal-only endpoints (`GET /api/events`, `GET /api/internal/worker-auth`). These fail closed with `401` when unset or mismatched.

### Database Migration (Neon PostgreSQL)
```bash
npm run db:migrate
```
Schema is managed exclusively by numbered migrations in `src/db/migrations/` (legacy `seed.sql`/`seed.ts`/`schema.sql` were removed).

### Run Automated Tests
Runs the full lifecycle suite (17 tests) and API route suite (10 tests) covering happy paths, race conditions, token authorization boundaries, payout privacy, expired quotes, malformed schemas, and API handlers:
```bash
npm test
```

### Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to access the interactive **Agent Sandbox & Live Event Stream**.

---

## 4. API Reference

### `GET /api/catalogue`
Returns active task catalogue definitions, prices, SLAs, and result schemas.

### `POST /api/quotes`
Request a guaranteed price quote.
**Request Body:**
```json
{
  "task_type": "LANDING_PAGE_REVIEW",
  "input_payload": {
    "url": "https://example.com/checkout",
    "target_audience": "B2B SaaS Founders",
    "specific_goals": "Improve trial conversions"
  }
}
```
**Response (201 Created):**
```json
{
  "available": true,
  "quote_id": "quote_1739789000_abc123",
  "task_type": "LANDING_PAGE_REVIEW",
  "customer_price_usd": 39,
  "estimated_minutes": 30,
  "required_capability": "UX_CONVERSION_ANALYSIS",
  "expires_at": "2026-08-17T11:45:00.000Z"
}
```
Internal field `target_payout_usd` is never serialized to agents.

### `POST /api/tasks`
Create a task from a valid, unexpired quote. Idempotent: replaying the same `quote_id` returns the existing task with a **rotated agent token** (the previous token is revoked).
**Request Body:**
```json
{
  "quote_id": "quote_1739789000_abc123"
}
```
**Response (201 Created):**
```json
{
  "task_id": "task_1739789050_xyz789",
  "quote_id": "quote_1739789000_abc123",
  "task_type": "LANDING_PAGE_REVIEW",
  "status": "OFFERED",
  "customer_price_usd": 39,
  "estimated_minutes": 30,
  "agent_token": "atk_...",
  "worker_task_url": "http://localhost:3000/tasks/task_1739789050_xyz789"
}
```
`agent_token` authorizes `GET /api/tasks/:id` and `GET /api/tasks/:id/result`. Worker credentials are **never** returned to the agent; they are delivered out-of-band via the internal worker-auth channel.

### `GET /api/tasks/:id`
Fetch current state and input payload. **Requires** an agent token (`Authorization: Bearer` / `x-agent-token`) or a worker offer token (`x-worker-token` / `worker_token` query param). Unauthenticated requests fail closed with `401`.
Authenticated workers additionally see `compensation_usd` (their guaranteed payout); `target_payout_usd` is never serialized.

### `POST /api/tasks/:id/accept`
Worker claims the task (atomic single Postgres transaction; concurrent second claim gets `409 TASK_ALREADY_ACCEPTED`).
**Request Body:**
```json
{ "worker_id": "w_alex_ux" }
```
Worker identity is verified from the per-offer bearer token (header `x-worker-token` or `worker_token` query param) — a matching `worker_id` alone is rejected with `401 WORKER_NOT_AUTHORIZED`.

### `POST /api/tasks/:id/start`
Worker transitions task to `IN_PROGRESS`. Same worker-token requirement as `accept`.

### `POST /api/tasks/:id/submit`
Worker submits structured result (validated server-side against the canonical task-type schema). Same worker-token requirement. Duplicate submissions get `409 RESULT_ALREADY_SUBMITTED`.
**Request Body:**
```json
{
  "worker_id": "w_alex_ux",
  "result_payload": {
    "top_issues": ["Hero value proposition is unclear"],
    "highest_impact_change": "Add 3-line quickstart above the fold",
    "conversion_blockers": ["Forced signup before viewing demo"],
    "confidence": 0.95
  }
}
```

### `GET /api/tasks/:id/result`
Agent retrieves structured outcome (requires valid agent token; fails closed). Returns `400` if task is not yet completed.

### `GET /api/internal/worker-auth` (internal only)
Delivers worker credentials out-of-band. Requires `INTERNAL_DEV_SECRET` configured and matching `x-internal-key` header. Each call rotates the per-offer token (previously delivered tokens are revoked) and returns `{ worker_id, worker_token, worker_url }`.

### `GET /api/events` (internal only)
Query lifecycle events (`quote_requested`, `quote_created`, `task_created`, `task_offered`, `task_accepted`, `task_started`, `task_submitted`, `task_completed`, `result_retrieved`). Fails closed with `401` unless `INTERNAL_DEV_SECRET` is set and the `x-internal-key` header matches; there is no fallback or dev key.

---

## 5. Model Context Protocol (MCP) Adapter (Private Alpha)

> **Status: Private Alpha**
> The human-tool MCP adapter exposes the Human Capability service layer to AI agents locally over `stdio` transport. Public hosted MCP endpoints are not yet available.

### Start the MCP Server
```bash
npm run mcp
```

### Tool Flow
```text
AI Agent
  │
  ▼
1. quote_human ─────────► Deterministic quote + agent_token credential
  │
  ▼
2. call_human ──────────► Dispatches task to qualified humans (idempotent)
  │
  ▼
3. get_result ──────────► Checks progress or retrieves structured verified outcome
```

### Available Tools

#### 1. `quote_human`
Request a deterministic quote and quote-scoped capability credential (`agent_token`) for capability-matched human work.
- **Inputs:** `task_type` (`LANDING_PAGE_REVIEW` | `ARCHITECTURE_SANITY_CHECK` | `EXPERT_FACT_VERIFICATION`), `input_payload` (object).
- **Outputs:** `quote_id`, `task_type`, `customer_price_usd`, `estimated_minutes`, `expires_at`, `agent_token`, `required_capability`.

#### 2. `call_human`
Create and dispatch a task from an unexpired quote to capability-matched workers using the quote-scoped agent capability credential.
- **Inputs:** `quote_id` (string), `agent_token` (string).
- **Outputs:** `task_id`, `quote_id`, `task_type`, `status` (`OFFERED`), `human_status` (`WAITING_FOR_ACCEPTANCE`), `customer_price_usd`, `estimated_minutes`, `is_existing`, `created_at`.
- *Note:* `OFFERED` status indicates the task has been dispatched to the worker queue; no human worker has accepted or started work yet.

#### 3. `get_result`
Check progress and retrieve the structured human outcome for a task.
- **Inputs:** `task_id` (string), `agent_token` (string).
- **Outputs:**
  - When in progress: `{ task_id, status: "OFFERED" | "ACCEPTED" | "IN_PROGRESS", human_status: "WAITING_FOR_ACCEPTANCE" | "ACCEPTED_AWAITING_START" | "IN_PROGRESS", is_ready: false, message: "..." }`
  - When completed: `{ task_id, task_type, status: "COMPLETED", human_status: "COMPLETED", is_ready: true, result: { ... }, submitted_at, accepted_at }`

### Example MCP Client Configuration

#### `claude_desktop_config.json` / Claude Code / Cline
```json
{
  "mcpServers": {
    "human-tool": {
      "command": "npx",
      "args": ["-y", "tsx", "src/mcp/index.ts"],
      "cwd": "/path/to/human-tool"
    }
  }
}
```

---

## 6. Architecture & Constraints
- **Framework:** Next.js 15 (App Router) + TypeScript
- **MCP Adapter:** `@modelcontextprotocol/sdk` (stdio transport)
- **Database:** Neon PostgreSQL (`@neondatabase/serverless` / `pg`) with numbered migrations
- **Validation:** Zod
- **Testing:** Vitest (Lifecycle, API Route, and MCP Protocol suites)
- **Scope Compliance:** Strictly adheres to `FOUNDING_SPEC.md`, `HUMAN_TASK_CATALOGUE.md`, `BUILD_SPEC.md`, `AGENTS.md`, and `DECISIONS.md`.
