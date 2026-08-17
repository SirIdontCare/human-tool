import { NextRequest, NextResponse } from "next/server";
import { getTaskState } from "@/services/tasks";
import { handleServiceError } from "@/lib/errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;

    const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const customAgentHeader = request.headers.get("x-agent-token");
    const workerHeader = request.headers.get("x-worker-token");
    const queryAgentToken = request.nextUrl.searchParams.get("agent_token");
    const queryWorkerToken = request.nextUrl.searchParams.get("worker_token");
    const queryToken = request.nextUrl.searchParams.get("token");

    const agentToken = authHeader || customAgentHeader || queryAgentToken || queryToken || undefined;
    const workerToken = workerHeader || queryWorkerToken || queryToken || undefined;

    const result = await getTaskState(resolvedParams.id, agentToken, workerToken);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    return handleServiceError(err);
  }
}