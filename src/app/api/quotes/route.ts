import { NextRequest, NextResponse } from "next/server";
import { requestQuote } from "@/services/quotes";
import { handleServiceError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await requestQuote(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    return handleServiceError(err);
  }
}
