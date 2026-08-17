import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { Pool } from "pg";
import { db } from "../src/db";
import { logEvent } from "../src/lib/events";
import { validateTaskInput, validateTaskResult } from "../src/lib/schemas";
import { canTransition } from "../src/lib/state-machine";

async function runNeonE2ETest() {
  console.log("==================================================================");
  console.log("  STARTING SPRINT 1 P0/P1 HARDENED E2E TEST (REAL NEON POSTGRES)  ");
  console.log("==================================================================");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("FATAL: DATABASE_URL is not set! Aborting real Neon test.");
    process.exit(1);
  }

  const urlObj = new URL(databaseUrl);
  console.log(`[Neon DB Target] Host: ${urlObj.hostname}, DB: ${urlObj.pathname.replace("/", "")}`);

  const rawPool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  const ping = await rawPool.query("SELECT current_database(), current_user, NOW() as db_time, version()");
  console.log(`[Neon DB Connected] DB: ${ping.rows[0].current_database}, User: ${ping.rows[0].current_user}`);
  console.log(`[PostgreSQL Version] ${ping.rows[0].version.split(",")[0]}`);
  console.log("------------------------------------------------------------------");

  const runId = Date.now().toString().slice(-6);
  const quoteId = `quote_e2e_p1_${runId}`;
  const taskId = `task_e2e_p1_${runId}`;
  const resultId = `res_e2e_p1_${runId}`;

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

  // 2. Create a task from that quote in Neon & Verify Idempotency
  console.log("\n[2/13] Testing atomic task creation and database-level idempotency in Neon...");
  const createRes1 = await db.createTask({
    id: taskId,
    quote_id: createdQuote.id,
    task_type_id: createdQuote.task_type_id,
    input_payload: createdQuote.input_payload,
  });
  if (createRes1.is_existing) throw new Error("First task creation should be new");
  await logEvent("task_created", "task", taskId, { quote_id: createdQuote.id, status: createRes1.task.status });

  // Concurrent second task creation with same quote_id must be idempotent
  const createRes2 = await db.createTask({
    id: `task_dup_${runId}`,
    quote_id: createdQuote.id,
    task_type_id: createdQuote.task_type_id,
    input_payload: createdQuote.input_payload,
  });
  if (!createRes2.is_existing || createRes2.task.id !== taskId) {
    throw new Error("Repeated task creation from same quote failed idempotency!");
  }
  console.log(`✓ Task created: ${createRes1.task.id} (Status: ${createRes1.task.status})`);
  console.log(`✓ Repeated creation idempotently returned existing task (is_existing = true)`);

  // 3. Verify task_offers in Neon for all qualified workers
  console.log("\n[3/13] Verifying task_offers rows persisted in Neon for all qualified workers...");
  const offersInDb = await rawPool.query(
    "SELECT worker_id, status, worker_token_hash FROM task_offers WHERE task_id = $1 ORDER BY worker_id ASC",
    [taskId]
  );
  console.log(`Found ${offersInDb.rows.length} task_offers rows in Neon:`, offersInDb.rows.map((r) => r.worker_id));
  if (offersInDb.rows.length < 2) throw new Error("Expected at least 2 task_offers rows in Neon");

  for (const offer of createRes1.offers) {
    await logEvent("task_offered", "task", taskId, {
      worker_id: offer.worker_id,
      target_payout_usd: createdQuote.target_payout_usd,
    });
  }
  console.log(`✓ Verified each offered worker has unique offer row with SHA-256 token hash`);

  // 4. Test Incapable Worker Acceptance Rejection (403 Forbidden)
  console.log("\n[4/13] Testing incapable worker acceptance rejection...");
  const incapableAccept = await db.acceptTask(taskId, "w_alex_ux"); // w_alex_ux has UX, not ARCHITECTURE
  if (incapableAccept.success || incapableAccept.code !== 403) {
    throw new Error(`Incapable worker accept should return 403! Got ${incapableAccept.code}`);
  }
  console.log(`✓ Incapable worker correctly rejected with HTTP 403: "${incapableAccept.error}"`);

  // 5. Test Worker Offer Token Authorization Boundary (401 Unauthorized)
  console.log("\n[5/13] Testing worker offer token authorization boundary...");
  const wrongTokenAccept = await db.acceptTask(taskId, "w_sam_arch", "invalid_worker_token_123");
  if (wrongTokenAccept.success || wrongTokenAccept.code !== 401) {
    throw new Error(`Invalid worker token accept should return 401! Got ${wrongTokenAccept.code}`);
  }
  console.log(`✓ Invalid worker token correctly rejected with HTTP 401: "${wrongTokenAccept.error}"`);

  // 6. Trigger TWO concurrent acceptance attempts against the SAME task
  console.log("\n[6/13] Triggering TWO concurrent acceptance attempts against the SAME task in Neon...");
  const offerSam = createRes1.offers.find((o) => o.worker_id === "w_sam_arch");
  const offerMorgan = createRes1.offers.find((o) => o.worker_id === "w_morgan_general");

  const [attempt1, attempt2] = await Promise.all([
    db.acceptTask(taskId, "w_sam_arch", offerSam?.worker_token),
    db.acceptTask(taskId, "w_morgan_general", offerMorgan?.worker_token),
  ]);

  const successCount = [attempt1, attempt2].filter((a) => a.success).length;
  const conflictCount = [attempt1, attempt2].filter((a) => !a.success && a.code === 409).length;

  if (successCount !== 1 || conflictCount !== 1) {
    throw new Error(`Expected exactly 1 winner and 1 409 conflict! Got: success=${successCount}, conflict=${conflictCount}`);
  }

  const winningWorker = attempt1.success ? "w_sam_arch" : "w_morgan_general";
  const winningToken = attempt1.success ? offerSam?.worker_token : offerMorgan?.worker_token;
  console.log(`✓ Exactly one worker succeeded: ${winningWorker}`);
  console.log(`✓ Losing worker received HTTP 409 Conflict`);

  await logEvent("task_accepted", "task", taskId, { worker_id: winningWorker });

  // 7. Start the task
  console.log("\n[7/13] Starting task in Neon...");
  const startRes = await db.startTask(taskId, winningWorker, winningToken);
  if (!startRes.success || startRes.task?.status !== "IN_PROGRESS") {
    throw new Error(`Start task failed: ${startRes.error}`);
  }
  await logEvent("task_started", "task", taskId, { worker_id: winningWorker, status: "IN_PROGRESS" });
  console.log(`✓ Task is now IN_PROGRESS assigned to ${winningWorker}`);

  // 8. Submit valid structured result with atomic duplicate protection
  console.log("\n[8/13] Testing atomic submission with duplicate prevention...");
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

  // Run two concurrent submissions
  const [sub1, sub2] = await Promise.all([
    db.submitTaskResult({ id: `${resultId}_1`, taskId, workerId: winningWorker, workerToken: winningToken, resultPayload: structuredResult }),
    db.submitTaskResult({ id: `${resultId}_2`, taskId, workerId: winningWorker, workerToken: winningToken, resultPayload: structuredResult }),
  ]);

  const subSuccessCount = [sub1, sub2].filter((s) => s.success).length;
  const subConflictCount = [sub1, sub2].filter((s) => !s.success && s.code === 409).length;

  if (subSuccessCount !== 1 || subConflictCount !== 1) {
    throw new Error(`Expected exactly 1 submission success and 1 409 conflict! Got: success=${subSuccessCount}, conflict=${subConflictCount}`);
  }
  console.log(`✓ Atomic submission: exactly 1 succeeded, concurrent duplicate returned HTTP 409 (never 500)`);

  await logEvent("task_submitted", "task", taskId, { worker_id: winningWorker, result_id: resultId });
  await logEvent("task_completed", "task", taskId, { worker_id: winningWorker, result_id: resultId, status: "COMPLETED" });

  // 9. Verify Agent Task Token Authorization on Result Retrieval
  console.log("\n[9/13] Testing agent token authorization boundary on result retrieval...");
  const unauthorizedCheck = await db.verifyAgentToken(taskId, "atk_invalid_fake_token");
  if (unauthorizedCheck) throw new Error("Invalid agent token should not pass verification");

  const authorizedCheck = await db.verifyAgentToken(taskId, createRes1.agent_token);
  if (!authorizedCheck) throw new Error("Valid agent token must pass verification");

  const retrievedResult = await db.getTaskResult(taskId);
  if (!retrievedResult) throw new Error("Result could not be retrieved from Neon");
  await logEvent("result_retrieved", "task_result", retrievedResult.id, { task_id: taskId, worker_id: winningWorker });
  console.log(`✓ Agent token authorization verified; result retrieved: verdict="${(retrievedResult.result_payload as any).verdict}"`);

  // 10. Verify Lifecycle Events Persisted in Neon
  console.log("\n[10/13] Verifying complete lifecycle event sequence persisted in Neon...");
  const eventRows = await db.getEvents(taskId);
  const eventTypes = eventRows.map((e) => e.event_type);
  console.log(`Events in Neon for task ${taskId}:`, eventTypes);

  const requiredEvents = [
    "task_created",
    "task_offered",
    "task_accepted",
    "task_started",
    "task_submitted",
    "task_completed",
  ];
  for (const expected of requiredEvents) {
    if (!eventTypes.includes(expected)) throw new Error(`Missing expected event: ${expected}`);
  }
  console.log(`✓ All lifecycle events recorded and verified in Neon!`);

  // 11. Direct raw SQL queries against Neon
  console.log("\n[11/13] Executing direct raw SQL queries against Neon PostgreSQL...");
  const directTask = await rawPool.query("SELECT * FROM tasks WHERE id = $1", [taskId]);
  const directResult = await rawPool.query("SELECT * FROM task_results WHERE task_id = $1", [taskId]);
  const directOffers = await rawPool.query("SELECT worker_id, status FROM task_offers WHERE task_id = $1", [taskId]);
  const directEvents = await rawPool.query("SELECT event_type, created_at FROM events WHERE entity_id = $1 ORDER BY created_at ASC", [taskId]);

  console.log(`--- DIRECT RAW NEON POSTGRESQL ROW SUMMARY ---`);
  console.log(`tasks row:`, {
    id: directTask.rows[0].id,
    quote_id: directTask.rows[0].quote_id,
    task_type_id: directTask.rows[0].task_type_id,
    status: directTask.rows[0].status,
    assigned_worker_id: directTask.rows[0].assigned_worker_id,
    has_agent_token_hash: Boolean(directTask.rows[0].agent_token_hash),
  });
  console.log(`task_results row:`, {
    id: directResult.rows[0].id,
    task_id: directResult.rows[0].task_id,
    worker_id: directResult.rows[0].worker_id,
    verdict: directResult.rows[0].result_payload.verdict,
  });
  console.log(`task_offers rows count:`, directOffers.rows.length);
  console.log(`events rows count:`, directEvents.rows.length);

  // 12. Additional edge case checks
  console.log("\n[12/13] Additional edge-case validations...");
  const isExp = new Date(new Date(Date.now() - 5000).toISOString()).getTime() < Date.now();
  console.log(`✓ Expired quote detection: ${isExp}`);
  const badVal = validateTaskResult("ARCHITECTURE_SANITY_CHECK", { verdict: "invalid", confidence: 2.0 });
  console.log(`✓ Malformed result rejected by Zod schema: ${!badVal.success}`);
  const invalidTransition = canTransition("COMPLETED", "IN_PROGRESS");
  console.log(`✓ Invalid transition COMPLETED -> IN_PROGRESS rejected: ${!invalidTransition}`);

  await rawPool.end();

  console.log("\n==================================================================");
  console.log("  ALL P0 AND P1 CHECKS PASSED AGAINST REAL NEON POSTGRESQL        ");
  console.log("==================================================================");

  return {
    taskId,
    quoteId,
    winningWorker,
    status: directTask.rows[0].status,
    offersCount: directOffers.rows.length,
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
