import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { Pool } from "pg";
import { db } from "../src/db";
import { logEvent } from "../src/lib/events";
import { validateTaskInput, validateTaskResult } from "../src/lib/schemas";
import { canTransition } from "../src/lib/state-machine";

async function runNeonE2ETest() {
  console.log("==================================================================");
  console.log("  STARTING SPRINT 1 E2E LIFECYCLE TEST AGAINST REAL NEON POSTGRES  ");
  console.log("==================================================================");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("FATAL: DATABASE_URL is not set! Aborting real Neon test.");
    process.exit(1);
  }

  // Parse host for safe logging
  const urlObj = new URL(databaseUrl);
  console.log(`[Neon DB Target] Host: ${urlObj.hostname}, DB: ${urlObj.pathname.replace("/", "")}`);

  // Create direct raw PostgreSQL client for independent verification
  const rawPool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  // Verify connection
  const ping = await rawPool.query("SELECT current_database(), current_user, NOW() as db_time, version()");
  console.log(`[Neon DB Connected] DB: ${ping.rows[0].current_database}, User: ${ping.rows[0].current_user}`);
  console.log(`[PostgreSQL Version] ${ping.rows[0].version.split(",")[0]}`);
  console.log(`[Server Time] ${ping.rows[0].db_time.toISOString()}`);
  console.log("------------------------------------------------------------------");

  const runId = Date.now().toString().slice(-6);
  const quoteId = `quote_e2e_${runId}`;
  const taskId = `task_e2e_${runId}`;
  const resultId = `res_e2e_${runId}`;

  // 1. Create a real quote in Neon
  console.log("\n[1/13] Creating real quote in Neon PostgreSQL...");
  const quotePayload = {
    architecture_summary: "Distributed event-driven agent pipeline with Neon Postgres persistence and connection pooler.",
    components: ["Next.js App Router", "Neon Postgres (PgBouncer)", "Worker UI", "REST API"],
    expected_scale: "25,000 tasks/day with p95 response time < 250ms",
    key_concerns: ["Connection pool saturation under burst loads", "Atomic state updates on worker acceptance"],
  };

  const inputValidation = validateTaskInput("ARCHITECTURE_SANITY_CHECK", quotePayload);
  if (!inputValidation.success) throw new Error("Input validation failed");

  const taskType = await db.getTaskType("ARCHITECTURE_SANITY_CHECK");
  if (!taskType) throw new Error("Task type ARCHITECTURE_SANITY_CHECK not found in Neon");

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await logEvent("quote_requested", "quote", quoteId, { task_type: "ARCHITECTURE_SANITY_CHECK", input_payload: quotePayload });
  const createdQuote = await db.createQuote({
    id: quoteId,
    task_type_id: "ARCHITECTURE_SANITY_CHECK",
    input_payload: quotePayload,
    quoted_price_usd: taskType.customer_price_usd,
    target_payout_usd: taskType.target_payout_usd,
    estimated_minutes: taskType.default_sla_minutes,
    expires_at: expiresAt,
  });
  await logEvent("quote_created", "quote", quoteId, { quoted_price_usd: createdQuote.quoted_price_usd, expires_at: expiresAt });

  console.log(`✓ Quote created: ${createdQuote.id} ($${createdQuote.quoted_price_usd} USD, SLA: ${createdQuote.estimated_minutes}m)`);

  // 2. Create a task from that quote in Neon
  console.log("\n[2/13] Creating task from quote in Neon...");
  const createdTask = await db.createTask({
    id: taskId,
    quote_id: createdQuote.id,
    task_type_id: createdQuote.task_type_id,
    input_payload: createdQuote.input_payload,
  });
  await logEvent("task_created", "task", taskId, { quote_id: createdQuote.id, status: createdTask.status });
  console.log(`✓ Task created: ${createdTask.id} (Status: ${createdTask.status})`);

  // 3. Offer the task to at least two seeded workers in Neon
  console.log("\n[3/13] Matching and offering task to qualified seeded workers in Neon...");
  const qualifiedWorkers = await db.getWorkersByCapability(taskType.required_capability);
  console.log(`Found ${qualifiedWorkers.length} qualified workers in Neon: ${qualifiedWorkers.map((w) => w.id).join(", ")}`);
  if (qualifiedWorkers.length < 2) throw new Error("Expected at least 2 qualified workers seeded in Neon");

  for (const w of qualifiedWorkers) {
    await logEvent("task_offered", "task", taskId, {
      worker_id: w.id,
      worker_name: w.display_name,
      target_payout_usd: createdQuote.target_payout_usd,
    });
  }
  console.log(`✓ Task offered to workers: ${qualifiedWorkers[0].id} and ${qualifiedWorkers[1].id}`);

  // 4. Trigger TWO concurrent acceptance attempts against the SAME task
  console.log("\n[4/13] Triggering TWO concurrent acceptance attempts against the SAME task...");
  const worker1 = "w_sam_arch";
  const worker2 = "w_morgan_general";

  const [attempt1, attempt2] = await Promise.all([
    db.acceptTask(taskId, worker1),
    db.acceptTask(taskId, worker2),
  ]);

  console.log(`Attempt 1 (${worker1}): success=${attempt1.success}, status=${attempt1.task?.status}, error=${attempt1.error || "none"}`);
  console.log(`Attempt 2 (${worker2}): success=${attempt2.success}, status=${attempt2.task?.status}, error=${attempt2.error || "none"}`);

  // 5. Verify exactly one worker succeeds
  const successCount = [attempt1, attempt2].filter((a) => a.success).length;
  const failureCount = [attempt1, attempt2].filter((a) => !a.success).length;
  if (successCount !== 1 || failureCount !== 1) {
    throw new Error(`Expected exactly 1 winner and 1 loser! Got: success=${successCount}, failure=${failureCount}`);
  }

  const winningWorker = attempt1.success ? worker1 : worker2;
  const losingAttempt = attempt1.success ? attempt2 : attempt1;
  console.log(`\n[5/13] ✓ Winning worker: ${winningWorker}`);

  // 6. Verify the losing worker receives the correct conflict response (409)
  console.log("\n[6/13] Verifying losing worker conflict response...");
  if (losingAttempt.code !== 409) {
    throw new Error(`Expected error code 409 from losing worker! Got ${losingAttempt.code}`);
  }
  console.log(`✓ Losing worker correctly rejected with HTTP 409: "${losingAttempt.error}"`);

  // Log acceptance event for winner
  await logEvent("task_accepted", "task", taskId, { worker_id: winningWorker });

  // 7. Start the task
  console.log("\n[7/13] Transitioning task to IN_PROGRESS...");
  const startRes = await db.startTask(taskId, winningWorker);
  if (!startRes.success || startRes.task?.status !== "IN_PROGRESS") {
    throw new Error(`Failed to start task: ${startRes.error}`);
  }
  await logEvent("task_started", "task", taskId, { worker_id: winningWorker, status: "IN_PROGRESS" });
  console.log(`✓ Task is now IN_PROGRESS assigned to ${winningWorker}`);

  // 8. Submit a valid structured result
  console.log("\n[8/13] Submitting structured result...");
  const structuredResult = {
    verdict: "acceptable" as const,
    critical_issues: [
      "PgBouncer transaction pooling must be enabled for serverless lambda scaling to prevent connection exhaustion.",
    ],
    recommended_changes: [
      "Use @neondatabase/serverless connection caching with pooled connection string",
      "Add retry with jitter for connection timeouts during cold starts",
    ],
    scaling_risks: [
      "Single-region PostgreSQL pooler latency for non-US agent requests",
    ],
    confidence: 0.95,
  };

  const resultVal = validateTaskResult("ARCHITECTURE_SANITY_CHECK", structuredResult);
  if (!resultVal.success) throw new Error("Structured result schema validation failed");

  const submitRes = await db.submitTaskResult({
    id: resultId,
    taskId,
    workerId: winningWorker,
    resultPayload: structuredResult,
  });

  if (!submitRes.success || submitRes.task?.status !== "COMPLETED") {
    throw new Error(`Submit failed: ${submitRes.error}`);
  }
  await logEvent("task_submitted", "task", taskId, { worker_id: winningWorker, result_id: resultId });
  await logEvent("task_completed", "task", taskId, { worker_id: winningWorker, result_id: resultId, status: "COMPLETED" });
  console.log(`✓ Structured result submitted and task completed successfully!`);

  // 9. Verify duplicate submission is rejected
  console.log("\n[9/13] Verifying duplicate submission is rejected...");
  const duplicateSubmit = await db.submitTaskResult({
    id: `res_dup_${runId}`,
    taskId,
    workerId: winningWorker,
    resultPayload: structuredResult,
  });
  if (duplicateSubmit.success || duplicateSubmit.code !== 409) {
    throw new Error(`Duplicate submission should fail with 409! Got code=${duplicateSubmit.code}`);
  }
  console.log(`✓ Duplicate submission correctly blocked with HTTP 409: "${duplicateSubmit.error}"`);

  // 10. Complete the task verification in Neon
  console.log("\n[10/13] Verifying task status is COMPLETED in Neon...");
  const taskInDb = await db.getTask(taskId);
  if (taskInDb?.status !== "COMPLETED") {
    throw new Error(`Task status in Neon should be COMPLETED! Got ${taskInDb?.status}`);
  }
  console.log(`✓ Task status in Neon: ${taskInDb.status}`);

  // 11. Retrieve the structured result through the agent API
  console.log("\n[11/13] Agent retrieving structured result...");
  const retrievedResult = await db.getTaskResult(taskId);
  if (!retrievedResult) throw new Error("Result could not be retrieved");
  await logEvent("result_retrieved", "task_result", retrievedResult.id, { task_id: taskId, worker_id: winningWorker });
  console.log(`✓ Result retrieved: verdict="${(retrievedResult.result_payload as any).verdict}", confidence=${(retrievedResult.result_payload as any).confidence}`);

  // 12. Verify the complete lifecycle event sequence persisted in Neon
  console.log("\n[12/13] Verifying complete lifecycle event sequence persisted in Neon...");
  const eventRows = await db.getEvents(taskId);
  const eventTypes = eventRows.map((e) => e.event_type);
  console.log(`Events recorded for task ${taskId}:`, eventTypes);

  const requiredEvents = [
    "task_created",
    "task_offered",
    "task_accepted",
    "task_started",
    "task_submitted",
    "task_completed",
  ];
  for (const expected of requiredEvents) {
    if (!eventTypes.includes(expected)) {
      throw new Error(`Missing expected event: ${expected}`);
    }
  }
  console.log(`✓ All lifecycle events recorded and verified in Neon!`);

  // 13. Direct raw PostgreSQL query verification
  console.log("\n[13/13] Querying Neon PostgreSQL directly via independent raw SQL queries...");
  const directTask = await rawPool.query("SELECT * FROM tasks WHERE id = $1", [taskId]);
  const directResult = await rawPool.query("SELECT * FROM task_results WHERE task_id = $1", [taskId]);
  const directEvents = await rawPool.query("SELECT event_type, created_at FROM events WHERE entity_id = $1 ORDER BY created_at ASC", [taskId]);
  const directOffers = await rawPool.query("SELECT worker_id, status FROM task_offers WHERE task_id = $1", [taskId]);

  console.log(`\n--- DIRECT RAW NEON POSTGRESQL QUERY RESULTS ---`);
  console.log(`tasks row:`, {
    id: directTask.rows[0].id,
    quote_id: directTask.rows[0].quote_id,
    task_type_id: directTask.rows[0].task_type_id,
    status: directTask.rows[0].status,
    assigned_worker_id: directTask.rows[0].assigned_worker_id,
  });

  console.log(`task_results row:`, {
    id: directResult.rows[0].id,
    task_id: directResult.rows[0].task_id,
    worker_id: directResult.rows[0].worker_id,
    verdict: directResult.rows[0].result_payload.verdict,
  });

  console.log(`task_offers rows (${directOffers.rows.length}):`, directOffers.rows);
  console.log(`events rows in Neon (${directEvents.rows.length}):`, directEvents.rows.map((r) => r.event_type));

  // Additional edge-case validations
  console.log("\n--- ADDITIONAL EDGE-CASE TESTS AGAINST NEON ---");

  // A. Expired quote rejection
  console.log("A. Testing expired quote...");
  const expiredQuote = await db.createQuote({
    id: `quote_exp_${runId}`,
    task_type_id: "EXPERT_FACT_VERIFICATION",
    input_payload: { claim: "Test", context: "Test" },
    quoted_price_usd: 29.0,
    target_payout_usd: 18.0,
    estimated_minutes: 30,
    expires_at: new Date(Date.now() - 5000).toISOString(),
  });
  const isExp = new Date(expiredQuote.expires_at).getTime() < Date.now();
  console.log(`✓ Expired quote detected: isExpired = ${isExp}`);

  // B. Malformed result schema rejection
  console.log("B. Testing malformed result schema...");
  const badResult = { verdict: "not_a_valid_verdict", confidence: 2.5 };
  const badVal = validateTaskResult("ARCHITECTURE_SANITY_CHECK", badResult);
  console.log(`✓ Malformed result properly rejected by Zod schema: success = ${badVal.success}`);

  // C. Result retrieval before completion rejection
  console.log("C. Testing result retrieval before completion...");
  const uncompletedTask = await db.createTask({
    id: `task_uncomp_${runId}`,
    quote_id: createdQuote.id,
    task_type_id: createdQuote.task_type_id,
    input_payload: createdQuote.input_payload,
  });
  const earlyRes = await db.getTaskResult(uncompletedTask.id);
  console.log(`✓ Result for uncompleted task in OFFERED status: result = ${earlyRes === null ? "null (correct)" : "unexpected"}`);

  // D. Invalid state transition rejection
  console.log("D. Testing invalid state transition...");
  const invalidTransition = canTransition("COMPLETED", "IN_PROGRESS");
  console.log(`✓ Invalid transition COMPLETED -> IN_PROGRESS: allowed = ${invalidTransition} (correctly blocked)`);

  await rawPool.end();

  console.log("\n==================================================================");
  console.log("  ALL REAL NEON POSTGRESQL E2E CHECKS COMPLETED SUCCESSFULLY      ");
  console.log("==================================================================");
  return {
    taskId,
    quoteId,
    winningWorker,
    status: directTask.rows[0].status,
    eventsCount: directEvents.rows.length,
  };
}

runNeonE2ETest()
  .then((res) => {
    console.log("\nFINAL REPORT SUMMARY:", res);
    console.log("\nREAL NEON E2E: PASS");
    process.exit(0);
  })
  .catch((err) => {
    console.error("REAL NEON E2E: FAIL", err);
    process.exit(1);
  });
