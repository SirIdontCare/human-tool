import { NextRequest, NextResponse } from "next/server";
import { getEventsList } from "@/services/events";
import { apiError, handleServiceError } from "@/lib/errors";
import { isInternalRequestAuthorized } from "@/lib/internal-auth";

export async function GET(request: NextRequest) {
  try {
    if (!isInternalRequestAuthorized(request)) {
      return apiError("Unauthorized: valid internal dev secret required", "UNAUTHORIZED", 401);
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entity_id") || undefined;

    const events = await getEventsList(entityId, true);
    return NextResponse.json({ events }, { status: 200 });
  } catch (err: unknown) {
    return handleServiceError(err);
  }
}