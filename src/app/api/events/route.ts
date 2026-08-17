import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entity_id") || undefined;
    const isInternal = request.headers.get("x-internal-key") === (process.env.INTERNAL_DEV_SECRET || "dev-internal-key");

    const events = await db.getEvents(entityId);

    // Sanitize events if public request to avoid exposing customer input_payload and private data
    const sanitizedEvents = events.map((evt) => {
      if (isInternal) return evt;

      const sanitizedPayload = { ...evt.payload };
      if (sanitizedPayload.input_payload) {
        sanitizedPayload.input_payload = "[REDACTED: SENSITIVE CUSTOMER PAYLOAD]";
      }
      return {
        id: evt.id,
        event_type: evt.event_type,
        entity_type: evt.entity_type,
        entity_id: evt.entity_id,
        payload: sanitizedPayload,
        created_at: evt.created_at,
      };
    });

    return NextResponse.json({ events: sanitizedEvents });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to fetch events", details: err.message }, { status: 500 });
  }
}
