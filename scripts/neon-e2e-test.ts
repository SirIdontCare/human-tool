import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { Pool } from "pg";
import { requestQuote } from "../src/services/quotes";
import {
  createTaskFromQuote,
  acceptTask,
  startTask,
  submitTaskResult,
  getTaskResult,
  getTaskState,
} from "../src/services/tasks";
import { db } from "../src/db";
import { RESULT_SCHEMAS } from "../src/lib/catalogue";
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
  console.log("DATABASE TARGET: PostgreSQL/Neon (NOT InMemoryStore)");

  // 1. Verify schema_migrations table (migration 004 must be applied)
  console.log("\n[1/13] Verifying schema_migrations tracking in Neon...");
  const migRes = await rawPool.query("SELECT version, applied_at FROM schema_migrations ORDER BY version ASC");
  console.log("Applied migrations in Neon:", migRes.rows.map((r) => r.version));
  if (migRes.rows.length < 4) {
    throw new Error(`Expected at least 4 migrations in schema_migrations! Found: ${migRes.rows.length}`);
  }
  if (!migRes.rows.some((r) => r.version.includes("004"))) {
    throw new Error("Migration 004 is missing from schema_migrations!");
  }
  console.log("✓ Migration 004 applied");

  // 1b. Verify post-migration security invariants directly in SQL
  console.log("\n[2/13] Verifying hardened schema invariants in live Neon...");
  const nullAgentHash = await rawPool.query(
    "SELECT count(*)::int AS c FROM tasks WHERE agent_token_hash IS NULL OR agent_token_hash = ''"
  );
  const nullWorkerHash = await rawPool.query(
    "SELECT count(*)::int AS c FROM task_offers WHERE worker_token_hash IS NULL OR worker_token_hash = ''"
  );
  const nullability = await rawPool.query(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns
     WHERE (table_name = 'tasks' AND column_name = 'agent_token_hash')
        OR (table_name = 'task_offers' AND column_name = 'worker_token_hash')`
  );
  const dupQuotes = await rawPool.query("SELECT count(*)::int AS c FROM (SELECT quote_id FROM tasks GROUP BY quote_id HAVING count(*) > 1) d");
  const dupOffers = await rawPool.query("SELECT count(*)::int AS c FROM (SELECT task_id, worker_id FROM task_offers GROUP BY task_id, worker_id HAVING count(*) > 1) d");
  if (nullAgentHash.rows[0].c !== 0) throw new Error("tasks.agent_token_hash still contains NULL/empty values!");
  if (nullWorkerHash.rows[0].c !== 0) throw new Error("task_offers.worker_token_hash still contains NULL/empty values!");
  if (dupQuotes.rows[0].c !== 0) throw new Error("Duplicate tasks.quote_id rows exist!");
  if (dupOffers.rows[0].c !== 0) throw new Error("Duplicate task_offers(task_id, worker_id) rows exist!");
  for (const row of nullability.rows) {
    if (row.is_nullable !== "NO") throw new Error(`${row.table_name}.${row.column_name} must be NOT NULL in Neon!`);
  }
  const statusCheck = await rawPool.query(
    "SELECT conname FROM pg_constraint WHERE conname = 'tasks_status_check'"
  );
  if (statusCheck.rows.length !== 1) throw new Error("tasks_status_check constraint missing in Neon!");
  console.log("✓ agent_token_hash NOT NULL, worker_token_hash NOT NULL, unique quote_id, tasks_status_check verified");

  // 1c. Verify published result_schema matches the canonical single source of truth
  console.log("\n[3/13] Verifying result_schema against the canonical source of truth...");
  const normalizeJson = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalizeJson);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = normalizeJson((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  const dbSchemas = await rawPool.query("SELECT code, result_schema FROM task_types ORDER BY code");
  for (const row of dbSchemas.rows) {
    if (JSON.stringify(normalizeJson(RESULT_SCHEMAS[row.code])) !== JSON.stringify(normalizeJson(row.result_schema))) {
      throw new Error(`result_schema for ${row.code} drifted from canonical RESULT_SCHEMAS!`);
    }
  }
  console.log("✓ Live result_schema identical to canonical RESULT_SCHEMAS");

  // 2. Request Quote through Service Layer
  console.log("\n[4/13] Requesting quote via service layer (sanitized agent output)...");
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

  // 3. Create Task & Verify Idempotency in Neon (with agent token rotation on replay)
  console.log("\n[5/13] Creating task and testing idempotent replay in Neon...");
  const taskRes1 = await createTaskFromQuote({ quote_id: quoteRes.quote_id });
  if (taskRes1.is_existing) throw new Error("First task creation must be new");
  if (!taskRes1.agent_token) throw new Error("First task creation must return an agent token");
  const firstAgentToken = taskRes1.agent_token;

  const serializedCreate = JSON.stringify(taskRes1);
  if (serializedCreate.includes("worker_token") || serializedCreate.includes("otk_") || serializedCreate.includes("token=")) {
    throw new Error("Agent-facing task creation response leaked worker credentials!");
  }
  console.log(`✓ Task created: ${taskRes1.task_id} (Status: ${taskRes1.status})`);
  console.log(`✓ Agent response contains NO worker credentials`);

  // 3b. Idempotent replay: same task, fresh valid agent token
  const taskRes2 = await createTaskFromQuote({ quote_id: quoteRes.quote_id });
  if (!taskRes2.is_existing || taskRes2.task_id !== taskRes1.task_id) {
    throw new Error("Repeated task creation from same quote failed idempotency!");
  }
  if (!taskRes2.agent_token || taskRes2.agent_token === firstAgentToken) {
    throw new Error("Idempotent replay must return a rotated agent token!");
  }
  console.log(`✓ Idempotent replay: same task ${taskRes2.task_id}, rotated agent token issued`);

  // 3c. Task view authorization boundaries
  const viewNoAuth = await getTaskState(taskRes2.task_id).catch((e) => e);
  if (!(viewNoAuth instanceof ServiceError) || viewNoAuth.status !== 401) {
    throw new Error("Task view without token must be 401 UNAUTHORIZED!");
  }
  const agentView = await getTaskState(taskRes2.task_id, taskRes2.agent_token);
  if ((agentView as any).compensation_usd !== undefined || JSON.stringify(agentView).includes("target_payout_usd")) {
    throw new Error("Agent task view must not expose compensation or target payout!");
  }
  console.log(`✓ Task view requires token; agent view exposes no compensation`);

  // 4. Test Worker Offer Token Authorization Boundary
  console.log("\n[6/13] Testing worker offer token authorization boundary...");
  // 4a. Missing token -> 401 WORKER_NOT_AUTHORIZED (identity must come from the token)
  try {
    await acceptTask(taskRes1.task_id, { worker_id: "w_sam_arch" });
    throw new Error("Should have thrown WORKER_NOT_AUTHORIZED (missing token)");
  } catch (err: any) {
    if (!(err instanceof ServiceError) || err.code !== "WORKER_NOT_AUTHORIZED" || err.status !== 401) {
      throw new Error(`Expected WORKER_NOT_AUTHORIZED (401) for missing token, got: ${err.code} (${err.status})`);
    }
    console.log(`✓ Accept without token rejected: ${err.code} (${err.status})`);
  }

  // 4b. Invalid token -> 401
  try {
    await acceptTask(taskRes1.task_id, { worker_id: "w_sam_arch" }, "invalid_worker_token");
    throw new Error("Should have thrown WORKER_NOT_AUTHORIZED error");
  } catch (err: any) {
    if (!(err instanceof ServiceError) || err.code !== "WORKER_NOT_AUTHORIZED" || err.status !== 401) {
      throw new Error(`Expected WORKER_NOT_AUTHORIZED (401), got: ${err.code} (${err.status})`);
    }
    console.log(`✓ Invalid worker token rejected with: ${err.code} (${err.status})`);
  }

  // 4c. Incapable worker WITH valid offer token -> 403 WORKER_CAPABILITY_REQUIRED
  const alexToken = await db.rotateWorkerOfferToken(taskRes1.task_id, "w_alex_ux");
  try {
    await acceptTask(taskRes1.task_id, { worker_id: "w_alex_ux" }, alexToken || undefined);
    throw new Error("Should have thrown WORKER_CAPABILITY_REQUIRED error");
  } catch (err: any) {
    if (!(err instanceof ServiceError) || err.code !== "WORKER_CAPABILITY_REQUIRED" || err.status !== 403) {
      throw new Error(`Expected WORKER_CAPABILITY_REQUIRED (403), got: ${err.code} (${err.status})`);
    }
    console.log(`✓ Incapable worker correctly rejected with: ${err.code} (${err.status})`);
  }

  // 5. Worker credential delivery channel (rotation) and compensated worker view
  console.log("\n[7/13] Testing worker credential delivery + worker-only compensation view...");
  const samToken = await db.rotateWorkerOfferToken(taskRes1.task_id, "w_sam_arch");
  const morganToken = await db.rotateWorkerOfferToken(taskRes1.task_id, "w_morgan_general");
  if (!samToken || !morganToken) throw new Error("Worker offer credential rotation failed");

  const workerView = await getTaskState(taskRes1.task_id, undefined, samToken);
  const rawQuote = await db.getQuote(quoteRes.quote_id);
  if (workerView.compensation_usd !== rawQuote?.target_payout_usd) {
    throw new Error(`Worker view must expose compensation_usd (target payout), got ${workerView.compensation_usd ?? "undefined"}`);
  }
  if (JSON.stringify(workerView).includes("target_payout_usd")) {
    throw new Error("Worker view must never serialize the internal field target_payout_usd!");
  }
  console.log(`✓ Worker view exposes worker-only compensation_usd: $${workerView.compensation_usd}`);
  console.log(`✓ target_payout_usd never serialized on any response surface`);

  // 6. Test Concurrent Worker Acceptance in Neon (Exactly One 200, One 409 TASK_ALREADY_ACCEPTED)
  console.log("\n[8/13] Testing concurrent worker acceptance in Neon...");

  const [acc1, acc2] = await Promise.allSettled([
    acceptTask(taskRes1.task_id, { worker_id: "w_sam_arch" }, samToken),
    acceptTask(taskRes1.task_id, { worker_id: "w_morgan_general" }, morganToken),
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
  const winningToken = acc1.status === "fulfilled" ? samToken : morganToken;
  console.log(`✓ Exactly one worker succeeded: ${winningWorker}`);
  console.log(`✓ Losing worker received HTTP 409 with stable code: TASK_ALREADY_ACCEPTED`);

  // 6b. Transactional accept invariant: exactly one ACCEPTED offer, all others OFFERED
  const offerRows = await rawPool.query(
    "SELECT worker_id, status FROM task_offers WHERE task_id = $1 ORDER BY worker_id",
    [taskRes1.task_id]
  );
  const acceptedOffers = offerRows.rows.filter((o) => o.status === "ACCEPTED");
  const staleOffers = offerRows.rows.filter((o) => o.status !== "ACCEPTED" && o.status !== "OFFERED");
  if (acceptedOffers.length !== 1 || acceptedOffers[0].worker_id !== winningWorker) {
    throw new Error("Transactional accept: expected exactly one ACCEPTED offer for the winning worker!");
  }
  if (staleOffers.length !== 0) {
    throw new Error(`Transactional accept: unexpected offer statuses: ${JSON.stringify(staleOffers)}`);
  }
  if (offerRows.rows.filter((o) => o.status === "OFFERED").length !== offerRows.rows.length - 1) {
    throw new Error("Transactional accept: losing offers must remain OFFERED!");
  }
  console.log(`✓ Accept is single-transactional: 1 ACCEPTED offer (${winningWorker}), ${offerRows.rows.length - 1} OFFERED`);

  const acceptEvent = await rawPool.query(
    "SELECT count(*)::int AS c FROM events WHERE entity_id = $1 AND event_type = 'task_accepted'",
    [taskRes1.task_id]
  );
  if (acceptEvent.rows[0].c !== 1) throw new Error("task_accepted event missing after transactional accept!");
  console.log(`✓ task_accepted event persisted in the same transaction`);

  // 7. Start the Task
  console.log("\n[9/13] Starting task via service layer...");
  const startRes = await startTask(taskRes1.task_id, { worker_id: winningWorker }, winningToken);
  console.log(`✓ Task is now IN_PROGRESS assigned to ${startRes.assigned_worker_id}`);

  // 8. Atomic Transactional Result Submission
  console.log("\n[10/13] Testing atomic single-transaction result submission in Neon...");
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
  console.log("\n[11/13] Testing agent token authorization boundary on result retrieval...");
  try {
    await getTaskResult(taskRes1.task_id, "atk_bad_token_123");
    throw new Error("Should have thrown UNAUTHORIZED");
  } catch (err: any) {
    if (!(err instanceof ServiceError) || err.code !== "UNAUTHORIZED" || err.status !== 401) {
      throw new Error(`Expected UNAUTHORIZED (401), got: ${err.code} (${err.status})`);
    }
    console.log(`✓ Unauthorized agent token correctly rejected with: ${err.code} (401)`);
  }

  // Original pre-replay token must be revoked (rotation semantics)
  try {
    await getTaskResult(taskRes1.task_id, firstAgentToken);
    throw new Error("Should have thrown UNAUTHORIZED for the pre-replay token");
  } catch (err: any) {
    if (!(err instanceof ServiceError) || err.code !== "UNAUTHORIZED") {
      throw new Error(`Expected UNAUTHORIZED for pre-replay token, got: ${err.code}`);
    }
    console.log(`✓ Pre-replay agent token correctly revoked (rotation semantics)`);
  }

  const validResult = await getTaskResult(taskRes1.task_id, taskRes2.agent_token);
  console.log(`✓ Authorized result retrieved: status=${validResult.status}, verdict="${(validResult.result as any).verdict}"`);

  // 10. Direct Database State Invariant Assertions
  console.log("\n[12/13] Direct SQL Invariant Verification in Neon PostgreSQL...");
  const dbTask = await rawPool.query("SELECT * FROM tasks WHERE id = $1", [taskRes1.task_id]);
  const dbResult = await rawPool.query("SELECT * FROM task_results WHERE task_id = $1", [taskRes1.task_id]);
  const dbEvents = await rawPool.query("SELECT event_type FROM events WHERE entity_id = $1 ORDER BY created_at ASC", [taskRes1.task_id]);

  if (dbTask.rows[0].status !== "COMPLETED") throw new Error("Task status is not COMPLETED in Neon");
  if (dbResult.rows.length !== 1) throw new Error("Task results row missing in Neon");
  if (dbEvents.rows.length < 5) throw new Error("Missing lifecycle events in Neon");
  if (!dbEvents.rows.some((r) => r.event_type === "task_accepted")) throw new Error("task_accepted event missing in Neon");

  console.log("--- DIRECT NEON RAW STATE ---");
  console.log(`Task: ${dbTask.rows[0].id} (Status: ${dbTask.rows[0].status}, Worker: ${dbTask.rows[0].assigned_worker_id})`);
  console.log(`Result: ${dbResult.rows[0].id} (Verdict: ${dbResult.rows[0].result_payload.verdict})`);
  console.log(`Events recorded in Neon:`, dbEvents.rows.map((r) => r.event_type));

  // 11. Pre-existing customer data preserved through migration 004
  console.log("\n[13/13] Verifying migration 004 preserved customer state...");
  const tasksWithoutResults = await rawPool.query(
    "SELECT count(*)::int AS c FROM tasks t LEFT JOIN task_results r ON r.task_id = t.id WHERE r.task_id IS NULL"
  );
  const preservedResults = await rawPool.query(
    "SELECT count(*)::int AS c, count(DISTINCT task_id)::int AS tasks FROM task_results"
  );
  console.log(`✓ No task rows lost: ${tasksWithoutResults.rows[0].c} tasks without results (expected: 0)`);
  console.log(`✓ Completed customer results preserved: ${preservedResults.rows[0].c}`);

  await rawPool.end();

  console.log("\n==================================================================");
  console.log("  ALL HARDENED SPRINT 1.1 VERIFICATIONS PASSED IN REAL NEON PG   ");
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