import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { apiError, handleServiceError } from "@/lib/errors";
import { isInternalRequestAuthorized } from "@/lib/internal-auth";

/**
 * INTERNAL-ONLY worker credential delivery channel.
 *
 * Worker offer tokens are never exposed to the requesting agent. This endpoint
 * (gated by INTERNAL_DEV_SECRET) is how worker credentials reach the intended
 * worker: each successful call atomically rotates the per-offer worker token
 * and returns a fresh opaque credential plus the worker URL carrying it.
 * Previously delivered tokens are revoked.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isInternalRequestAuthorized(request)) {
      return apiError("Unauthorized: valid internal dev secret required", "UNAUTHORIZED", 401);
    }

    const taskId = request.nextUrl.searchParams.get("task_id");
    const workerId = request.nextUrl.searchParams.get("worker_id");
    if (!taskId || !workerId) {
      return apiError(
        "task_id and worker_id query parameters are required",
        "INVALID_INPUT",
        400
      );
    }

    const workerToken = await db.rotateWorkerOfferToken(taskId, workerId);
    if (!workerToken) {
      return apiError("Worker offer not found for this task", "WORKER_NOT_AUTHORIZED", 404);
    }

    const origin = request.nextUrl.origin;
    return NextResponse.json(
      {
        task_id: taskId,
        worker_id: workerId,
        worker_token: workerToken,
        worker_url: `${origin}/tasks/${taskId}?worker_id=${workerId}&token=${workerToken}`,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    return handleServiceError(err);
  }
}