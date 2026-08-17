-- Migration 006: Strengthen LANDING_PAGE_REVIEW Result Schema
--
-- Updates the published result_schema for LANDING_PAGE_REVIEW in task_types to
-- require exactly 3 top issues (with issue, evidence, why_it_matters, recommended_change,
-- and severity), a structured highest_impact_change object (change, rationale,
-- expected_effect), multidimensional assessments (trust_and_credibility, cta,
-- us_market_fit, visual_hierarchy), and an overall_verdict with minLength constraints.
--
-- Single source of truth: src/lib/catalogue.ts RESULT_SCHEMAS (which exactly
-- matches the Zod submission validators in src/lib/schemas.ts).

UPDATE task_types
SET result_schema = '{"type":"object","properties":{"top_issues":{"type":"array","minItems":3,"maxItems":3,"items":{"type":"object","properties":{"issue":{"type":"string","minLength":10},"evidence":{"type":"string","minLength":15},"why_it_matters":{"type":"string","minLength":15},"recommended_change":{"type":"string","minLength":15},"severity":{"type":"string","enum":["high","medium","low"]}},"required":["issue","evidence","why_it_matters","recommended_change","severity"]}},"highest_impact_change":{"type":"object","properties":{"change":{"type":"string","minLength":15},"rationale":{"type":"string","minLength":20},"expected_effect":{"type":"string","minLength":15}},"required":["change","rationale","expected_effect"]},"trust_and_credibility_assessment":{"type":"string","minLength":20},"cta_assessment":{"type":"string","minLength":20},"us_market_fit_assessment":{"type":"string","minLength":20},"visual_hierarchy_assessment":{"type":"string","minLength":20},"overall_verdict":{"type":"string","minLength":20},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["top_issues","highest_impact_change","trust_and_credibility_assessment","cta_assessment","us_market_fit_assessment","visual_hierarchy_assessment","overall_verdict","confidence"]}'::jsonb
WHERE code = 'LANDING_PAGE_REVIEW';
