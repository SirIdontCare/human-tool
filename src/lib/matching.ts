/**
 * Deterministic capability matching for open human judgment requests (Sprint 2.2).
 *
 * Evaluates whether an unmapped human request can be honestly satisfied by currently
 * active, verified worker capabilities. If no credible capability matches, returns
 * NO_MATCHING_HUMAN_CAPABILITY without fabricating a capability or silently routing.
 */

export interface CapabilityMatchResult {
  matched: boolean;
  capability_code?: string;
  reason?: string;
}

export function matchHumanCapability(input: {
  requested_outcome?: string;
  why_human_needed?: string;
  required_expertise?: string;
  context?: string;
}): CapabilityMatchResult {
  const combined = [
    input.required_expertise || "",
    input.requested_outcome || "",
    input.why_human_needed || "",
    input.context || "",
  ]
    .join(" ")
    .toLowerCase();

  // Explicit rejection for known unsupported domains (legal, medical, physical/in-person presence)
  const unsupportedKeywords = [
    "lawyer",
    "attorney",
    "legal counsel",
    "securities",
    "contract law",
    "sec compliance",
    "tax audit",
    "litigation",
    "doctor",
    "medical",
    "diagnosis",
    "radiology",
    "clinical",
    "physician",
    "prescription",
    "apartment",
    "visit",
    "photograph",
    "meter",
    "physical",
    "in-person",
    "in person",
    "on-site",
    "on site",
    "los angeles",
    "new york",
    "san francisco",
    "hardware repair",
    "car inspect",
    "driving",
  ];

  for (const kw of unsupportedKeywords) {
    if (combined.includes(kw)) {
      return { matched: false, reason: "NO_MATCHING_HUMAN_CAPABILITY" };
    }
  }

  // 1. AI Video Review (Founder capability)
  if (
    combined.includes("video") ||
    combined.includes("animation") ||
    combined.includes("sora") ||
    combined.includes("runway") ||
    combined.includes("kling") ||
    combined.includes("pika") ||
    combined.includes("cinematic") ||
    combined.includes("motion artifact") ||
    combined.includes("frame inpaint") ||
    combined.includes("shot review") ||
    combined.includes("commercial shot")
  ) {
    return { matched: true, capability_code: "AI_VIDEO_REVIEW" };
  }

  // 2. Software Product Review (Founder capability)
  if (
    combined.includes("product review") ||
    combined.includes("saas demo") ||
    combined.includes("software product") ||
    combined.includes("software demo") ||
    combined.includes("product feedback") ||
    combined.includes("buyer perspective") ||
    combined.includes("onboarding flow") ||
    combined.includes("product usability") ||
    combined.includes("product sense") ||
    combined.includes("demo review") ||
    combined.includes("product judgment")
  ) {
    return { matched: true, capability_code: "SOFTWARE_PRODUCT_REVIEW" };
  }

  // 3. AI Workflow Review (Founder capability)
  if (
    combined.includes("workflow") ||
    combined.includes("automation") ||
    combined.includes("agent loop") ||
    combined.includes("agent pipeline") ||
    combined.includes("llm pipeline") ||
    combined.includes("prompt chaining") ||
    combined.includes("langchain") ||
    combined.includes("langgraph") ||
    combined.includes("autogen") ||
    combined.includes("agent automation") ||
    combined.includes("multi-agent") ||
    combined.includes("pipeline review")
  ) {
    return { matched: true, capability_code: "AI_WORKFLOW_REVIEW" };
  }

  // 4. UX Conversion Analysis
  if (
    combined.includes("landing page") ||
    combined.includes("conversion rate") ||
    combined.includes("conversion optimization") ||
    combined.includes("checkout funnel") ||
    combined.includes("copy review")
  ) {
    return { matched: true, capability_code: "UX_CONVERSION_ANALYSIS" };
  }

  // 5. System Architecture
  if (
    combined.includes("system architecture") ||
    combined.includes("infrastructure scale") ||
    combined.includes("database scaling") ||
    combined.includes("distributed systems")
  ) {
    return { matched: true, capability_code: "SYSTEM_ARCHITECTURE" };
  }

  // 6. Fact Checking
  if (
    combined.includes("fact check") ||
    combined.includes("fact verification") ||
    combined.includes("verify claim") ||
    combined.includes("source verification")
  ) {
    return { matched: true, capability_code: "FACT_CHECKING" };
  }

  return { matched: false, reason: "NO_MATCHING_HUMAN_CAPABILITY" };
}
