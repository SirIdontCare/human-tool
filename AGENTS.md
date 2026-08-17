# AGENTS.md

## Purpose
This repository is operated by multiple AI coding agents.

All agents must preserve product strategy and avoid unsolicited scope expansion.

## Required Reading
Before changing production code, read:
1. `FOUNDING_SPEC.md`
2. `HUMAN_TASK_CATALOGUE.md`
3. `BUILD_SPEC.md`
4. `DECISIONS.md`

If code conflicts with these files, flag the conflict instead of silently changing strategy.

## Operating Rules

### 1. Do not redesign the company
You may improve implementation.
You may not independently change:
- target market,
- product thesis,
- pricing philosophy,
- task catalogue scope,
- company operating model,
- MVP definition.

### 2. No feature creep
Do not add features because they are "standard", "nice to have", or "future-proof".

If a missing feature blocks Sprint 1, explain why.

### 3. Prefer simple infrastructure
Current defaults:
- Next.js
- TypeScript
- Neon
- Vercel

Do not add additional databases, queues, frameworks or SaaS products without a concrete reason.

### 4. REST before MCP
Business logic belongs in the backend/API layer.
MCP will be a thin adapter later.

### 5. Data is a product asset
Do not skip lifecycle/event logging.
We need data for future pricing, routing and capability models.

### 6. Humans are outcomes, not profiles
The agent-facing product sells a result.
Do not turn the MVP into Upwork.

### 7. Safety
Reject obviously malicious or disallowed task parameters.
The catalogue limits task scope, but parameters still require validation.

### 8. Quality
Every implementation task should end with:
- lint,
- build,
- relevant tests,
- concise report,
- any unresolved risks.

### 9. Challenge bad decisions
Do not optimize for agreement.
If an instruction creates a serious technical, security or product risk, say so clearly and propose the smallest better alternative.

### 10. Do not spend paid resources unnecessarily
Prefer available low-cost/free compute for boilerplate, tests and bulk implementation.
Reserve higher-value models for architecture, review and difficult debugging.

## Agent Roles

### Antigravity / Gemini 3.7 Flash
Primary bulk builder during current Sprint 1:
- scaffolding
- backend
- frontend
- migrations
- tests
- docs
- routine fixes

### Claude Code
Use selectively for:
- architecture review
- security review
- state-machine review
- data-model review
- difficult bugs
- important PR review

### Codex
After available limit reset:
- Sprint 2
- cleanup/refactor
- MCP adapter
- higher-value implementation tasks

### OpenCode free models
Use for:
- adversarial QA
- test generation
- fixtures
- edge cases
- documentation review
- low-risk repetitive work

## Reporting Format
At the end of work, report:
- what changed,
- files changed,
- tests/build status,
- decisions made,
- unresolved issues,
- any proposal that would alter scope.
