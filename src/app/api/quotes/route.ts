import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { CreateQuoteRequestSchema, validateTaskInput } from "@/lib/schemas";
import { logEvent } from "@/lib/events";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = CreateQuoteRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { task_type, input_payload, deadline_minutes } = parseResult.data;

    // Check if task type exists
    const taskType = await db.getTaskType(task_type);
    if (!taskType) {
      return NextResponse.json(
        {
          error: `Unsupported task type: '${task_type}'. Valid MVP types: LANDING_PAGE_REVIEW, ARCHITECTURE_SANITY_CHECK, EXPERT_FACT_VERIFICATION`,
        },
        { status: 400 }
      );
    }

    // Validate payload against specific task type requirements
    const inputValidation = validateTaskInput(task_type, input_payload);
    if (!inputValidation.success) {
      return NextResponse.json(
        {
          error: `Invalid input payload for task type '${task_type}'`,
          details: inputValidation.error.format(),
        },
        { status: 400 }
      );
    }

    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min validity
    const estimatedMinutes = deadline_minutes || taskType.default_sla_minutes;

    // Log quote_requested event
    await logEvent("quote_requested", "quote", quoteId, {
      task_type,
      input_payload,
      deadline_minutes: estimatedMinutes,
    });

    const quote = await db.createQuote({
      id: quoteId,
      task_type_id: taskType.id,
      input_payload,
      quoted_price_usd: taskType.customer_price_usd,
      target_payout_usd: taskType.target_payout_usd,
      estimated_minutes: estimatedMinutes,
      expires_at: expiresAt,
    });

    // Log quote_created event
    await logEvent("quote_created", "quote", quoteId, {
      task_type,
      quoted_price_usd: quote.quoted_price_usd,
      target_payout_usd: quote.target_payout_usd,
      estimated_minutes: quote.estimated_minutes,
      expires_at: quote.expires_at,
    });

    return NextResponse.json(
      {
        available: true,
        quote_id: quote.id,
        task_type: quote.task_type_id,
        customer_price_usd: quote.quoted_price_usd,
        target_payout_usd: quote.target_payout_usd,
        estimated_minutes: quote.estimated_minutes,
        required_capability: taskType.required_capability,
        expires_at: quote.expires_at,
        created_at: quote.created_at,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
