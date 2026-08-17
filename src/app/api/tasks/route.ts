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

    const taskType = await db.getTaskType(quote.task_type_id);
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Create task
    const task = await db.createTask({
      id: taskId,
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    // Log task_created event
    await logEvent("task_created", "task", taskId, {
      quote_id: quote.id,
      task_type: task.task_type_id,
      status: task.status,
      customer_price_usd: quote.quoted_price_usd,
      target_payout_usd: quote.target_payout_usd,
    });

    // Match and offer to qualified workers
    const capability = taskType?.required_capability || "";
    const qualifiedWorkers = await db.getWorkersByCapability(capability);

    for (const worker of qualifiedWorkers) {
      await logEvent("task_offered", "task", taskId, {
        worker_id: worker.id,
        worker_name: worker.display_name,
        target_payout_usd: quote.target_payout_usd,
        sla_minutes: quote.estimated_minutes,
      });
    }

    const origin = request.headers.get("origin") || request.nextUrl.origin || "";
    const workerTaskUrl = `${origin}/tasks/${task.id}`;

    return NextResponse.json(
      {
        task_id: task.id,
        quote_id: task.quote_id,
        task_type: task.task_type_id,
        status: task.status,
        customer_price_usd: quote.quoted_price_usd,
        target_payout_usd: quote.target_payout_usd,
        estimated_minutes: quote.estimated_minutes,
        worker_task_url: workerTaskUrl,
        created_at: task.created_at,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
