import { z } from "zod";

// Task Type Enum
export const TaskTypeCode = z.enum([
  "LANDING_PAGE_REVIEW",
  "ARCHITECTURE_SANITY_CHECK",
  "EXPERT_FACT_VERIFICATION",
]);

export type TaskTypeCode = z.infer<typeof TaskTypeCode>;

// Input schemas for each task type
export const LandingPageReviewInputSchema = z.object({
  url: z.string().url().optional(),
  page_content: z.string().min(10, "Page content or URL must be provided").optional(),
  target_audience: z.string().min(2, "Target audience description is required"),
  specific_goals: z.string().optional(),
}).refine((data) => data.url || data.page_content, {
  message: "Either url or page_content must be provided",
  path: ["url"],
});

export const ArchitectureSanityCheckInputSchema = z.object({
  architecture_summary: z.string().min(20, "Architecture summary must be at least 20 characters"),
  components: z.array(z.string()).min(1, "At least one component must be specified"),
  expected_scale: z.string().min(5, "Expected scale (e.g. 10k rps, 1M MAU) is required"),
  key_concerns: z.array(z.string()).optional(),
});

export const ExpertFactVerificationInputSchema = z.object({
  claim: z.string().min(5, "Claim to verify must be provided"),
  context: z.string().min(10, "Context surrounding the claim is required"),
  sources: z.array(z.string()).optional().default([]),
});

// Result schemas according to HUMAN_TASK_CATALOGUE.md and BUILD_SPEC.md
export const LandingPageIssueSchema = z.object({
  issue: z.string().min(10, "Issue description must be at least 10 characters"),
  evidence: z.string().min(15, "Evidence must be at least 15 characters"),
  why_it_matters: z.string().min(15, "Why it matters must be at least 15 characters"),
  recommended_change: z.string().min(15, "Recommended change must be at least 15 characters"),
  severity: z.enum(["high", "medium", "low"]),
});

export const LandingPageHighestImpactChangeSchema = z.object({
  change: z.string().min(15, "Highest impact change must be at least 15 characters"),
  rationale: z.string().min(20, "Rationale must be at least 20 characters"),
  expected_effect: z.string().min(15, "Expected effect must be at least 15 characters"),
});

export const LandingPageReviewResultSchema = z.object({
  top_issues: z
    .array(LandingPageIssueSchema)
    .length(3, "Exactly 3 top issues are required"),
  highest_impact_change: LandingPageHighestImpactChangeSchema,
  trust_and_credibility_assessment: z
    .string()
    .min(20, "Trust and credibility assessment must be at least 20 characters"),
  cta_assessment: z
    .string()
    .min(20, "CTA assessment must be at least 20 characters"),
  us_market_fit_assessment: z
    .string()
    .min(20, "US market fit assessment must be at least 20 characters"),
  visual_hierarchy_assessment: z
    .string()
    .min(20, "Visual hierarchy assessment must be at least 20 characters"),
  overall_verdict: z
    .string()
    .min(20, "Overall verdict must be at least 20 characters"),
  confidence: z
    .number()
    .min(0, "Confidence must be between 0.0 and 1.0")
    .max(1, "Confidence must be between 0.0 and 1.0"),
});

export const ArchitectureSanityCheckResultSchema = z.object({
  verdict: z.enum(["good", "acceptable", "risky"]),
  critical_issues: z.array(z.string()).default([]),
  recommended_changes: z.array(z.string().min(1)).min(1, "At least one recommendation required"),
  scaling_risks: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1, "Confidence must be between 0.0 and 1.0"),
});

export const ExpertFactVerificationResultSchema = z.object({
  verdict: z.enum(["true", "false", "partial", "cannot_confirm"]),
  explanation: z.string().min(10, "Explanation must be at least 10 characters"),
  confidence: z.number().min(0).max(1, "Confidence must be between 0.0 and 1.0"),
  source_notes: z.string().optional(),
});

// Helper to validate input payload based on task type
export function validateTaskInput(taskType: string, payload: unknown) {
  switch (taskType) {
    case "LANDING_PAGE_REVIEW":
      return LandingPageReviewInputSchema.safeParse(payload);
    case "ARCHITECTURE_SANITY_CHECK":
      return ArchitectureSanityCheckInputSchema.safeParse(payload);
    case "EXPERT_FACT_VERIFICATION":
      return ExpertFactVerificationInputSchema.safeParse(payload);
    default:
      return {
        success: false as const,
        error: new z.ZodError([
          {
            code: z.ZodIssueCode.custom,
            path: ["task_type"],
            message: `Unsupported task type: ${taskType}`,
          },
        ]),
      };
  }
}

// Helper to validate result payload based on task type
export function validateTaskResult(taskType: string, result: unknown) {
  switch (taskType) {
    case "LANDING_PAGE_REVIEW":
      return LandingPageReviewResultSchema.safeParse(result);
    case "ARCHITECTURE_SANITY_CHECK":
      return ArchitectureSanityCheckResultSchema.safeParse(result);
    case "EXPERT_FACT_VERIFICATION":
      return ExpertFactVerificationResultSchema.safeParse(result);
    default:
      return {
        success: false as const,
        error: new z.ZodError([
          {
            code: z.ZodIssueCode.custom,
            path: ["task_type"],
            message: `Unsupported task type: ${taskType}`,
          },
        ]),
      };
  }
}

// API Request/Response Schemas
export const CreateQuoteRequestSchema = z.object({
  task_type: z.string(),
  input_payload: z.record(z.any()),
  deadline_minutes: z.number().int().positive().optional(),
});

export const CreateTaskRequestSchema = z.object({
  // Idempotency is keyed by quote_id (tasks.quote_id is unique). No separate
  // idempotency_key parameter is accepted: exposing a field with false
  // semantics would mislead API clients.
  quote_id: z.string().min(1, "quote_id is required"),
});

export const AcceptTaskRequestSchema = z.object({
  // worker_id is an OPTIONAL consistency assertion. Identity is always derived
  // from the per-offer worker token; worker_id never authenticates or selects
  // identity.
  worker_id: z.string().min(1).optional(),
});

export const StartTaskRequestSchema = z.object({
  worker_id: z.string().min(1, "worker_id is required"),
});

export const SubmitTaskResultRequestSchema = z.object({
  worker_id: z.string().min(1, "worker_id is required"),
  result_payload: z.record(z.any()),
});
