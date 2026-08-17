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
Create a `.env` file (optional for local testing / development; defaults to zero-config in-memory mock store if `DATABASE_URL` is omitted):
```env
DATABASE_URL=postgresql://user:password@ep-cool-sample.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### Database Migration & Seed (Neon PostgreSQL)
```bash
npm run db:migrate
npm run db:seed
```

### Run Automated Tests
Runs all 9 test suites covering happy paths, race conditions, expired quotes, malformed schemas, and API handlers:
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
  "target_payout_usd": 25,
  "estimated_minutes": 30,
  "required_capability": "UX_CONVERSION_ANALYSIS",
  "expires_at": "2026-08-17T11:45:00.000Z"
}
```

### `POST /api/tasks`
Create a task from a valid, unexpired quote.
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
  "target_payout_usd": 25,
  "estimated_minutes": 30,
  "worker_task_url": "http://localhost:3000/tasks/task_1739789050_xyz789"
}
```

### `GET /api/tasks/:id`
Fetch current state and input payload of a task.

### `POST /api/tasks/:id/accept`
Worker claims the task (guarded against concurrency races).
**Request Body:**
```json
{ "worker_id": "w_alex_ux" }
```

### `POST /api/tasks/:id/start`
Worker transitions task to `IN_PROGRESS`.
**Request Body:**
```json
{ "worker_id": "w_alex_ux" }
```

### `POST /api/tasks/:id/submit`
Worker submits structured result (validated server-side against task type schema).
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
Agent retrieves structured outcome. Returns `400` if task is not yet completed.

### `GET /api/events`
Query lifecycle events (`quote_requested`, `quote_created`, `task_created`, `task_offered`, `task_accepted`, `task_started`, `task_submitted`, `task_completed`, `result_retrieved`).

---

## 5. Architecture & Constraints
- **Framework:** Next.js 15 (App Router) + TypeScript
- **Database:** Neon PostgreSQL (`@neondatabase/serverless` / `pg`) with automated schema & seed runner
- **Validation:** Zod
- **Testing:** Vitest
- **Scope Compliance:** Strictly adheres to `FOUNDING_SPEC.md`, `HUMAN_TASK_CATALOGUE.md`, `BUILD_SPEC.md`, `AGENTS.md`, and `DECISIONS.md`.
