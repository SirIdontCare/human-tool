import { NextRequest, NextResponse } from "next/server";
import { getTaskResult } from "@/services/tasks";
import { apiError, ServiceError } from "@/lib/errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const customHeader = request.headers.get("x-agent-token");
    const queryToken = request.nextUrl.searchParams.get("agent_token") || request.nextUrl.searchParams.get("token");
    const agentToken = authHeader || customHeader || queryToken || undefined;

    const result = await getTaskResult(resolvedParams.id, agentToken);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      return apiError(err.message, err.code, err.status, err.details);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
