import { NextRequest, NextResponse } from "next/server";
import { acceptTask } from "@/services/tasks";
import { handleServiceError } from "@/lib/errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const body = await request.json().catch(() => ({}));

    const headerToken = request.headers.get("x-worker-token") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const workerToken = (body as any).token || (body as any).worker_token || headerToken || undefined;

    const result = await acceptTask(resolvedParams.id, body, workerToken);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    return handleServiceError(err);
  }
}
