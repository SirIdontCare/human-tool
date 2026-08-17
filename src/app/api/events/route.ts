import { NextRequest, NextResponse } from "next/server";
import { getEventsList } from "@/services/events";
import { apiError, ServiceError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entity_id") || undefined;
    const isInternal = request.headers.get("x-internal-key") === (process.env.INTERNAL_DEV_SECRET || "dev-internal-key");

    const events = await getEventsList(entityId, isInternal);
    return NextResponse.json({ events }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      return apiError(err.message, err.code, err.status, err.details);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
