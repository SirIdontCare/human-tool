-- Migration 002: Indexes, Constraints & Token Hashes

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agent_token_hash VARCHAR(64);
ALTER TABLE task_offers ADD COLUMN IF NOT EXISTS worker_token_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_quote_id_unique ON tasks(quote_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_offers_unique ON task_offers(task_id, worker_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_capabilities_unique ON worker_capabilities(worker_id, capability_code);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_worker ON tasks(assigned_worker_id);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_task_offers_worker ON task_offers(worker_id);
CREATE INDEX IF NOT EXISTS idx_task_offers_task ON task_offers(task_id);
