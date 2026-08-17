import { NextResponse } from "next/server";
import { db } from "@/db";
import { TASK_CATALOGUE } from "@/lib/catalogue";

export async function GET() {
  try {
    const taskTypes = await db.getAllTaskTypes();
    return NextResponse.json({
      task_types: taskTypes.map((t) => ({
        code: t.code,
        title: t.title,
        description: t.description,
        customer_price_usd: t.customer_price_usd,
        target_payout_usd: t.target_payout_usd,
        default_sla_minutes: t.default_sla_minutes,
        required_capability: t.required_capability,
        risk_level: t.risk_level,
        result_schema: t.result_schema,
        example_input: TASK_CATALOGUE[t.code]?.example_input || {},
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to fetch task catalogue", details: err.message }, { status: 500 });
  }
}
