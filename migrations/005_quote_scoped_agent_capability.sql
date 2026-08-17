-- Migration 005: Quote-Scoped Agent Capability + Safe Worker Token Issuance
--
-- 1. quotes.agent_token_hash NOT NULL (quote-scoped agent capability)
--    The agent token is minted at quote creation and stored as a SHA-256 hash.
--    POST /api/tasks now requires this token; quote_id alone is never a
--    credential and replay no longer rotates or mints credentials.
--    Historical quotes that already produced a task inherit that task's
--    current agent_token_hash so existing credentials keep working. Quotes
--    without a task receive an unverifiable random hash (fail closed).
--
-- 2. task_offers.worker_token_issued_at TIMESTAMPTZ NULL (safe issuance)
--    The first POST issuance records the timestamp; repeat issuance without
--    explicit rotate=1 fails with 409 INVALID_STATE and never invalidates a
--    delivered token. Pre-existing hashes are marked as already issued so
--    live credentials are never silently rotated by a first call.
--
-- 3. Canonical result_schema now matches the Zod submission validators exactly,
--    including minItems / minLength constraints (single source of truth:
--    src/lib/catalogue.ts RESULT_SCHEMAS).

-- ============================================================
-- 1. quotes.agent_token_hash (quote-scoped agent capability)
-- ============================================================
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS agent_token_hash VARCHAR(64);

-- Quotes that already produced a task: inherit the task's current token hash
-- so the existing agent credential remains valid (no credential break).
UPDATE quotes q
SET agent_token_hash = t.agent_token_hash
FROM tasks t
WHERE t.quote_id = q.id
  AND (q.agent_token_hash IS NULL OR q.agent_token_hash = '');

-- Quotes without a task: unverifiable random hash (fail closed: no token will
-- ever verify against it, so quote_id alone can never authorize).
UPDATE quotes
SET agent_token_hash = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE agent_token_hash IS NULL OR agent_token_hash = '';

ALTER TABLE quotes ALTER COLUMN agent_token_hash SET NOT NULL;

-- ============================================================
-- 2. task_offers.worker_token_issued_at (safe issuance)
-- ============================================================
ALTER TABLE task_offers ADD COLUMN IF NOT EXISTS worker_token_issued_at TIMESTAMPTZ;

-- Pre-existing (pre-005) hashes were already delivered out-of-band: mark them
-- as issued so a first POST call fails with 409 instead of silently rotating
-- a credential the worker may already hold.
UPDATE task_offers
SET worker_token_issued_at = NOW()
WHERE worker_token_issued_at IS NULL
  AND worker_token_hash IS NOT NULL
  AND worker_token_hash <> '';

-- ============================================================
-- 3. Canonical result schemas (must exactly match src/lib/catalogue.ts
--    RESULT_SCHEMAS, which exactly match the Zod submission validators)
-- ============================================================
UPDATE task_types SET result_schema = '{"type":"object","properties":{"top_issues":{"type":"array","items":{"type":"string","minLength":1},"minItems":1},"highest_impact_change":{"type":"string","minLength":5},"conversion_blockers":{"type":"array","items":{"type":"string"}},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["top_issues","highest_impact_change","confidence"]}'::jsonb
WHERE code = 'LANDING_PAGE_REVIEW';

UPDATE task_types SET result_schema = '{"type":"object","properties":{"verdict":{"type":"string","enum":["good","acceptable","risky"]},"critical_issues":{"type":"array","items":{"type":"string"}},"recommended_changes":{"type":"array","items":{"type":"string","minLength":1},"minItems":1},"scaling_risks":{"type":"array","items":{"type":"string"}},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["verdict","recommended_changes","confidence"]}'::jsonb
WHERE code = 'ARCHITECTURE_SANITY_CHECK';

UPDATE task_types SET result_schema = '{"type":"object","properties":{"verdict":{"type":"string","enum":["true","false","partial","cannot_confirm"]},"explanation":{"type":"string","minLength":10},"confidence":{"type":"number","minimum":0,"maximum":1},"source_notes":{"type":"string"}},"required":["verdict","explanation","confidence"]}'::jsonb
WHERE code = 'EXPERT_FACT_VERIFICATION';
