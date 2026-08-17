-- Migration 004: Security Contract Reconciliation
--
-- Reconciles schema drift on already-migrated databases WITHOUT rewriting
-- applied migrations. Safe on fresh schemas (every statement is guarded or a
-- no-op when invariants already hold). Existing customer rows are preserved.
--
-- Canonical task state machine: OFFERED -> ACCEPTED -> IN_PROGRESS -> COMPLETED
-- with terminal states CANCELLED / EXPIRED / FAILED.

-- ============================================================
-- 1. tasks.agent_token_hash NOT NULL (fail-closed agent auth)
--    NULL/empty hashes are backfilled with a random unverifiable hash so the
--    invariant can be enforced. No token will ever verify against such a hash
--    (fail closed with 401), but task data and completed customer results are
--    preserved. New tasks always receive a real token hash at creation.
--    (gen_random_uuid() is core PG14+; avoids the pgcrypto extension.)
-- ============================================================
UPDATE tasks
SET agent_token_hash = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE agent_token_hash IS NULL OR agent_token_hash = '';

ALTER TABLE tasks ALTER COLUMN agent_token_hash SET NOT NULL;

-- ============================================================
-- 2. task_offers.worker_token_hash NOT NULL (same fail-closed backfill)
-- ============================================================
UPDATE task_offers
SET worker_token_hash = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE worker_token_hash IS NULL OR worker_token_hash = '';

ALTER TABLE task_offers ALTER COLUMN worker_token_hash SET NOT NULL;

-- ============================================================
-- 3. Unique invariant on tasks.quote_id (idempotent task creation)
--    If drift produced duplicates, keep the row that best preserves customer
--    value: a row with a delivered result wins; otherwise the earliest row.
--    Duplicate rows are removed (their offers cascade).
-- ============================================================
WITH dups AS (
  SELECT quote_id
  FROM tasks
  GROUP BY quote_id
  HAVING COUNT(*) > 1
)
DELETE FROM tasks t
USING dups d
WHERE t.quote_id = d.quote_id
  AND t.id <> (
    SELECT keeper.id
    FROM tasks keeper
    WHERE keeper.quote_id = d.quote_id
    ORDER BY
      (keeper.id IN (SELECT task_id FROM task_results)) DESC,
      keeper.created_at ASC
    LIMIT 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_quote_id_unique ON tasks(quote_id);

-- ============================================================
-- 4. Canonical task status constraint
--    Legacy statuses from out-of-date prose are mapped onto the canonical
--    state machine (CREATED -> OFFERED, SUBMITTED -> COMPLETED). Any other
--    unknown status preserves work that produced a result (marked COMPLETED)
--    and is otherwise removed as invalid state.
-- ============================================================
UPDATE tasks SET status = 'OFFERED' WHERE status = 'CREATED';
UPDATE tasks SET status = 'COMPLETED' WHERE status = 'SUBMITTED';

UPDATE tasks
SET status = 'COMPLETED'
WHERE status NOT IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED')
  AND id IN (SELECT task_id FROM task_results);

DELETE FROM tasks
WHERE status NOT IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED')
  AND id NOT IN (SELECT task_id FROM task_results);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (
      status IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED')
    );
  END IF;
END $$;

-- ============================================================
-- 5. Reconcile published result_schema with the single source of truth
--    (src/lib/catalogue.ts RESULT_SCHEMAS, which exactly matches the Zod
--    validators used at submission time). Previously seeded enums drifted
--    from what submission validation actually accepts.
-- ============================================================
UPDATE task_types SET result_schema = '{"type":"object","properties":{"top_issues":{"type":"array","items":{"type":"string"}},"highest_impact_change":{"type":"string"},"conversion_blockers":{"type":"array","items":{"type":"string"}},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["top_issues","highest_impact_change","confidence"]}'::jsonb
WHERE code = 'LANDING_PAGE_REVIEW';

UPDATE task_types SET result_schema = '{"type":"object","properties":{"verdict":{"type":"string","enum":["good","acceptable","risky"]},"critical_issues":{"type":"array","items":{"type":"string"}},"recommended_changes":{"type":"array","items":{"type":"string"}},"scaling_risks":{"type":"array","items":{"type":"string"}},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["verdict","recommended_changes","confidence"]}'::jsonb
WHERE code = 'ARCHITECTURE_SANITY_CHECK';

UPDATE task_types SET result_schema = '{"type":"object","properties":{"verdict":{"type":"string","enum":["true","false","partial","cannot_confirm"]},"explanation":{"type":"string"},"confidence":{"type":"number","minimum":0,"maximum":1},"source_notes":{"type":"string"}},"required":["verdict","explanation","confidence"]}'::jsonb
WHERE code = 'EXPERT_FACT_VERIFICATION';