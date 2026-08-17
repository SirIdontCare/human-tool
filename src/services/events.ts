import { db } from "@/db";

export async function getEventsList(entityId?: string, isInternal: boolean = false) {
  const events = await db.getEvents(entityId);

  return events.map((evt) => {
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
}
