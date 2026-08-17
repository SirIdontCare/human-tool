-- Migration 003: Core MVP Task Types & Verified Worker Seed Data

-- 1. MVP Task Types
INSERT INTO task_types (id, code, title, description, active, customer_price_usd, target_payout_usd, default_sla_minutes, required_capability, result_schema, risk_level)
VALUES
  (
    'LANDING_PAGE_REVIEW',
    'LANDING_PAGE_REVIEW',
    'Landing Page Review & Conversion Audit',
    'Expert human evaluation of landing page conversion blockers, hero messaging clarity, and highest impact visual improvements.',
    true,
    39.00,
    25.00,
    30,
    'UX_CONVERSION_ANALYSIS',
    '{"type": "object", "properties": {"top_issues": {"type": "array", "items": {"type": "string"}}, "highest_impact_change": {"type": "string"}, "conversion_blockers": {"type": "array", "items": {"type": "string"}}, "confidence": {"type": "number"}}, "required": ["top_issues", "highest_impact_change", "confidence"]}'::jsonb,
    'LOW'
  ),
  (
    'ARCHITECTURE_SANITY_CHECK',
    'ARCHITECTURE_SANITY_CHECK',
    'Architecture Sanity Check & Scaling Assessment',
    'Senior cloud architect review of system architecture proposals, connection bottlenecks, single points of failure, and scalability risks.',
    true,
    69.00,
    45.00,
    60,
    'SYSTEM_ARCHITECTURE',
    '{"type": "object", "properties": {"verdict": {"type": "string", "enum": ["acceptable", "risky", "unacceptable"]}, "critical_issues": {"type": "array", "items": {"type": "string"}}, "recommended_changes": {"type": "array", "items": {"type": "string"}}, "scaling_risks": {"type": "array", "items": {"type": "string"}}, "confidence": {"type": "number"}}, "required": ["verdict", "critical_issues", "recommended_changes", "confidence"]}'::jsonb,
    'MEDIUM'
  ),
  (
    'EXPERT_FACT_VERIFICATION',
    'EXPERT_FACT_VERIFICATION',
    'Expert Fact Verification & Grounding Check',
    'Domain expert verification of critical factual claims, mathematical correctness, or technical claims with citations.',
    true,
    29.00,
    18.00,
    30,
    'FACT_CHECKING',
    '{"type": "object", "properties": {"verdict": {"type": "string", "enum": ["true", "false", "unverifiable", "misleading"]}, "explanation": {"type": "string"}, "confidence": {"type": "number"}, "source_notes": {"type": "string"}}, "required": ["verdict", "explanation", "confidence"]}'::jsonb,
    'LOW'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  customer_price_usd = EXCLUDED.customer_price_usd,
  target_payout_usd = EXCLUDED.target_payout_usd,
  default_sla_minutes = EXCLUDED.default_sla_minutes,
  required_capability = EXCLUDED.required_capability,
  result_schema = EXCLUDED.result_schema,
  risk_level = EXCLUDED.risk_level;

-- 2. Mock Workers
INSERT INTO workers (id, display_name, email, status)
VALUES
  ('w_alex_ux', 'Alex Rivera (Senior UX Specialist)', 'alex@example.com', 'ACTIVE'),
  ('w_sam_arch', 'Sam Chen (Principal Cloud Architect)', 'sam@example.com', 'ACTIVE'),
  ('w_elena_fact', 'Dr. Elena Rostova (Research Analyst)', 'elena@example.com', 'ACTIVE'),
  ('w_morgan_general', 'Morgan Taylor (Full-Stack Engineer)', 'morgan@example.com', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  status = EXCLUDED.status;

-- 3. Worker Capabilities
CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_capabilities_unique ON worker_capabilities(worker_id, capability_code);

INSERT INTO worker_capabilities (id, worker_id, capability_code, score, status)
VALUES
  ('wc_1', 'w_alex_ux', 'UX_CONVERSION_ANALYSIS', 0.98, 'VERIFIED'),
  ('wc_2', 'w_sam_arch', 'SYSTEM_ARCHITECTURE', 0.99, 'VERIFIED'),
  ('wc_3', 'w_elena_fact', 'FACT_CHECKING', 0.99, 'VERIFIED'),
  ('wc_4', 'w_morgan_general', 'UX_CONVERSION_ANALYSIS', 0.90, 'VERIFIED'),
  ('wc_5', 'w_morgan_general', 'SYSTEM_ARCHITECTURE', 0.88, 'VERIFIED'),
  ('wc_6', 'w_morgan_general', 'FACT_CHECKING', 0.92, 'VERIFIED')
ON CONFLICT (id) DO UPDATE SET
  score = EXCLUDED.score,
  status = EXCLUDED.status;
