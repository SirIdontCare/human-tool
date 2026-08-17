import { NextRequest, NextResponse } from "next/server";
import { createTaskFromQuote } from "@/services/tasks";
import { handleServiceError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const origin = request.headers.get("origin") || request.nextUrl.origin || "";

    // Agent capability token is accepted ONLY via headers — never through URL
    // query parameters or the request body.
    const agentToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      request.headers.get("x-agent-token") || undefined;

    const result = await createTaskFromQuote(body, origin, agentToken);
    const status = result.is_existing ? 200 : 201;
    return NextResponse.json(result, { status });
  } catch (err: unknown) {
    return handleServiceError(err);
  }
}
