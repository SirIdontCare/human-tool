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
      top_issues: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            issue: { type: "string", minLength: 10 },
            evidence: { type: "string", minLength: 15 },
            why_it_matters: { type: "string", minLength: 15 },
            recommended_change: { type: "string", minLength: 15 },
            severity: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["issue", "evidence", "why_it_matters", "recommended_change", "severity"],
        },
      },
      highest_impact_change: {
        type: "object",
        properties: {
          change: { type: "string", minLength: 15 },
          rationale: { type: "string", minLength: 20 },
          expected_effect: { type: "string", minLength: 15 },
        },
        required: ["change", "rationale", "expected_effect"],
      },
      trust_and_credibility_assessment: { type: "string", minLength: 20 },
      cta_assessment: { type: "string", minLength: 20 },
      us_market_fit_assessment: { type: "string", minLength: 20 },
      visual_hierarchy_assessment: { type: "string", minLength: 20 },
      overall_verdict: { type: "string", minLength: 20 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "top_issues",
      "highest_impact_change",
      "trust_and_credibility_assessment",
      "cta_assessment",
      "us_market_fit_assessment",
      "visual_hierarchy_assessment",
      "overall_verdict",
      "confidence",
    ],
  },
  ARCHITECTURE_SANITY_CHECK: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["good", "acceptable", "risky"] },
      critical_issues: { type: "array", items: { type: "string" } },
      recommended_changes: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      scaling_risks: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["verdict", "recommended_changes", "confidence"],
  },
  EXPERT_FACT_VERIFICATION: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["true", "false", "partial", "cannot_confirm"] },
      explanation: { type: "string", minLength: 10 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      source_notes: { type: "string" },
    },
    required: ["verdict", "explanation", "confidence"],
  },
  AI_VIDEO_REVIEW: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["client_ready", "minor_revisions", "needs_regeneration"] },
      top_issues: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            issue: { type: "string", minLength: 10 },
            evidence: { type: "string", minLength: 15 },
            why_it_matters: { type: "string", minLength: 15 },
            recommended_change: { type: "string", minLength: 15 },
            severity: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["issue", "evidence", "why_it_matters", "recommended_change", "severity"],
        },
      },
      highest_impact_change: {
        type: "object",
        properties: {
          change: { type: "string", minLength: 15 },
          rationale: { type: "string", minLength: 20 },
          expected_effect: { type: "string", minLength: 15 },
        },
        required: ["change", "rationale", "expected_effect"],
      },
      visual_coherence_assessment: { type: "string", minLength: 20 },
      motion_artifacts_assessment: { type: "string", minLength: 20 },
      client_readiness_assessment: { type: "string", minLength: 20 },
      overall_verdict: { type: "string", minLength: 20 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "verdict",
      "top_issues",
      "highest_impact_change",
      "visual_coherence_assessment",
      "motion_artifacts_assessment",
      "client_readiness_assessment",
      "overall_verdict",
      "confidence",
    ],
  },
  SOFTWARE_PRODUCT_REVIEW: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["ready_to_ship", "needs_polish", "major_friction"] },
      top_issues: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            issue: { type: "string", minLength: 10 },
            evidence: { type: "string", minLength: 15 },
            why_it_matters: { type: "string", minLength: 15 },
            recommended_change: { type: "string", minLength: 15 },
            severity: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["issue", "evidence", "why_it_matters", "recommended_change", "severity"],
        },
      },
      highest_impact_change: {
        type: "object",
        properties: {
          change: { type: "string", minLength: 15 },
          rationale: { type: "string", minLength: 20 },
          expected_effect: { type: "string", minLength: 15 },
        },
        required: ["change", "rationale", "expected_effect"],
      },
      ux_clarity_assessment: { type: "string", minLength: 20 },
      value_proposition_assessment: { type: "string", minLength: 20 },
      onboarding_friction_assessment: { type: "string", minLength: 20 },
      overall_verdict: { type: "string", minLength: 20 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "verdict",
      "top_issues",
      "highest_impact_change",
      "ux_clarity_assessment",
      "value_proposition_assessment",
      "onboarding_friction_assessment",
      "overall_verdict",
      "confidence",
    ],
  },
  AI_WORKFLOW_REVIEW: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["production_ready", "needs_safeguards", "architecturally_flawed"] },
      top_issues: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            issue: { type: "string", minLength: 10 },
            evidence: { type: "string", minLength: 15 },
            why_it_matters: { type: "string", minLength: 15 },
            recommended_change: { type: "string", minLength: 15 },
            severity: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["issue", "evidence", "why_it_matters", "recommended_change", "severity"],
        },
      },
      highest_impact_change: {
        type: "object",
        properties: {
          change: { type: "string", minLength: 15 },
          rationale: { type: "string", minLength: 20 },
          expected_effect: { type: "string", minLength: 15 },
        },
        required: ["change", "rationale", "expected_effect"],
      },
      reliability_assessment: { type: "string", minLength: 20 },
      edge_case_handling_assessment: { type: "string", minLength: 20 },
      human_in_the_loop_assessment: { type: "string", minLength: 20 },
      overall_verdict: { type: "string", minLength: 20 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "verdict",
      "top_issues",
      "highest_impact_change",
      "reliability_assessment",
      "edge_case_handling_assessment",
      "human_in_the_loop_assessment",
      "overall_verdict",
      "confidence",
    ],
  },
  HUMAN_JUDGMENT_REQUEST: {
    type: "object",
    properties: {
      verdict: { type: "string", minLength: 5 },
      findings: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 15 },
      },
      highest_impact_insight: { type: "string", minLength: 20 },
      recommended_next_action: { type: "string", minLength: 20 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "verdict",
      "findings",
      "highest_impact_insight",
      "recommended_next_action",
      "confidence",
    ],
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
  AI_VIDEO_REVIEW: {
    code: "AI_VIDEO_REVIEW",
    title: "AI Video Review & Quality Assessment",
    description: "Human expert judgment on whether an AI-generated video or shot is visually convincing, client-ready, technically coherent, and where the biggest quality failure is.",
    customer_price_usd: 39.0,
    target_payout_usd: 25.0,
    default_sla_minutes: 30,
    required_capability: "AI_VIDEO_REVIEW",
    risk_level: "LOW",
    mvp: true,
    result_schema: RESULT_SCHEMAS.AI_VIDEO_REVIEW,
    example_input: {
      video_url: "https://storage.googleapis.com/demo-bucket/ai-shot-01.mp4",
      generation_context: "Text-to-video prompt: Cyberpunk cityscape with flying transport, generated with Sora 2.0",
      intended_use: "Hero marketing video for high-end cinematic SaaS product",
      specific_concerns: "Temporal consistency of lighting and hand anatomy in second 3",
    },
  },
  SOFTWARE_PRODUCT_REVIEW: {
    code: "SOFTWARE_PRODUCT_REVIEW",
    title: "Software Product & Demo Review",
    description: "Human product judgment on whether a software product/demo makes sense, what is confusing, and what should change before showing it to users or customers.",
    customer_price_usd: 39.0,
    target_payout_usd: 25.0,
    default_sla_minutes: 30,
    required_capability: "SOFTWARE_PRODUCT_REVIEW",
    risk_level: "LOW",
    mvp: true,
    result_schema: RESULT_SCHEMAS.SOFTWARE_PRODUCT_REVIEW,
    example_input: {
      product_url: "https://staging.app.example.com",
      product_summary: "Autonomous AI agent workspace for automating complex back-office workflows.",
      target_users: "B2B SaaS operations managers and engineering leaders",
      key_flows_to_test: ["New project onboarding", "Connecting database credentials", "Running first autonomous task"],
    },
  },
  AI_WORKFLOW_REVIEW: {
    code: "AI_WORKFLOW_REVIEW",
    title: "AI & Automation Workflow Review",
    description: "Human review of an AI/automation workflow when the agent needs practical judgment about whether the proposed workflow will actually work in real use.",
    customer_price_usd: 39.0,
    target_payout_usd: 25.0,
    default_sla_minutes: 30,
    required_capability: "AI_WORKFLOW_REVIEW",
    risk_level: "LOW",
    mvp: true,
    result_schema: RESULT_SCHEMAS.AI_WORKFLOW_REVIEW,
    example_input: {
      workflow_summary: "Automated multi-stage LLM document classification with human fallback and Postgres persistence.",
      steps: [
        "Ingest PDF invoice via webhook",
        "Extract structured JSON with Gemini 2.0 Flash",
        "If confidence < 0.90, dispatch human-tool verification task",
        "Write validated data to financial ledger",
      ],
      failure_modes_considered: ["OCR parse failures on handwritten totals", "High webhook burst concurrency"],
      expected_throughput: "1,500 documents per day",
    },
  },
  HUMAN_JUDGMENT_REQUEST: {
    code: "HUMAN_JUDGMENT_REQUEST",
    title: "Open Human Judgment & Expertise Request",
    description: "General escape hatch for requesting capability-matched human judgment when predefined catalogue tasks do not fit.",
    customer_price_usd: 39.0,
    target_payout_usd: 25.0,
    default_sla_minutes: 30,
    required_capability: "HUMAN_JUDGMENT_REQUEST",
    risk_level: "LOW",
    mvp: true,
    result_schema: RESULT_SCHEMAS.HUMAN_JUDGMENT_REQUEST,
    example_input: {
      requested_outcome: "Evaluate whether this AI-generated commercial video shot is client-ready or needs re-rendering.",
      why_human_needed: "Automated vision models cannot reliably detect subtle uncanny-valley facial distortion and hand physics.",
      required_expertise: "AI video generation quality assessment and commercial cinematography review.",
      context: "Generated with Sora 2.0 for a B2B SaaS hero banner. Prompt: Futuristic drone camera moving through glass architecture.",
      urgency: "standard",
    },
  },
};

export function getCatalogueItem(taskType: string): TaskCatalogueItem | null {
  return TASK_CATALOGUE[taskType] || null;
}
