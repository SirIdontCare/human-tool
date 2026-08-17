import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { apiError, handleServiceError } from "@/lib/errors";
import { isInternalRequestAuthorized } from "@/lib/internal-auth";

/**
 * INTERNAL-ONLY worker credential delivery channel (PRIVATE-ALPHA).
 *
 * Worker offer tokens are never exposed to the requesting agent and never
 * stored raw. This endpoint (gated by INTERNAL_DEV_SECRET) delivers a fresh
 * opaque credential to the intended worker:
 *
 * - FIRST POST issuance: row-locked, atomically generates a token, stores only
 *   its hash, records worker_token_issued_at, returns the raw token once.
 * - REPEAT POST without rotate=1: 409 INVALID_STATE — delivered credentials
 *   are never silently rotated or invalidated.
 * - POST ?rotate=1: explicit operator recovery. Refuses to rotate ACCEPTED /
 *   IN_PROGRESS tasks so an active worker is never stranded mid-engagement.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isInternalRequestAuthorized(request)) {
      return apiError("Unauthorized: valid internal dev secret required", "UNAUTHORIZED", 401);
    }

    const taskId = request.nextUrl.searchParams.get("task_id");
    const workerId = request.nextUrl.searchParams.get("worker_id");
    const rotate = request.nextUrl.searchParams.get("rotate") === "1";
    if (!taskId || !workerId) {
      return apiError(
        "task_id and worker_id query parameters are required",
        "INVALID_INPUT",
        400
      );
    }

    const issued = await db.issueWorkerOfferToken(taskId, workerId, { rotate });
    if (!issued.success || !issued.token) {
      if (issued.code === 409) {
        return apiError(issued.error || "Worker offer token cannot be issued in current state", "INVALID_STATE", 409);
      }
      return apiError(issued.error || "Worker offer not found for this task", "WORKER_NOT_AUTHORIZED", 404);
    }

    const origin = request.nextUrl.origin;
    return NextResponse.json(
      {
        task_id: taskId,
        worker_id: workerId,
        worker_token: issued.token,
        worker_url: `${origin}/tasks/${taskId}?worker_id=${workerId}&token=${issued.token}`,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    return handleServiceError(err);
  }
}