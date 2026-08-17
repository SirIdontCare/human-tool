import { NextRequest, NextResponse } from "next/server";
import { createTaskFromQuote } from "@/services/tasks";
import { apiError, ServiceError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const origin = request.headers.get("origin") || request.nextUrl.origin || "";
    const result = await createTaskFromQuote(body, origin);
    const status = result.is_existing ? 200 : 201;
    return NextResponse.json(result, { status });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      return apiError(err.message, err.code, err.status, err.details);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
