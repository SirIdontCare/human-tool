import { NextRequest, NextResponse } from "next/server";
import { getTaskState } from "@/services/tasks";
import { apiError, ServiceError } from "@/lib/errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const result = await getTaskState(resolvedParams.id);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      return apiError(err.message, err.code, err.status, err.details);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
