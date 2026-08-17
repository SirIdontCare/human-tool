import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { logEvent } from "@/lib/events";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const taskId = resolvedParams.id;

    // Check agent token authorization
    const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const customHeader = request.headers.get("x-agent-token");
    const queryToken = request.nextUrl.searchParams.get("agent_token") || request.nextUrl.searchParams.get("token");
    const agentToken = authHeader || customHeader || queryToken || "";

    const task = await db.getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: `Task '${taskId}' not found` }, { status: 404 });
    }

    // Verify token if agent_token_hash exists on task
    if (task.agent_token_hash) {
      const isAuthorized = await db.verifyAgentToken(taskId, agentToken);
      if (!isAuthorized) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid or missing agent task token" },
          { status: 401 }
        );
      }
    }

    if (task.status !== "COMPLETED") {
      return NextResponse.json(
        {
          error: "Task result is not ready",
          task_id: taskId,
          status: task.status,
          message: `Result cannot be retrieved until task is COMPLETED. Current status: ${task.status}`,
        },
        { status: 400 }
      );
    }

    const result = await db.getTaskResult(taskId);
    if (!result) {
      return NextResponse.json(
        { error: `Result for task '${taskId}' not found in database` },
        { status: 404 }
      );
    }

    // Log result_retrieved event
    await logEvent("result_retrieved", "task_result", result.id, {
      task_id: taskId,
      worker_id: result.worker_id,
    });

    return NextResponse.json({
      task_id: task.id,
      task_type: task.task_type_id,
      status: task.status,
      result: result.result_payload,
      submitted_at: result.submitted_at,
      accepted_at: result.accepted_at,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
