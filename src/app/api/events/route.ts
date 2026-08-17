import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entity_id") || undefined;
    const events = await db.getEvents(entityId);
    return NextResponse.json({ events });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to fetch events", details: err.message }, { status: 500 });
  }
}
