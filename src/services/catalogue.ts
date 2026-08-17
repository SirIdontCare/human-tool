import { db } from "@/db";

export async function getCatalogueList() {
  const taskTypes = await db.getAllTaskTypes();
  return {
    version: "1.0.0",
    task_types: taskTypes.map((t) => ({
      code: t.code,
      title: t.title,
      description: t.description,
      customer_price_usd: t.customer_price_usd,
      default_sla_minutes: t.default_sla_minutes,
      required_capability: t.required_capability,
      risk_level: t.risk_level,
      result_schema: t.result_schema,
    })),
  };
}
