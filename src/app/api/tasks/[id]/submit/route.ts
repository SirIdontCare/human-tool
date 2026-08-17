import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { SubmitTaskResultRequestSchema, validateTaskResult } from "@/lib/schemas";
import { logEvent } from "@/lib/events";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const taskId = resolvedParams.id;

    const body = await request.json();
    const parseResult = SubmitTaskResultRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { worker_id, result_payload } = parseResult.data;

    // Fetch task
    const task = await db.getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: `Task '${taskId}' not found` }, { status: 404 });
    }

    // Validate result against task type result schema
    const resultValidation = validateTaskResult(task.task_type_id, result_payload);
    if (!resultValidation.success) {
      return NextResponse.json(
        {
          error: `Malformed result payload for task type '${task.task_type_id}'`,
          details: resultValidation.error.format(),
        },
        { status: 400 }
      );
    }

    const resultId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const submitRes = await db.submitTaskResult({
      id: resultId,
      taskId,
      workerId: worker_id,
      resultPayload: resultValidation.data as Record<string, unknown>,
    });

    if (!submitRes.success || !submitRes.task || !submitRes.result) {
      return NextResponse.json(
        { error: submitRes.error || "Failed to submit task result" },
        { status: submitRes.code || 400 }
      );
    }

    // Log lifecycle events
    await logEvent("task_submitted", "task", taskId, {
      worker_id,
      result_id: resultId,
    });

    await logEvent("task_completed", "task", taskId, {
      worker_id,
      result_id: resultId,
      status: "COMPLETED",
    });

    return NextResponse.json({
      task_id: submitRes.task.id,
      status: submitRes.task.status,
      result: submitRes.result.result_payload,
      submitted_at: submitRes.result.submitted_at,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
