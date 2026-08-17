-- Seed data for Sprint 1 Task Types and Mock Workers

INSERT INTO task_types (id, code, title, description, active, customer_price_usd, target_payout_usd, default_sla_minutes, required_capability, result_schema, risk_level)
VALUES
(
  'LANDING_PAGE_REVIEW',
  'LANDING_PAGE_REVIEW',
  'Landing Page Conversion Review',
  'Expert review of a landing page for conversion blockers, messaging clarity, and highest impact changes.',
  true,
  39.00,
  25.00,
  30,
  'UX_CONVERSION_ANALYSIS',
  '{
    "type": "object",
    "required": ["top_issues", "highest_impact_change", "conversion_blockers", "confidence"],
    "properties": {
      "top_issues": { "type": "array", "items": { "type": "string" } },
      "highest_impact_change": { "type": "string" },
      "conversion_blockers": { "type": "array", "items": { "type": "string" } },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
    }
  }'::jsonb,
  'LOW'
),
(
  'ARCHITECTURE_SANITY_CHECK',
  'ARCHITECTURE_SANITY_CHECK',
  'Architecture Sanity Check',
  'Senior engineer sanity review of architectural design, scale assumptions, and failure modes.',
  true,
  69.00,
  45.00,
  60,
  'SYSTEM_ARCHITECTURE',
  '{
    "type": "object",
    "required": ["verdict", "critical_issues", "recommended_changes", "scaling_risks", "confidence"],
    "properties": {
      "verdict": { "type": "string", "enum": ["good", "acceptable", "risky"] },
      "critical_issues": { "type": "array", "items": { "type": "string" } },
      "recommended_changes": { "type": "array", "items": { "type": "string" } },
      "scaling_risks": { "type": "array", "items": { "type": "string" } },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
    }
  }'::jsonb,
  'MEDIUM'
),
(
  'EXPERT_FACT_VERIFICATION',
  'EXPERT_FACT_VERIFICATION',
  'Expert Fact Verification',
  'Human oracle verification of critical claims, citations, and factual accuracy.',
  true,
  29.00,
  18.00,
  30,
  'FACT_CHECKING',
  '{
    "type": "object",
    "required": ["verdict", "explanation", "confidence"],
    "properties": {
      "verdict": { "type": "string", "enum": ["true", "false", "partial", "cannot_confirm"] },
      "explanation": { "type": "string" },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
      "source_notes": { "type": "string" }
    }
  }'::jsonb,
  'LOW'
)
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  customer_price_usd = EXCLUDED.customer_price_usd,
  target_payout_usd = EXCLUDED.target_payout_usd,
  default_sla_minutes = EXCLUDED.default_sla_minutes,
  required_capability = EXCLUDED.required_capability,
  result_schema = EXCLUDED.result_schema,
  risk_level = EXCLUDED.risk_level;

-- Seed Mock Workers
INSERT INTO workers (id, display_name, email, status)
VALUES
  ('w_alex_ux', 'Alex Rivera', 'alex.rivera@expert.example.com', 'ACTIVE'),
  ('w_sam_arch', 'Sam Chen', 'sam.chen@expert.example.com', 'ACTIVE'),
  ('w_elena_fact', 'Dr. Elena Rostova', 'elena.rostova@expert.example.com', 'ACTIVE'),
  ('w_morgan_general', 'Morgan Taylor', 'morgan.taylor@expert.example.com', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  status = EXCLUDED.status;

-- Seed Worker Capabilities
INSERT INTO worker_capabilities (id, worker_id, capability_code, score, status)
VALUES
  ('wc_1', 'w_alex_ux', 'UX_CONVERSION_ANALYSIS', 0.98, 'VERIFIED'),
  ('wc_2', 'w_sam_arch', 'SYSTEM_ARCHITECTURE', 0.99, 'VERIFIED'),
  ('wc_3', 'w_elena_fact', 'FACT_CHECKING', 0.99, 'VERIFIED'),
  ('wc_4', 'w_morgan_general', 'UX_CONVERSION_ANALYSIS', 0.90, 'VERIFIED'),
  ('wc_5', 'w_morgan_general', 'SYSTEM_ARCHITECTURE', 0.88, 'VERIFIED'),
  ('wc_6', 'w_morgan_general', 'FACT_CHECKING', 0.92, 'VERIFIED')
ON CONFLICT (id) DO NOTHING;
