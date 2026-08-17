import { db } from "@/db";
import { CreateQuoteRequestSchema, validateTaskInput } from "@/lib/schemas";
import { ServiceError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { matchHumanCapability } from "@/lib/matching";

export interface RequestQuoteInput {
  task_type: string;
  input_payload: Record<string, unknown>;
  deadline_minutes?: number;
}

export type QuoteResponse =
  | {
      available: true;
      quote_id: string;
      task_type: string;
      customer_price_usd: number;
      estimated_minutes: number;
      required_capability: string;
      expires_at: string;
      created_at: string;
      // Raw agent capability token, returned exactly once at quote creation.
      // Stored server-side ONLY as a SHA-256 hash; never logged or persisted raw.
      agent_token: string;
      reason?: never;
      message?: never;
    }
  | {
      available: false;
      reason: string;
      task_type: string;
      message: string;
      quote_id?: never;
      customer_price_usd?: never;
      estimated_minutes?: never;
      required_capability?: never;
      expires_at?: never;
      created_at?: never;
      agent_token?: never;
    };

export async function requestQuote(input: unknown): Promise<QuoteResponse> {
  const parseResult = CreateQuoteRequestSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ServiceError(
      "Invalid quote request payload",
      "INVALID_INPUT",
      400,
      parseResult.error.format()
    );
  }

  const { task_type, input_payload, deadline_minutes } = parseResult.data;

  // 1. Fetch task type
  const taskType = await db.getTaskType(task_type);
  if (!taskType) {
    throw new ServiceError(
      `Unsupported task type: '${task_type}'`,
      "INVALID_INPUT",
      400
    );
  }

  // 2. Validate input against task type schema
  const inputValidation = validateTaskInput(task_type, input_payload);
  if (!inputValidation.success) {
    throw new ServiceError(
      `Invalid input payload for task type '${task_type}'`,
      "INVALID_INPUT",
      400,
      inputValidation.error.format()
    );
  }

  // 3. Open Demand Capability Matching (Sprint 2.2)
  // For HUMAN_JUDGMENT_REQUEST: evaluate whether active worker capabilities can honestly satisfy the request.
  let matchedCapability = taskType.required_capability;

  if (task_type === "HUMAN_JUDGMENT_REQUEST") {
    const rawData = inputValidation.data as Record<string, unknown>;
    const match = matchHumanCapability({
      requested_outcome: String(rawData.requested_outcome || ""),
      why_human_needed: String(rawData.why_human_needed || ""),
      required_expertise: String(rawData.required_expertise || ""),
      context: String(rawData.context || ""),
    });

    if (!match.matched || !match.capability_code) {
      // Record unmatched demand signal for product/capability analysis
      await logEvent("demand_unmatched", "demand", `unmatched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, {
        task_type: "HUMAN_JUDGMENT_REQUEST",
        requested_outcome: rawData.requested_outcome,
        why_human_needed: rawData.why_human_needed,
        required_expertise: rawData.required_expertise,
        context: rawData.context,
        available: false,
        reason: "NO_MATCHING_HUMAN_CAPABILITY",
        matched_capability: null,
        candidate_capability: null,
        timestamp: new Date().toISOString(),
      });

      return {
        available: false,
        reason: "NO_MATCHING_HUMAN_CAPABILITY",
        task_type: "HUMAN_JUDGMENT_REQUEST",
        message: "No verified human capability is currently active for the requested expertise.",
      };
    }

    // Live verification: check the actual database for at least one ACTIVE worker with VERIFIED capability
    const qualifiedWorkers = await db.getWorkersByCapability(match.capability_code);
    if (qualifiedWorkers.length === 0) {
      // Lexically matched candidate capability, but no active verified worker currently exists
      await logEvent("demand_unmatched", "demand", `unmatched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, {
        task_type: "HUMAN_JUDGMENT_REQUEST",
        requested_outcome: rawData.requested_outcome,
        why_human_needed: rawData.why_human_needed,
        required_expertise: rawData.required_expertise,
        context: rawData.context,
        available: false,
        reason: "NO_MATCHING_HUMAN_CAPABILITY",
        matched_capability: null,
        candidate_capability: match.capability_code,
        timestamp: new Date().toISOString(),
      });

      return {
        available: false,
        reason: "NO_MATCHING_HUMAN_CAPABILITY",
        task_type: "HUMAN_JUDGMENT_REQUEST",
        message: "No verified human capability is currently active for the requested expertise.",
      };
    }

    matchedCapability = match.capability_code;

    // Record matched demand signal
    await logEvent("demand_matched", "demand", `demand_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, {
      task_type: "HUMAN_JUDGMENT_REQUEST",
      requested_outcome: rawData.requested_outcome,
      why_human_needed: rawData.why_human_needed,
      required_expertise: rawData.required_expertise,
      available: true,
      matched_capability: matchedCapability,
      candidate_capability: matchedCapability,
      timestamp: new Date().toISOString(),
    });
  }

  const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Log quote requested event (NEVER the raw agent token)
  await logEvent("quote_requested", "quote", quoteId, {
    task_type,
    input_payload: inputValidation.data,
    deadline_minutes,
    matched_capability: matchedCapability !== taskType.required_capability ? matchedCapability : undefined,
  });

  const created = await db.createQuote({
    id: quoteId,
    task_type_id: taskType.id,
    input_payload: inputValidation.data as Record<string, unknown>,
    quoted_price_usd: taskType.customer_price_usd,
    target_payout_usd: taskType.target_payout_usd,
    estimated_minutes: taskType.default_sla_minutes,
    expires_at: expiresAt,
  });
  const quote = created.quote;

  // Log quote created event (NEVER the raw agent token)
  await logEvent("quote_created", "quote", quoteId, {
    task_type,
    customer_price_usd: quote.quoted_price_usd,
    expires_at: quote.expires_at,
  });

  // AGENT-FACING DATA SAFETY: DO NOT expose target_payout_usd or internal platform margin.
  // The raw agent token IS returned here — exactly once — because the agent
  // capability is quote-scoped and quote_id alone is never a credential.
  return {
    available: true,
    quote_id: quote.id,
    task_type: quote.task_type_id,
    customer_price_usd: quote.quoted_price_usd,
    estimated_minutes: quote.estimated_minutes,
    required_capability: matchedCapability,
    expires_at: quote.expires_at,
    created_at: quote.created_at,
    agent_token: created.agent_token,
  };
}
