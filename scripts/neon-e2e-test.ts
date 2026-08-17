import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { Pool } from "pg";
import { requestQuote } from "../src/services/quotes";
import { createTaskFromQuote, acceptTask, startTask, submitTaskResult, getTaskResult } from "../src/services/tasks";
import { ServiceError } from "../src/lib/errors";

async function runHardenedNeonE2ETest() {
  console.log("==================================================================");
  console.log("  STARTING SPRINT 1.1 FINAL HARDENING E2E (REAL NEON POSTGRES)    ");
  console.log("==================================================================");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("FATAL: DATABASE_URL is not set! Aborting test.");
    process.exit(1);
  }

  const rawPool = new Pool({
    connectionString: databaseUrl,
    ssl: true,
  });

  const ping = await rawPool.query("SELECT current_database(), current_user, NOW() as db_time, version()");
  console.log(`[Neon DB Connected] DB: ${ping.rows[0].current_database}, User: ${ping.rows[0].current_user}`);
  console.log("------------------------------------------------------------------");

  // 1. Verify schema_migrations table
  console.log("\n[1/10] Verifying schema_migrations tracking in Neon...");
  const migRes = await rawPool.query("SELECT version, applied_at FROM schema_migrations ORDER BY version ASC");
  console.log("Applied migrations in Neon:", migRes.rows.map((r) => r.version));
  if (migRes.rows.length < 3) {
    throw new Error(`Expected at least 3 migrations in schema_migrations! Found: ${migRes.rows.length}`);
  }
  console.log("✓ Numbered migrations verified in schema_migrations table");

  // 2. Request Quote through Service Layer
  console.log("\n[2/10] Requesting quote via service layer (sanitized agent output)...");
  const quoteRes = await requestQuote({
    task_type: "ARCHITECTURE_SANITY_CHECK",
    input_payload: {
      architecture_summary: "High-scale serverless agent runner connected to Neon Postgres with transactional pooling.",
      components: ["Next.js App Router", "Neon Postgres Serverless", "REST API", "Service Layer"],
      expected_scale: "50,000 tasks/day",
      key_concerns: ["Connection pool exhaustion", "Duplicate submission race conditions"],
    },
  });

  if ((quoteRes as any).target_payout_usd !== undefined) {
    throw new Error("Agent-facing quote response leaked target_payout_usd!");
  }
  console.log(`✓ Quote created: ${quoteRes.quote_id} ($${quoteRes.customer_price_usd} USD, SLA: ${quoteRes.estimated_minutes}m)`);
  console.log(`✓ Verified target_payout_usd is NOT exposed to agents`);

  // 3. Create Task & Verify Idempotency in Neon
  console.log("\n[3/10] Creating task and testing idempotent creation in Neon...");
  const taskRes1 = await createTaskFromQuote({ quote_id: quoteRes.quote_id });
  if (taskRes1.is_existing) throw new Error("First task creation must be new");

  const taskRes2 = await createTaskFromQuote({ quote_id: quoteRes.quote_id });
  if (!taskRes2.is_existing || taskRes2.task_id !== taskRes1.task_id) {
    throw new Error("Repeated task creation from same quote failed idempotency!");
  }
  console.log(`✓ Task created: ${taskRes1.task_id} (Status: ${taskRes1.status})`);
  console.log(`✓ Idempotent return verified for repeated creation`);

  // 4. Test Incapable Worker Acceptance (403 + WORKER_CAPABILITY_REQUIRED)
  console.log("\n[4/10] Testing incapable worker acceptance enforcement in Neon...");
  try {
    await acceptTask(taskRes1.task_id, { worker_id: "w_alex_ux" });
    throw new Error("Should have thrown WORKER_CAPABILITY_REQUIRED error");
  } catch (err: any) {
    if (!(err instanceof ServiceError) || err.code !== "WORKER_CAPABILITY_REQUIRED" || err.status !== 403) {
      throw new Error(`Expected WORKER_CAPABILITY_REQUIRED (403), got: ${err.code} (${err.status})`);
    }
    console.log(`✓ Incapable worker correctly rejected with: ${err.code} (${err.status})`);
  }

  // 5. Test Worker Offer Token Authorization Boundary
  console.log("\n[5/10] Testing worker offer token authorization boundary...");
  try {
    await acceptTask(taskRes1.task_id, { worker_id: "w_sam_arch" }, "invalid_worker_token");
    throw new Error("Should have thrown WORKER_NOT_AUTHORIZED error");
  } catch (err: any) {
    if (!(err instanceof ServiceError) || err.code !== "WORKER_NOT_AUTHORIZED" || err.status !== 401) {
      throw new Error(`Expected WORKER_NOT_AUTHORIZED (401), got: ${err.code} (${err.status})`);
    }
    console.log(`✓ Invalid worker token rejected with: ${err.code} (${err.status})`);
  }

  // 6. Test Concurrent Worker Acceptance in Neon (Exactly One 200, One 409 TASK_ALREADY_ACCEPTED)
  console.log("\n[6/10] Testing concurrent worker acceptance in Neon...");
  const offerSam = taskRes1.offers?.find((o) => o.worker_id === "w_sam_arch");
  const offerMorgan = taskRes1.offers?.find((o) => o.worker_id === "w_morgan_general");

  const [acc1, acc2] = await Promise.allSettled([
    acceptTask(taskRes1.task_id, { worker_id: "w_sam_arch" }, offerSam?.worker_token),
    acceptTask(taskRes1.task_id, { worker_id: "w_morgan_general" }, offerMorgan?.worker_token),
  ]);

  const accSuccess = [acc1, acc2].filter((r) => r.status === "fulfilled");
  const accConflict = [acc1, acc2].filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  if (accSuccess.length !== 1 || accConflict.length !== 1) {
    throw new Error(`Expected 1 success and 1 conflict! Got: success=${accSuccess.length}, conflict=${accConflict.length}`);
  }
  if (accConflict[0].reason.code !== "TASK_ALREADY_ACCEPTED") {
    throw new Error(`Expected TASK_ALREADY_ACCEPTED code, got ${accConflict[0].reason.code}`);
  }

  const winningWorker = acc1.status === "fulfilled" ? "w_sam_arch" : "w_morgan_general";
  const winningToken = acc1.status === "fulfilled" ? offerSam?.worker_token : offerMorgan?.worker_token;
  console.log(`✓ Exactly one worker succeeded: ${winningWorker}`);
  console.log(`✓ Losing worker received HTTP 409 with stable code: TASK_ALREADY_ACCEPTED`);

  // 7. Start the Task
  console.log("\n[7/10] Starting task via service layer...");
  const startRes = await startTask(taskRes1.task_id, { worker_id: winningWorker }, winningToken);
  console.log(`✓ Task is now IN_PROGRESS assigned to ${startRes.assigned_worker_id}`);

  // 8. Atomic Transactional Result Submission
  console.log("\n[8/10] Testing atomic single-transaction result submission in Neon...");
  const structuredResult = {
    verdict: "acceptable" as const,
    critical_issues: ["Enable transaction pooler to prevent idle socket leaks on serverless restarts"],
    recommended_changes: ["Configure connection timeout to 10s with max 20 client limit"],
    scaling_risks: ["Multi-region query round-trips"],
    confidence: 0.96,
  };

  const [sub1, sub2] = await Promise.allSettled([
    submitTaskResult(taskRes1.task_id, { worker_id: winningWorker, result_payload: structuredResult }, winningToken),
    submitTaskResult(taskRes1.task_id, { worker_id: winningWorker, result_payload: structuredResult }, winningToken),
  ]);

  const subSuccess = [sub1, sub2].filter((r) => r.status === "fulfilled");
  const subConflict = [sub1, sub2].filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  if (subSuccess.length !== 1 || subConflict.length !== 1) {
    throw new Error(`Expected 1 submission success and 1 conflict! Got: success=${subSuccess.length}, conflict=${subConflict.length}`);
  }
  if (subConflict[0].reason.code !== "RESULT_ALREADY_SUBMITTED") {
    throw new Error(`Expected RESULT_ALREADY_SUBMITTED code, got ${subConflict[0].reason.code}`);
  }
  console.log(`✓ Atomic single transaction: exactly 1 succeeded, concurrent duplicate rejected with RESULT_ALREADY_SUBMITTED (409)`);

  // 9. Agent Token Authorization Boundary on Result Access
  console.log("\n[9/10] Testing agent token authorization boundary on result retrieval...");
  try {
    await getTaskResult(taskRes1.task_id, "atk_bad_token_123");
    throw new Error("Should have thrown UNAUTHORIZED");
  } catch (err: any) {
    if (!(err instanceof ServiceError) || err.code !== "UNAUTHORIZED" || err.status !== 401) {
      throw new Error(`Expected UNAUTHORIZED (401), got: ${err.code} (${err.status})`);
    }
    console.log(`✓ Unauthorized agent token correctly rejected with: ${err.code} (401)`);
  }

  const validResult = await getTaskResult(taskRes1.task_id, taskRes1.agent_token);
  console.log(`✓ Authorized result retrieved: status=${validResult.status}, verdict="${(validResult.result as any).verdict}"`);

  // 10. Direct Database State Invariant Assertions
  console.log("\n[10/10] Direct SQL Invariant Verification in Neon PostgreSQL...");
  const dbTask = await rawPool.query("SELECT * FROM tasks WHERE id = $1", [taskRes1.task_id]);
  const dbResult = await rawPool.query("SELECT * FROM task_results WHERE task_id = $1", [taskRes1.task_id]);
  const dbEvents = await rawPool.query("SELECT event_type FROM events WHERE entity_id = $1 ORDER BY created_at ASC", [taskRes1.task_id]);

  if (dbTask.rows[0].status !== "COMPLETED") throw new Error("Task status is not COMPLETED in Neon");
  if (dbResult.rows.length !== 1) throw new Error("Task results row missing in Neon");
  if (dbEvents.rows.length < 5) throw new Error("Missing lifecycle events in Neon");

  console.log("--- DIRECT NEON RAW STATE ---");
  console.log(`Task: ${dbTask.rows[0].id} (Status: ${dbTask.rows[0].status}, Worker: ${dbTask.rows[0].assigned_worker_id})`);
  console.log(`Result: ${dbResult.rows[0].id} (Verdict: ${dbResult.rows[0].result_payload.verdict})`);
  console.log(`Events recorded in Neon:`, dbEvents.rows.map((r) => r.event_type));

  await rawPool.end();

  console.log("\n==================================================================");
  console.log("  ALL HARDENED SPRINT 1.1 VERIFICATIONS PASSED IN NEON POSTGRES  ");
  console.log("==================================================================");

  return {
    taskId: taskRes1.task_id,
    quoteId: quoteRes.quote_id,
    winningWorker,
    status: dbTask.rows[0].status,
    eventsCount: dbEvents.rows.length,
  };
}

runHardenedNeonE2ETest()
  .then((res) => {
    console.log("\nFINAL HARDENING REPORT:", res);
    console.log("\nHARDENED REAL NEON SUITE: PASS");
    process.exit(0);
  })
  .catch((err) => {
    console.error("HARDENED REAL NEON SUITE: FAIL", err);
    process.exit(1);
  });
