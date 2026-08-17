import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { CreateTaskRequestSchema } from "@/lib/schemas";
import { logEvent } from "@/lib/events";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = CreateTaskRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { quote_id } = parseResult.data;

    // Fetch quote
    const quote = await db.getQuote(quote_id);
    if (!quote) {
      return NextResponse.json({ error: `Quote '${quote_id}' not found` }, { status: 404 });
    }

    // Check expiration
    if (new Date(quote.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        {
          error: "Quote has expired",
          quote_id,
          expires_at: quote.expires_at,
        },
        { status: 400 }
      );
    }

    // Check for existing task (Idempotency)
    const existingTask = await db.getTaskByQuoteId(quote.id);
    if (existingTask) {
      const origin = request.headers.get("origin") || request.nextUrl.origin || "";
      return NextResponse.json(
        {
          task_id: existingTask.id,
          quote_id: existingTask.quote_id,
          task_type: existingTask.task_type_id,
          status: existingTask.status,
          customer_price_usd: quote.quoted_price_usd,
          target_payout_usd: quote.target_payout_usd,
          estimated_minutes: quote.estimated_minutes,
          worker_task_url: `${origin}/tasks/${existingTask.id}`,
          created_at: existingTask.created_at,
          is_existing: true,
        },
        { status: 200 }
      );
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Create task atomically
    const createRes = await db.createTask({
      id: taskId,
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    if (createRes.is_existing) {
      const origin = request.headers.get("origin") || request.nextUrl.origin || "";
      return NextResponse.json(
        {
          task_id: createRes.task.id,
          quote_id: createRes.task.quote_id,
          task_type: createRes.task.task_type_id,
          status: createRes.task.status,
          customer_price_usd: quote.quoted_price_usd,
          target_payout_usd: quote.target_payout_usd,
          estimated_minutes: quote.estimated_minutes,
          worker_task_url: `${origin}/tasks/${createRes.task.id}`,
          created_at: createRes.task.created_at,
          is_existing: true,
        },
        { status: 200 }
      );
    }

    // Log task_created event
    await logEvent("task_created", "task", createRes.task.id, {
      quote_id: quote.id,
      task_type: createRes.task.task_type_id,
      status: createRes.task.status,
      customer_price_usd: quote.quoted_price_usd,
      target_payout_usd: quote.target_payout_usd,
    });

    // Log offer event for each offered worker
    for (const offer of createRes.offers) {
      await logEvent("task_offered", "task", createRes.task.id, {
        worker_id: offer.worker_id,
        target_payout_usd: quote.target_payout_usd,
        sla_minutes: quote.estimated_minutes,
      });
    }

    const origin = request.headers.get("origin") || request.nextUrl.origin || "";
    const primaryOffer = createRes.offers[0];
    const workerTaskUrl = primaryOffer
      ? `${origin}/tasks/${createRes.task.id}?worker_id=${primaryOffer.worker_id}&token=${primaryOffer.worker_token}`
      : `${origin}/tasks/${createRes.task.id}`;

    return NextResponse.json(
      {
        task_id: createRes.task.id,
        quote_id: createRes.task.quote_id,
        task_type: createRes.task.task_type_id,
        status: createRes.task.status,
        customer_price_usd: quote.quoted_price_usd,
        target_payout_usd: quote.target_payout_usd,
        estimated_minutes: quote.estimated_minutes,
        agent_token: createRes.agent_token,
        worker_task_url: workerTaskUrl,
        offers: createRes.offers.map((o) => ({
          worker_id: o.worker_id,
          worker_token: o.worker_token,
          worker_url: `${origin}/tasks/${createRes.task.id}?worker_id=${o.worker_id}&token=${o.worker_token}`,
        })),
        created_at: createRes.task.created_at,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
