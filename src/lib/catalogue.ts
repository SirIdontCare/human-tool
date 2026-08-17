/**
 * Canonical result schemas — the SINGLE SOURCE OF TRUTH published via the
 * catalogue and seeded into the database (migration 004). They must exactly
 * match what the Zod validators in src/lib/schemas.ts accept (same required
 * fields, enums and numeric bounds).
 */
export const RESULT_SCHEMAS: Record<string, Record<string, unknown>> = {
  LANDING_PAGE_REVIEW: {
    type: "object",
    properties: {
      top_issues: { type: "array", items: { type: "string" } },
      highest_impact_change: { type: "string" },
      conversion_blockers: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["top_issues", "highest_impact_change", "confidence"],
  },
  ARCHITECTURE_SANITY_CHECK: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["good", "acceptable", "risky"] },
      critical_issues: { type: "array", items: { type: "string" } },
      recommended_changes: { type: "array", items: { type: "string" } },
      scaling_risks: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["verdict", "recommended_changes", "confidence"],
  },
  EXPERT_FACT_VERIFICATION: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["true", "false", "partial", "cannot_confirm"] },
      explanation: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      source_notes: { type: "string" },
    },
    required: ["verdict", "explanation", "confidence"],
  },
};

export interface TaskCatalogueItem {
  code: string;
  title: string;
  description: string;
  customer_price_usd: number;
  target_payout_usd: number;
  default_sla_minutes: number;
  required_capability: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  mvp: boolean;
  result_schema: Record<string, unknown>;
  example_input: Record<string, unknown>;
}

export const TASK_CATALOGUE: Record<string, TaskCatalogueItem> = {
  LANDING_PAGE_REVIEW: {
    code: "LANDING_PAGE_REVIEW",
    title: "Landing Page Conversion Review",
    description: "Expert review of a landing page for conversion blockers, messaging clarity, and highest impact changes.",
    customer_price_usd: 39.0,
    target_payout_usd: 25.0,
    default_sla_minutes: 30,
    required_capability: "UX_CONVERSION_ANALYSIS",
    risk_level: "LOW",
    mvp: true,
    result_schema: RESULT_SCHEMAS.LANDING_PAGE_REVIEW,
    example_input: {
      url: "https://example.com/checkout",
      target_audience: "B2B SaaS founders looking for automated human capability",
      specific_goals: "Increase demo signup rate and reduce bounce on pricing section",
    },
  },
  ARCHITECTURE_SANITY_CHECK: {
    code: "ARCHITECTURE_SANITY_CHECK",
    title: "Architecture Sanity Check",
    description: "Senior engineer sanity review of architectural design, scale assumptions, and failure modes.",
    customer_price_usd: 69.0,
    target_payout_usd: 45.0,
    default_sla_minutes: 60,
    required_capability: "SYSTEM_ARCHITECTURE",
    risk_level: "MEDIUM",
    mvp: true,
    result_schema: RESULT_SCHEMAS.ARCHITECTURE_SANITY_CHECK,
    example_input: {
      architecture_summary: "Distributed event-driven agent pipeline with Redis queue and Neon Postgres persistence.",
      components: ["Next.js API routes", "Neon Postgres", "Redis Queue", "Worker UI"],
      expected_scale: "50,000 tasks/day with p95 latency under 200ms",
      key_concerns: ["Database connection exhaustion under high concurrency", "Atomic state updates"],
    },
  },
  EXPERT_FACT_VERIFICATION: {
    code: "EXPERT_FACT_VERIFICATION",
    title: "Expert Fact Verification",
    description: "Human oracle verification of critical claims, citations, and factual accuracy.",
    customer_price_usd: 29.0,
    target_payout_usd: 18.0,
    default_sla_minutes: 30,
    required_capability: "FACT_CHECKING",
    risk_level: "LOW",
    mvp: true,
    result_schema: RESULT_SCHEMAS.EXPERT_FACT_VERIFICATION,
    example_input: {
      claim: "Neon serverless PostgreSQL supports cold start connection branching in under 500ms.",
      context: "Validating infrastructure claims before committing to database architecture specification.",
      sources: ["https://neon.tech/docs/introduction", "Architecture benchmark whitepaper"],
    },
  },
};

export function getCatalogueItem(taskType: string): TaskCatalogueItem | null {
  return TASK_CATALOGUE[taskType] || null;
}
