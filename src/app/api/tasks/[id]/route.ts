import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const taskId = resolvedParams.id;

    const task = await db.getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: `Task '${taskId}' not found` }, { status: 404 });
    }

    const taskType = await db.getTaskType(task.task_type_id);
    const quote = await db.getQuote(task.quote_id);

    return NextResponse.json({
      id: task.id,
      quote_id: task.quote_id,
      task_type: task.task_type_id,
      title: taskType?.title || task.task_type_id,
      status: task.status,
      input_payload: task.input_payload,
      customer_price_usd: quote?.quoted_price_usd ?? taskType?.customer_price_usd ?? 0,
      target_payout_usd: quote?.target_payout_usd ?? taskType?.target_payout_usd ?? 0,
      sla_minutes: quote?.estimated_minutes ?? taskType?.default_sla_minutes ?? 30,
      required_capability: taskType?.required_capability,
      risk_level: taskType?.risk_level,
      result_schema: taskType?.result_schema,
      assigned_worker_id: task.assigned_worker_id,
      created_at: task.created_at,
      updated_at: task.updated_at,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
