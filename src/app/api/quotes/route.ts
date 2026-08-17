import { NextRequest, NextResponse } from "next/server";
import { requestQuote } from "@/services/quotes";
import { apiError, ServiceError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await requestQuote(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      return apiError(err.message, err.code, err.status, err.details);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
