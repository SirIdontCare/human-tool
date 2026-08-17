import { db } from "../db";

export type EventType =
  | "quote_requested"
  | "quote_created"
  | "task_created"
  | "task_offered"
  | "task_accepted"
  | "task_started"
  | "task_submitted"
  | "task_completed"
  | "task_failed"
  | "result_retrieved"
  | "demand_matched"
  | "demand_unmatched";

export async function logEvent(
  eventType: EventType,
  entityType: "quote" | "task" | "task_result" | "worker" | "demand",
  entityId: string,
  payload: Record<string, unknown> = {}
) {
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  try {
    return await db.logEvent({
      id: eventId,
      eventType,
      entityType,
      entityId,
      payload: {
        ...payload,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(`[EventLogger] Failed to log event ${eventType} for ${entityType}:${entityId}`, err);
    return null;
  }
}
