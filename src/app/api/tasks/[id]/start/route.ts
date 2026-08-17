import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { StartTaskRequestSchema } from "@/lib/schemas";
import { logEvent } from "@/lib/events";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const taskId = resolvedParams.id;

    const body = await request.json();
    const parseResult = StartTaskRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { worker_id } = parseResult.data;

    const startRes = await db.startTask(taskId, worker_id);
    if (!startRes.success || !startRes.task) {
      return NextResponse.json(
        { error: startRes.error || "Failed to start task" },
        { status: startRes.code || 400 }
      );
    }

    // Log task_started event
    await logEvent("task_started", "task", taskId, {
      worker_id,
      status: startRes.task.status,
    });

    return NextResponse.json({
      task_id: startRes.task.id,
      status: startRes.task.status,
      assigned_worker_id: startRes.task.assigned_worker_id,
      updated_at: startRes.task.updated_at,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
