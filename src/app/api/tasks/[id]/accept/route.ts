import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { AcceptTaskRequestSchema } from "@/lib/schemas";
import { logEvent } from "@/lib/events";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const taskId = resolvedParams.id;

    const body = await request.json();
    const parseResult = AcceptTaskRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { worker_id } = parseResult.data;

    // Verify worker exists
    const worker = await db.getWorker(worker_id);
    if (!worker) {
      return NextResponse.json({ error: `Worker '${worker_id}' not found` }, { status: 404 });
    }

    // Attempt atomic acceptance
    const acceptRes = await db.acceptTask(taskId, worker_id);
    if (!acceptRes.success || !acceptRes.task) {
      return NextResponse.json(
        { error: acceptRes.error || "Failed to accept task" },
        { status: acceptRes.code || 400 }
      );
    }

    // Log task_accepted event
    await logEvent("task_accepted", "task", taskId, {
      worker_id,
      worker_name: worker.display_name,
      status: acceptRes.task.status,
    });

    return NextResponse.json({
      task_id: acceptRes.task.id,
      status: acceptRes.task.status,
      assigned_worker_id: acceptRes.task.assigned_worker_id,
      updated_at: acceptRes.task.updated_at,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
