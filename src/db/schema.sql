-- Neon PostgreSQL Schema for human-tool Sprint 1

CREATE TABLE IF NOT EXISTS task_types (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  customer_price_usd NUMERIC(10, 2) NOT NULL,
  target_payout_usd NUMERIC(10, 2) NOT NULL,
  default_sla_minutes INTEGER NOT NULL,
  required_capability VARCHAR(64) NOT NULL,
  result_schema JSONB NOT NULL,
  risk_level VARCHAR(32) NOT NULL DEFAULT 'LOW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workers (
  id VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker_capabilities (
  id VARCHAR(64) PRIMARY KEY,
  worker_id VARCHAR(64) NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  capability_code VARCHAR(64) NOT NULL,
  score NUMERIC(3, 2) NOT NULL DEFAULT 1.00,
  status VARCHAR(32) NOT NULL DEFAULT 'VERIFIED',
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotes (
  id VARCHAR(64) PRIMARY KEY,
  task_type_id VARCHAR(64) NOT NULL REFERENCES task_types(id),
  input_payload JSONB NOT NULL,
  quoted_price_usd NUMERIC(10, 2) NOT NULL,
  target_payout_usd NUMERIC(10, 2) NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(64) PRIMARY KEY,
  quote_id VARCHAR(64) NOT NULL REFERENCES quotes(id),
  task_type_id VARCHAR(64) NOT NULL REFERENCES task_types(id),
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  input_payload JSONB NOT NULL,
  assigned_worker_id VARCHAR(64) REFERENCES workers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_offers (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  worker_id VARCHAR(64) NOT NULL REFERENCES workers(id),
  status VARCHAR(32) NOT NULL DEFAULT 'OFFERED',
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_results (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) UNIQUE NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  worker_id VARCHAR(64) NOT NULL REFERENCES workers(id),
  result_payload JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(64) PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance and lifecycle queries
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_worker ON tasks(assigned_worker_id);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_task_offers_worker ON task_offers(worker_id);
