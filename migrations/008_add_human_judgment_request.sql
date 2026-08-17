-- Migration 008: Add Open Human Demand (HUMAN_JUDGMENT_REQUEST) Task Type
--
-- Registers the canonical HUMAN_JUDGMENT_REQUEST task type used as an escape hatch
-- for open human demand discovery and capability matching.

INSERT INTO task_types (
  id,
  code,
  title,
  description,
  active,
  customer_price_usd,
  target_payout_usd,
  default_sla_minutes,
  required_capability,
  result_schema,
  risk_level
)
VALUES (
  'HUMAN_JUDGMENT_REQUEST',
  'HUMAN_JUDGMENT_REQUEST',
  'Open Human Judgment & Expertise Request',
  'General escape hatch for requesting capability-matched human judgment when predefined catalogue tasks do not fit.',
  true,
  39.00,
  25.00,
  30,
  'HUMAN_JUDGMENT_REQUEST',
  '{"type":"object","properties":{"verdict":{"type":"string","minLength":5},"findings":{"type":"array","minItems":1,"items":{"type":"string","minLength":15}},"highest_impact_insight":{"type":"string","minLength":20},"recommended_next_action":{"type":"string","minLength":20},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["verdict","findings","highest_impact_insight","recommended_next_action","confidence"]}'::jsonb,
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
