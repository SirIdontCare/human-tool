-- Migration 007: Add Founder Human Capabilities & Task Types
--
-- Registers private-alpha task types matched to practical founder expertise:
-- 1. AI_VIDEO_REVIEW
-- 2. SOFTWARE_PRODUCT_REVIEW
-- 3. AI_WORKFLOW_REVIEW
--
-- Seeds the real founder worker node (w_founder) and verified capability mappings.

-- 1. Founder Task Types
INSERT INTO task_types (id, code, title, description, active, customer_price_usd, target_payout_usd, default_sla_minutes, required_capability, result_schema, risk_level)
VALUES
  (
    'AI_VIDEO_REVIEW',
    'AI_VIDEO_REVIEW',
    'AI Video Review & Quality Assessment',
    'Human expert judgment on whether an AI-generated video or shot is visually convincing, client-ready, technically coherent, and where the biggest quality failure is.',
    true,
    39.00,
    25.00,
    30,
    'AI_VIDEO_REVIEW',
    '{"type":"object","properties":{"verdict":{"type":"string","enum":["client_ready","minor_revisions","needs_regeneration"]},"top_issues":{"type":"array","minItems":3,"maxItems":3,"items":{"type":"object","properties":{"issue":{"type":"string","minLength":10},"evidence":{"type":"string","minLength":15},"why_it_matters":{"type":"string","minLength":15},"recommended_change":{"type":"string","minLength":15},"severity":{"type":"string","enum":["high","medium","low"]}},"required":["issue","evidence","why_it_matters","recommended_change","severity"]}},"highest_impact_change":{"type":"object","properties":{"change":{"type":"string","minLength":15},"rationale":{"type":"string","minLength":20},"expected_effect":{"type":"string","minLength":15}},"required":["change","rationale","expected_effect"]},"visual_coherence_assessment":{"type":"string","minLength":20},"motion_artifacts_assessment":{"type":"string","minLength":20},"client_readiness_assessment":{"type":"string","minLength":20},"overall_verdict":{"type":"string","minLength":20},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["verdict","top_issues","highest_impact_change","visual_coherence_assessment","motion_artifacts_assessment","client_readiness_assessment","overall_verdict","confidence"]}'::jsonb,
    'LOW'
  ),
  (
    'SOFTWARE_PRODUCT_REVIEW',
    'SOFTWARE_PRODUCT_REVIEW',
    'Software Product & Demo Review',
    'Human product judgment on whether a software product/demo makes sense, what is confusing, and what should change before showing it to users or customers.',
    true,
    39.00,
    25.00,
    30,
    'SOFTWARE_PRODUCT_REVIEW',
    '{"type":"object","properties":{"verdict":{"type":"string","enum":["ready_to_ship","needs_polish","major_friction"]},"top_issues":{"type":"array","minItems":3,"maxItems":3,"items":{"type":"object","properties":{"issue":{"type":"string","minLength":10},"evidence":{"type":"string","minLength":15},"why_it_matters":{"type":"string","minLength":15},"recommended_change":{"type":"string","minLength":15},"severity":{"type":"string","enum":["high","medium","low"]}},"required":["issue","evidence","why_it_matters","recommended_change","severity"]}},"highest_impact_change":{"type":"object","properties":{"change":{"type":"string","minLength":15},"rationale":{"type":"string","minLength":20},"expected_effect":{"type":"string","minLength":15}},"required":["change","rationale","expected_effect"]},"ux_clarity_assessment":{"type":"string","minLength":20},"value_proposition_assessment":{"type":"string","minLength":20},"onboarding_friction_assessment":{"type":"string","minLength":20},"overall_verdict":{"type":"string","minLength":20},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["verdict","top_issues","highest_impact_change","ux_clarity_assessment","value_proposition_assessment","onboarding_friction_assessment","overall_verdict","confidence"]}'::jsonb,
    'LOW'
  ),
  (
    'AI_WORKFLOW_REVIEW',
    'AI_WORKFLOW_REVIEW',
    'AI & Automation Workflow Review',
    'Human review of an AI/automation workflow when the agent needs practical judgment about whether the proposed workflow will actually work in real use.',
    true,
    39.00,
    25.00,
    30,
    'AI_WORKFLOW_REVIEW',
    '{"type":"object","properties":{"verdict":{"type":"string","enum":["production_ready","needs_safeguards","architecturally_flawed"]},"top_issues":{"type":"array","minItems":3,"maxItems":3,"items":{"type":"object","properties":{"issue":{"type":"string","minLength":10},"evidence":{"type":"string","minLength":15},"why_it_matters":{"type":"string","minLength":15},"recommended_change":{"type":"string","minLength":15},"severity":{"type":"string","enum":["high","medium","low"]}},"required":["issue","evidence","why_it_matters","recommended_change","severity"]}},"highest_impact_change":{"type":"object","properties":{"change":{"type":"string","minLength":15},"rationale":{"type":"string","minLength":20},"expected_effect":{"type":"string","minLength":15}},"required":["change","rationale","expected_effect"]},"reliability_assessment":{"type":"string","minLength":20},"edge_case_handling_assessment":{"type":"string","minLength":20},"human_in_the_loop_assessment":{"type":"string","minLength":20},"overall_verdict":{"type":"string","minLength":20},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["verdict","top_issues","highest_impact_change","reliability_assessment","edge_case_handling_assessment","human_in_the_loop_assessment","overall_verdict","confidence"]}'::jsonb,
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

-- 2. Real Founder Worker Node
INSERT INTO workers (id, display_name, email, status)
VALUES
  ('w_founder', 'Pawel (Founder)', 'pawel@human-tool.com', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  status = EXCLUDED.status;

-- 3. Founder Verified Capabilities
INSERT INTO worker_capabilities (id, worker_id, capability_code, score, status)
VALUES
  ('wc_founder_1', 'w_founder', 'AI_VIDEO_REVIEW', 0.99, 'VERIFIED'),
  ('wc_founder_2', 'w_founder', 'SOFTWARE_PRODUCT_REVIEW', 0.99, 'VERIFIED'),
  ('wc_founder_3', 'w_founder', 'AI_WORKFLOW_REVIEW', 0.99, 'VERIFIED')
ON CONFLICT (id) DO UPDATE SET
  score = EXCLUDED.score,
  status = EXCLUDED.status;
