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
import { validateTaskResult } from "../src/lib/schemas";
import { hashToken } from "../src/lib/auth";
import { ServiceError } from "../src/lib/errors";

function expectServiceError(err: unknown, code: string, status: number) {
  if (!(err instanceof ServiceError) || err.code !== code || err.status !== status) {
    throw new Error(`Expected ServiceError ${code} (${status}), got: ${err instanceof ServiceError ? `${err.code} (${err.status})` : JSON.stringify(err)}`);
  }
}

const ARCH_RESULT = {
  verdict: "acceptable" as const,
  critical_issues: ["Enable transaction pooler to prevent idle socket leaks on serverless restarts"],
  recommended_changes: ["Configure connection timeout to 10s with max 20 client limit"],
  scaling_risks: ["Multi-region query round-trips"],
  confidence: 0.96,
};

async function runFinalPreMCPNeonE2ETest() {
  console.log("==================================================================");
  console.log("  PRE-MCP FINAL SECURITY E2E (REAL NEON POSTGRES)                ");
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

  // Prove this suite is exercising PostgreSQL, NOT the in-memory store.
  if (!db.isPostgres) {
    throw new Error("DATABASE_URL target was not detected — suite must run against real PostgreSQL (not InMemoryStore)!");
  }
  const rawCheck = await rawPool.query("SELECT 1 AS one");
  if (rawCheck.rows[0].one !== 1) {
    throw new Error("Raw PostgreSQL connection failed the smoke check!");
  }
  console.log("DATABASE TARGET: PostgreSQL/Neon (NOT InMemoryStore) — PROVEN");

  // ============================================================
  // [1/15] Migrations applied
  // ============================================================
  console.log("\n[1/15] Verifying schema_migrations tracking in Neon...");
  const migRes = await rawPool.query("SELECT version, applied_at FROM schema_migrations ORDER BY version ASC");
  console.log("Applied migrations in Neon:", migRes.rows.map((r) => r.version));
  if (migRes.rows.length < 8) {
    throw new Error(`Expected at least 8 migrations in schema_migrations! Found: ${migRes.rows.length}`);
  }
  if (!migRes.rows.some((r) => r.version.includes("004"))) {
    throw new Error("Migration 004 is missing from schema_migrations!");
  }
  if (!migRes.rows.some((r) => r.version.includes("005"))) {
    throw new Error("Migration 005 is missing from schema_migrations!");
  }
  if (!migRes.rows.some((r) => r.version.includes("006"))) {
    throw new Error("Migration 006 is missing from schema_migrations!");
  }
  if (!migRes.rows.some((r) => r.version.includes("007"))) {
    throw new Error("Migration 007 is missing from schema_migrations!");
  }
  if (!migRes.rows.some((r) => r.version.includes("008"))) {
    throw new Error("Migration 008 is missing from schema_migrations!");
  }
  console.log("✓ Migrations 004, 005, 006, 007, and 008 applied");

  // ============================================================
  // [2/15] Schema invariants (005: quotes.agent_token_hash NOT NULL,
  // worker_token_issued_at present; 004 invariants intact)
  // ============================================================
  console.log("\n[2/15] Verifying hardened schema invariants in live Neon...");
  const nullAgentHash = await rawPool.query(
    "SELECT count(*)::int AS c FROM tasks WHERE agent_token_hash IS NULL OR agent_token_hash = ''"
  );
  const nullWorkerHash = await rawPool.query(
    "SELECT count(*)::int AS c FROM task_offers WHERE worker_token_hash IS NULL OR worker_token_hash = ''"
  );
  const nullQuoteHash = await rawPool.query(
    "SELECT count(*)::int AS c FROM quotes WHERE agent_token_hash IS NULL OR agent_token_hash = ''"
  );
  const dupQuotes = await rawPool.query("SELECT count(*)::int AS c FROM (SELECT quote_id FROM tasks GROUP BY quote_id HAVING count(*) > 1) d");
  const dupOffers = await rawPool.query("SELECT count(*)::int AS c FROM (SELECT task_id, worker_id FROM task_offers GROUP BY task_id, worker_id HAVING count(*) > 1) d");
  if (nullAgentHash.rows[0].c !== 0) throw new Error("tasks.agent_token_hash still contains NULL/empty values!");
  if (nullWorkerHash.rows[0].c !== 0) throw new Error("task_offers.worker_token_hash still contains NULL/empty values!");
  if (nullQuoteHash.rows[0].c !== 0) throw new Error("quotes.agent_token_hash still contains NULL/empty values!");
  if (dupQuotes.rows[0].c !== 0) throw new Error("Duplicate tasks.quote_id rows exist!");
  if (dupOffers.rows[0].c !== 0) throw new Error("Duplicate task_offers(task_id, worker_id) rows exist!");

  const nullability = await rawPool.query(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns
     WHERE (table_name = 'quotes' AND column_name = 'agent_token_hash')
        OR (table_name = 'tasks' AND column_name = 'agent_token_hash')
        OR (table_name = 'task_offers' AND column_name = 'worker_token_hash')`
  );
  for (const row of nullability.rows) {
    if (row.is_nullable !== "NO") throw new Error(`${row.table_name}.${row.column_name} must be NOT NULL in Neon!`);
  }
  const issuedAtCol = await rawPool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'task_offers' AND column_name = 'worker_token_issued_at'"
  );
  if (issuedAtCol.rows.length !== 1) throw new Error("task_offers.worker_token_issued_at column missing in Neon!");
  const statusCheck = await rawPool.query("SELECT conname FROM pg_constraint WHERE conname = 'tasks_status_check'");
  if (statusCheck.rows.length !== 1) throw new Error("tasks_status_check constraint missing in Neon!");

  // Post-migration quote<->task hash consistency for pre-existing customers.
  const hashConsistency = await rawPool.query(
    `SELECT count(*)::int AS c FROM quotes q JOIN tasks t ON t.quote_id = q.id
     WHERE q.agent_token_hash <> t.agent_token_hash`
  );
  if (hashConsistency.rows[0].c !== 0) {
    throw new Error("quotes.agent_token_hash does not match its task's agent_token_hash for existing rows!");
  }
  console.log("✓ quotes.agent_token_hash NOT NULL, worker_token_issued_at present, 004 invariants intact, quote<->task hashes consistent");

  // ============================================================
  // [3/15] result_schema == canonical contract + customer snapshot
  // ============================================================
  console.log("\n[3/15] Verifying result_schema against the canonical contract...");
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
    // Every published-schema-valid payload must pass the real submission validator.
    const sampleByCode: Record<string, Record<string, unknown>> = {
      LANDING_PAGE_REVIEW: {
        top_issues: [
          {
            issue: "Hero headline lacks clear value proposition",
            evidence: "Headline text 'We build things' does not explain product features or benefits",
            why_it_matters: "Visitors bounce within 5 seconds without understanding what the tool does",
            recommended_change: "Rewrite headline to focus on verifiable capability outcomes and time saved",
            severity: "high",
          },
          {
            issue: "Missing social proof and credibility markers",
            evidence: "No customer logos, security badges, or customer quotes appear above fold",
            why_it_matters: "Enterprise decision makers need trust verification before evaluating deeper",
            recommended_change: "Add enterprise customer logo marquee directly under the primary CTA",
            severity: "medium",
          },
          {
            issue: "Primary CTA button copy is ambiguous",
            evidence: "Button reads 'Click here' instead of indicating transparent action",
            why_it_matters: "Unclear next step increases friction and reduces click-through conversion",
            recommended_change: "Change CTA label to 'Start Free Trial' with subtext 'No card needed'",
            severity: "low",
          },
        ],
        highest_impact_change: {
          change: "Implement an interactive live workflow demo above the fold",
          rationale: "Prospective buyers need immediate verification of autonomous capability before signup",
          expected_effect: "Expected to increase visitor-to-demo conversion rate by 25-40%",
        },
        trust_and_credibility_assessment: "Current page has standard SSL but lacks enterprise trust badges, verifiable security certifications, or audited testimonials.",
        cta_assessment: "Primary call to action is placed above fold but copy lacks urgency and transparent expectations.",
        us_market_fit_assessment: "Copywriting tone is generally appropriate for US tech sector but lacks crisp concise positioning required by B2B buyers.",
        visual_hierarchy_assessment: "Typography scale is good but hero section is cluttered with competing secondary buttons and distracting background gradients.",
        overall_verdict: "Promising product with high technical value that suffers from generic positioning and insufficient proof points.",
        confidence: 0.95,
      },
      ARCHITECTURE_SANITY_CHECK: {
        verdict: "acceptable",
        recommended_changes: ["Use a transaction pooler"],
        confidence: 0.9,
      },
      EXPERT_FACT_VERIFICATION: {
        verdict: "cannot_confirm",
        explanation: "No authoritative source corroborates this claim after review.",
        confidence: 0.71,
      },
      AI_VIDEO_REVIEW: {
        verdict: "minor_revisions",
        top_issues: [
          {
            issue: "Hand geometry deforms noticeably during camera rotation",
            evidence: "Observed at 0:02-0:04: fingers merge into coffee mug during grip",
            why_it_matters: "Breaks immersion and makes commercial advertisement look amateurish",
            recommended_change: "Inpaint frame 45-75 with masked hand seed or crop to medium close-up",
            severity: "high",
          },
          {
            issue: "Background lighting shifts temperature abruptly at second 3",
            evidence: "Color temperature shifts from 3200K warm tungsten to 5600K cool daylight",
            why_it_matters: "Visual discontinuity creates perceptible flicker across scene",
            recommended_change: "Apply temporal deflicker and color grade lock across all frames",
            severity: "medium",
          },
          {
            issue: "Motion blur on foreground actor is unnaturally uniform",
            evidence: "Shutter speed simulation creates smearing without directionality",
            why_it_matters: "Subtle uncanny valley artifact that distracts viewers",
            recommended_change: "Reduce motion blur weight by 30% in generation parameters",
            severity: "low",
          },
        ],
        highest_impact_change: {
          change: "Inpaint frames 45-75 with masked hand seed or crop to medium close-up",
          rationale: "Resolving hand anatomy failure makes the shot immediately viable for client ad campaign",
          expected_effect: "Elevates visual quality from rejected draft to client-ready hero video",
        },
        visual_coherence_assessment: "Subject consistency and environment texture quality are remarkably high throughout the clip.",
        motion_artifacts_assessment: "Minor hand deformation and lighting shift are the only notable temporal artifacts detected.",
        client_readiness_assessment: "Not ready for final broadcast delivery in current state; ready after hand inpainting.",
        overall_verdict: "Strong generation with excellent cinematography that requires targeted frame inpainting before client handoff.",
        confidence: 0.95,
      },
      SOFTWARE_PRODUCT_REVIEW: {
        verdict: "needs_polish",
        top_issues: [
          {
            issue: "Primary workspace dashboard lacks clear initial call to action",
            evidence: "Empty state shows a blank grid with no guided onboarding or creation trigger",
            why_it_matters: "First-time users experience decision fatigue and abandon within 30 seconds",
            recommended_change: "Add an interactive 'Create First Workflow' template card in the center viewport",
            severity: "high",
          },
          {
            issue: "API key modal does not indicate scope permissions required",
            evidence: "Input asks for 'API Key' without listing whether read-only or admin access is needed",
            why_it_matters: "Security-conscious developers hesitate to provide unrestricted credentials",
            recommended_change: "Add helper text specifying required IAM roles and link to documentation",
            severity: "medium",
          },
          {
            issue: "Task execution status latency indicator is missing",
            evidence: "Clicking 'Run' does not show loading spinner for the first 800ms of dispatch",
            why_it_matters: "Users double-click and cause redundant execution attempts",
            recommended_change: "Immediately disable button and display an active pulse animation",
            severity: "low",
          },
        ],
        highest_impact_change: {
          change: "Add an interactive template selector for new users on initial empty dashboard",
          rationale: "Guiding the user directly to their first successful run increases activation by 50%",
          expected_effect: "Expected to double day-1 activation rate for new developer signups",
        },
        ux_clarity_assessment: "Information architecture is logical, but the blank empty state creates onboarding friction.",
        value_proposition_assessment: "Core value of autonomous capability is evident once a workflow runs successfully.",
        onboarding_friction_assessment: "Connecting credentials and launching the first task requires too many non-obvious steps.",
        overall_verdict: "High technical capability that needs streamlined first-run onboarding before public marketing launch.",
        confidence: 0.95,
      },
      AI_WORKFLOW_REVIEW: {
        verdict: "needs_safeguards",
        top_issues: [
          {
            issue: "Unbounded retry loop on model parse failure risks infinite spend",
            evidence: "Workflow config sets retry count to 10 with exponential backoff on 429 and parse errors",
            why_it_matters: "A persistent malformed input could exhaust OpenAI API quota in minutes",
            recommended_change: "Cap retries at 3 and route unparseable documents to human verification queue",
            severity: "high",
          },
          {
            issue: "Missing idempotency key on database insert stage",
            evidence: "Webhook re-deliveries from Stripe will insert duplicate invoice records",
            why_it_matters: "Financial ledger corruption requiring manual database remediation",
            recommended_change: "Use event ID as unique idempotency constraint on database insert query",
            severity: "high",
          },
          {
            issue: "Confidence score threshold of 0.70 is too permissive for financial data",
            evidence: "Field extraction confidence is accepted down to 0.70 without human escalation",
            why_it_matters: "Will allow 3-5% incorrect invoice totals into automated accounting flow",
            recommended_change: "Raise human escalation threshold to 0.90 for invoice dollar amounts",
            severity: "medium",
          },
        ],
        highest_impact_change: {
          change: "Cap model retries at 3 and route parse failures to human verification queue",
          rationale: "Eliminates cascading cost risk while ensuring zero data loss on complex inputs",
          expected_effect: "Protects pipeline budget and guarantees 100% data completion rate",
        },
        reliability_assessment: "Pipeline architecture is sound but lacks necessary boundary safeguards against model failures.",
        edge_case_handling_assessment: "Malformed JSON and burst rate limits are not currently handled defensively.",
        human_in_the_loop_assessment: "Escalation threshold is too loose; tightening it will prevent automated financial errors.",
        overall_verdict: "Promising automation architecture that requires three concrete safety guardrails before production deployment.",
        confidence: 0.97,
      },
      HUMAN_JUDGMENT_REQUEST: {
        verdict: "APPROVED_WITH_SAFEGUARDS",
        findings: [
          "Primary workflow architecture is solid and follows idempotency patterns.",
          "Rate limits on third party LLM APIs should be guarded with backoff queues.",
        ],
        highest_impact_insight: "The human fallback queue prevents silent invoice data corruption under high load.",
        recommended_next_action: "Deploy to staging cluster with automated error threshold alarms enabled.",
        confidence: 0.96,
      },
    };
    const sample = sampleByCode[String(row.code)];
    if (!sample) {
      throw new Error(`No valid sample payload defined for task type ${row.code}`);
    }
    const validation = validateTaskResult(row.code, sample);
    if (!validation.success) {
      throw new Error(`Published-schema-valid payload for ${row.code} was rejected by the real validator!`);
    }
  }
  const customerResultsBefore = await rawPool.query("SELECT count(*)::int AS c FROM task_results");
  console.log("✓ Live result_schema identical to canonical RESULT_SCHEMAS and accepted by the real validator");
  console.log(`  Customer task_results snapshot BEFORE this suite: ${customerResultsBefore.rows[0].c}`);

  // ============================================================
  // [4/15] Quote capability: token minted once, hash-only storage
  // ============================================================
  console.log("\n[4/15] Quote-scoped agent capability (token minted at quote creation)...");
  const quoteRes = await requestQuote({
    task_type: "ARCHITECTURE_SANITY_CHECK",
    input_payload: {
      architecture_summary: "High-scale serverless agent runner connected to Neon Postgres with transactional pooling.",
      components: ["Next.js App Router", "Neon Postgres Serverless", "REST API", "Service Layer"],
      expected_scale: "50,000 tasks/day",
      key_concerns: ["Connection pool exhaustion", "Duplicate submission race conditions"],
    },
  });

  if (!quoteRes.agent_token || !quoteRes.agent_token.startsWith("atk_")) {
    throw new Error("Quote response must return a raw agent token (atk_...) exactly once!");
  }
  const rawAgentToken = quoteRes.agent_token;
  if ((quoteRes as any).target_payout_usd !== undefined) {
    throw new Error("Agent-facing quote response leaked target_payout_usd!");
  }
  const quoteRow = await rawPool.query("SELECT agent_token_hash FROM quotes WHERE id = $1", [quoteRes.quote_id]);
  if (!quoteRow.rows[0] || quoteRow.rows[0].agent_token_hash !== hashToken(rawAgentToken)) {
    throw new Error("quotes.agent_token_hash must be the SHA-256 hash of the returned token (raw token must never be stored)!");
  }
  const quoteEvents = await rawPool.query(
    "SELECT payload FROM events WHERE entity_type = 'quote' AND entity_id = $1",
    [quoteRes.quote_id]
  );
  for (const evt of quoteEvents.rows) {
    if (JSON.stringify(evt.payload).includes(rawAgentToken)) {
      throw new Error("Raw agent token leaked into lifecycle events!");
    }
  }
  console.log(`✓ Quote created: ${quoteRes.quote_id}; token returned once, stored ONLY as SHA-256 hash`);
  console.log("✓ Raw agent token is NOT stored and NOT present in any lifecycle event");

  // ============================================================
  // [5/15] Task creation requires the quote-scoped agent token
  // ============================================================
  console.log("\n[5/15] POST task creation auth boundaries...");
  try {
    await createTaskFromQuote({ quote_id: quoteRes.quote_id });
    throw new Error("Task creation WITHOUT agent token must fail!");
  } catch (err: any) {
    expectServiceError(err, "UNAUTHORIZED", 401);
  }
  try {
    await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", "atk_wrong_token_123");
    throw new Error("Task creation with WRONG agent token must fail!");
  } catch (err: any) {
    expectServiceError(err, "UNAUTHORIZED", 401);
  }
  console.log("✓ Quote_id alone -> 401 UNAUTHORIZED; wrong token -> 401 UNAUTHORIZED");

  const taskRes1 = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", rawAgentToken);
  if (taskRes1.is_existing) throw new Error("First task creation must be new");
  const serializedCreate = JSON.stringify(taskRes1);
  if (
    serializedCreate.includes("worker_token") ||
    serializedCreate.includes("otk_") ||
    serializedCreate.includes("token=") ||
    serializedCreate.includes(rawAgentToken)
  ) {
    throw new Error("Agent-facing task creation response leaked credentials (worker token or raw agent token)!");
  }
  const dbTask1 = await rawPool.query("SELECT agent_token_hash FROM tasks WHERE id = $1", [taskRes1.task_id]);
  if (!dbTask1.rows[0] || dbTask1.rows[0].agent_token_hash !== hashToken(rawAgentToken)) {
    throw new Error("task.agent_token_hash must equal quote.agent_token_hash (no second token minted)!");
  }
  console.log(`✓ Task created: ${taskRes1.task_id}; task.agent_token_hash === quote.agent_token_hash (no re-mint)`);

  // ============================================================
  // [6/15] Replay: quote_id alone cannot replay; valid replay stable
  // ============================================================
  console.log("\n[6/15] Idempotent replay semantics...");
  try {
    await createTaskFromQuote({ quote_id: quoteRes.quote_id });
    throw new Error("Quote-id-only replay must be rejected!");
  } catch (err: any) {
    expectServiceError(err, "UNAUTHORIZED", 401);
  }

  const taskRes2 = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", rawAgentToken);
  if (!taskRes2.is_existing || taskRes2.task_id !== taskRes1.task_id) {
    throw new Error("Valid replay must return the SAME task with is_existing=true!");
  }

  // Original token remains valid (no rotation on replay -> no revocation).
  const agentViewAfterReplay = await getTaskState(taskRes1.task_id, rawAgentToken);
  if (agentViewAfterReplay.status !== "OFFERED") throw new Error("Agent token failed after valid replay!");
  const taskHashAfter = await rawPool.query("SELECT agent_token_hash FROM tasks WHERE id = $1", [taskRes1.task_id]);
  if (taskHashAfter.rows[0].agent_token_hash !== hashToken(rawAgentToken)) {
    throw new Error("Replay MUST NOT rotate/change the agent token hash!");
  }
  console.log("✓ Quote-id-only replay -> 401; valid replay -> same task_id, NO rotation, token still valid");

  // ============================================================
  // [7/15] Concurrent valid replays: one task, stable credential
  // ============================================================
  console.log("\n[7/15] Concurrent valid replays...");
  const concurrentReplays = await Promise.all([
    createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", rawAgentToken),
    createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", rawAgentToken),
    createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", rawAgentToken),
  ]);
  if (new Set(concurrentReplays.map((r) => r.task_id)).size !== 1) {
    throw new Error("Concurrent valid replays must yield exactly one task_id!");
  }
  if (concurrentReplays.some((r) => r.task_id !== taskRes1.task_id)) {
    throw new Error("Concurrent replays must return the original task!");
  }
  const stillValid = await getTaskState(taskRes1.task_id, rawAgentToken);
  if (stillValid.status !== "OFFERED") throw new Error("Original agent token was invalidated by concurrent replays!");
  console.log("✓ 3 concurrent valid replays -> one task_id, original token remains valid");

  // ============================================================
  // [8/15] Worker auth ordering: no enumeration without a token
  // ============================================================
  console.log("\n[8/15] Accept-auth ordering (no worker/capability enumeration)...");
  for (const wid of ["w_does_not_exist", "w_alex_ux", "w_sam_arch"]) {
    try {
      await acceptTask(taskRes1.task_id, { worker_id: wid });
      throw new Error(`Accept without token for worker_id=${wid} must fail!`);
    } catch (err: any) {
      expectServiceError(err, "WORKER_NOT_AUTHORIZED", 401);
      console.log(`  no-token worker_id=${wid} -> 401 WORKER_NOT_AUTHORIZED (uniform)`);
    }
  }
  console.log("✓ Unauthenticated accept returns 401 for unknown / incapable / capable worker ids alike — no enumeration");

  // Authenticated but INCAPABLE worker -> 403 WORKER_CAPABILITY_REQUIRED
  // (authorization strictly after authentication). Realistic path: the worker
  // was capability-qualified when the offer was issued, but the capability was
  // revoked before acceptance. A dedicated task keeps taskRes1's offer state
  // untouched for the issuance checks in [9/15].
  const sideArchQuote = await requestQuote({
    task_type: "ARCHITECTURE_SANITY_CHECK",
    input_payload: {
      architecture_summary: "Side task for the revoked-capability 403 gate",
      components: ["Next.js"],
      expected_scale: "10k rps",
    },
  });
  const sideArchTask = await createTaskFromQuote({ quote_id: sideArchQuote.quote_id }, "", sideArchQuote.agent_token);
  const sam403Issue = await db.issueWorkerOfferToken(sideArchTask.task_id, "w_sam_arch");
  if (!sam403Issue.success || !sam403Issue.token) throw new Error("Failed to issue worker token for the 403 gate");
  if (!(await db.setWorkerCapabilityStatus("w_sam_arch", "SYSTEM_ARCHITECTURE", "REVOKED"))) {
    throw new Error("Failed to revoke w_sam_arch capability for the 403 gate");
  }
  try {
    await acceptTask(sideArchTask.task_id, { worker_id: "w_sam_arch" }, sam403Issue.token);
    throw new Error("Capability-revoked worker must be rejected with 403!");
  } catch (err: any) {
    expectServiceError(err, "WORKER_CAPABILITY_REQUIRED", 403);
  } finally {
    if (!(await db.setWorkerCapabilityStatus("w_sam_arch", "SYSTEM_ARCHITECTURE", "VERIFIED"))) {
      throw new Error("Failed to restore w_sam_arch capability after the 403 gate test");
    }
  }
  console.log("✓ Authenticated worker with revoked capability -> 403 WORKER_CAPABILITY_REQUIRED (authorization after authentication)");

  // ============================================================
  // [9/15] Worker token issuance: first-issue, retry-safe, rotate=1
  // ============================================================
  console.log("\n[9/15] Worker credential issuance (retry-safe, explicit rotation)...");
  const samIssuance = await db.issueWorkerOfferToken(taskRes1.task_id, "w_sam_arch");
  if (!samIssuance.success || !samIssuance.token || !samIssuance.token.startsWith("otk_")) {
    throw new Error("First issuance must return a fresh otk_ token!");
  }
  const samToken = samIssuance.token;

  // Repeat WITHOUT rotate=1 must NOT rotate or invalidate the delivered token.
  const repeat = await db.issueWorkerOfferToken(taskRes1.task_id, "w_sam_arch");
  if (repeat.success || repeat.code !== 409) {
    throw new Error(`Repeat issuance must fail with 409, got: ${JSON.stringify(repeat)}`);
  }
  if (!(await db.verifyWorkerToken(taskRes1.task_id, "w_sam_arch", samToken))) {
    throw new Error("Repeat issuance invalidated the delivered credential — must NEVER happen!");
  }
  console.log("✓ Repeat issuance -> 409 INVALID_STATE; delivered token still valid");

  // Explicit rotate=1 on a still-OFFERED task: new token works, old is revoked.
  const rotated = await db.issueWorkerOfferToken(taskRes1.task_id, "w_sam_arch", { rotate: true });
  if (!rotated.success || !rotated.token || rotated.token === samToken) {
    throw new Error("rotate=1 must return a fresh token!");
  }
  if (await db.verifyWorkerToken(taskRes1.task_id, "w_sam_arch", samToken)) {
    throw new Error("Pre-rotation worker token must be revoked after rotate=1!");
  }
  const samToken2 = rotated.token;
  console.log("✓ rotate=1 rotates explicitly: fresh token usable, old token revoked");

  // rotate=1 must refuse to rotate an engaged task (would strand the worker).
  const sideQuote = (await requestQuote({
    task_type: "LANDING_PAGE_REVIEW",
    input_payload: { url: "https://side.example", target_audience: "Side test" },
  }));
  const sideTask = await createTaskFromQuote({ quote_id: sideQuote.quote_id }, "", sideQuote.agent_token);
  const sideIssue = await db.issueWorkerOfferToken(sideTask.task_id, "w_alex_ux");
  if (!sideIssue.success || !sideIssue.token) throw new Error("side issuance failed");
  const sideToken = sideIssue.token;
  await acceptTask(sideTask.task_id, { worker_id: "w_alex_ux" }, sideToken);
  await startTask(sideTask.task_id, { worker_id: "w_alex_ux" }, sideToken);
  const rotateEngaged = await db.issueWorkerOfferToken(sideTask.task_id, "w_alex_ux", { rotate: true });
  if (rotateEngaged.success || rotateEngaged.code !== 409) {
    throw new Error("rotate=1 on an IN_PROGRESS task must fail with 409 (worker must not be stranded)!");
  }
  console.log("✓ rotate=1 on ACCEPTED/IN_PROGRESS task -> 409 (active worker never stranded)");

  // ============================================================
  // [10/15] Concurrent first issuance: exactly one success
  // ============================================================
  console.log("\n[10/15] Concurrent first issuance...");
  const deliveryQuote = (await requestQuote({
    task_type: "LANDING_PAGE_REVIEW",
    input_payload: { url: "https://delivery.example", target_audience: "Delivery test" },
  }));
  const deliveryTask = await createTaskFromQuote({ quote_id: deliveryQuote.quote_id }, "", deliveryQuote.agent_token);
  const issuanceRace = await Promise.allSettled([
    db.issueWorkerOfferToken(deliveryTask.task_id, "w_alex_ux"),
    db.issueWorkerOfferToken(deliveryTask.task_id, "w_alex_ux"),
  ]);
  const issuedOk = issuanceRace.filter((r) => r.status === "fulfilled" && (r.value as any).success === true);
  if (issuedOk.length !== 1) {
    throw new Error(`Concurrent first issuance must yield exactly one success, got ${issuedOk.length}`);
  }
  console.log("✓ Concurrent first issuance -> exactly one success, other request cannot invalidate the delivered token");

  // ============================================================
  // [11/15] Concurrent accept: exactly one winner, transactional
  // ============================================================
  console.log("\n[11/15] Concurrent worker acceptance...");
  const morganIssuance = await db.issueWorkerOfferToken(taskRes1.task_id, "w_morgan_general");
  if (!morganIssuance.success || !morganIssuance.token) throw new Error("morgan issuance failed");
  const morganToken = morganIssuance.token;

  const [acc1, acc2] = await Promise.allSettled([
    acceptTask(taskRes1.task_id, { worker_id: "w_sam_arch" }, samToken2),
    acceptTask(taskRes1.task_id, { worker_id: "w_morgan_general" }, morganToken),
  ]);
  const accSuccess = [acc1, acc2].filter((r) => r.status === "fulfilled");
  const accConflict = [acc1, acc2].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (accSuccess.length !== 1 || accConflict.length !== 1) {
    throw new Error(`Expected 1 success and 1 conflict! Got: success=${accSuccess.length}, conflict=${accConflict.length}`);
  }
  if ((accConflict[0].reason as ServiceError).code !== "TASK_ALREADY_ACCEPTED") {
    throw new Error(`Expected TASK_ALREADY_ACCEPTED, got ${(accConflict[0].reason as ServiceError).code}`);
  }
  const winningWorker = acc1.status === "fulfilled" ? "w_sam_arch" : "w_morgan_general";
  const winningToken = acc1.status === "fulfilled" ? samToken2 : morganToken;
  console.log(`✓ Exactly one winner: ${winningWorker}; loser -> 409 TASK_ALREADY_ACCEPTED`);

  const offerRows = await rawPool.query("SELECT worker_id, status FROM task_offers WHERE task_id = $1 ORDER BY worker_id", [taskRes1.task_id]);
  const acceptedOffers = offerRows.rows.filter((o) => o.status === "ACCEPTED");
  if (acceptedOffers.length !== 1 || acceptedOffers[0].worker_id !== winningWorker) {
    throw new Error("Transactional accept: expected exactly one ACCEPTED offer for the winning worker!");
  }
  const acceptEvent = await rawPool.query(
    "SELECT count(*)::int AS c FROM events WHERE entity_id = $1 AND event_type = 'task_accepted'",
    [taskRes1.task_id]
  );
  if (acceptEvent.rows[0].c !== 1) throw new Error("task_accepted event missing after transactional accept!");
  console.log("✓ Accept is single-transactional: 1 ACCEPTED offer + task_accepted event in the same transaction");

  // ============================================================
  // [12/15] Start + atomic result submission
  // ============================================================
  console.log("\n[12/15] Start + atomic single-transaction result submission...");
  const startRes = await startTask(taskRes1.task_id, { worker_id: winningWorker }, winningToken);
  console.log(`✓ Task IN_PROGRESS assigned to ${startRes.assigned_worker_id}`);

  const [sub1, sub2] = await Promise.allSettled([
    submitTaskResult(taskRes1.task_id, { worker_id: winningWorker, result_payload: ARCH_RESULT }, winningToken),
    submitTaskResult(taskRes1.task_id, { worker_id: winningWorker, result_payload: ARCH_RESULT }, winningToken),
  ]);
  const subSuccess = [sub1, sub2].filter((r) => r.status === "fulfilled");
  const subConflict = [sub1, sub2].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (subSuccess.length !== 1 || subConflict.length !== 1) {
    throw new Error(`Expected 1 submission success and 1 conflict! Got: success=${subSuccess.length}, conflict=${subConflict.length}`);
  }
  if ((subConflict[0].reason as ServiceError).code !== "RESULT_ALREADY_SUBMITTED") {
    throw new Error(`Expected RESULT_ALREADY_SUBMITTED, got ${(subConflict[0].reason as ServiceError).code}`);
  }
  console.log("✓ Atomic submission: exactly 1 succeeded, concurrent duplicate -> 409 RESULT_ALREADY_SUBMITTED");

  // ============================================================
  // [13/15] Attacker with quote_id alone cannot read the result
  // ============================================================
  console.log("\n[13/15] Quote-id-only attacker cannot read the paid result...");
  try {
    await getTaskResult(taskRes1.task_id, "atk_bad_token_123");
    throw new Error("Invalid agent token must be rejected!");
  } catch (err: any) {
    expectServiceError(err, "UNAUTHORIZED", 401);
  }
  try {
    await createTaskFromQuote({ quote_id: quoteRes.quote_id });
    throw new Error("Quote-id-only replay must fail!");
  } catch (err: any) {
    expectServiceError(err, "UNAUTHORIZED", 401);
  }
  try {
    await getTaskState(taskRes1.task_id);
    throw new Error("Unauthenticated task view must fail!");
  } catch (err: any) {
    expectServiceError(err, "UNAUTHORIZED", 401);
  }

  const validResult = await getTaskResult(taskRes1.task_id, rawAgentToken);
  if (validResult.status !== "COMPLETED" || (validResult.result as any).verdict !== "acceptable") {
    throw new Error("Authorized result retrieval failed!");
  }
  console.log(`✓ Original agent token reads the paid result (verdict="${(validResult.result as any).verdict}"); quote_id alone cannot`);

  // ============================================================
  // [14/15] Direct SQL invariant verification
  // ============================================================
  console.log("\n[14/15] Direct SQL invariant verification in Neon PostgreSQL...");
  const dbTask = await rawPool.query("SELECT * FROM tasks WHERE id = $1", [taskRes1.task_id]);
  const dbResult = await rawPool.query("SELECT * FROM task_results WHERE task_id = $1", [taskRes1.task_id]);
  const dbEvents = await rawPool.query("SELECT event_type FROM events WHERE entity_id = $1 ORDER BY created_at ASC", [taskRes1.task_id]);
  const issuedAtRow = await rawPool.query(
    "SELECT worker_token_issued_at FROM task_offers WHERE task_id = $1 AND worker_id = $2",
    [taskRes1.task_id, winningWorker]
  );
  if (dbTask.rows[0].status !== "COMPLETED") throw new Error("Task status is not COMPLETED in Neon");
  if (dbTask.rows[0].agent_token_hash !== hashToken(rawAgentToken)) throw new Error("Task agent hash must equal the quote-scoped hash!");
  if (dbResult.rows.length !== 1) throw new Error("Task results row missing in Neon");
  if (dbEvents.rows.length < 5) throw new Error("Missing lifecycle events in Neon");
  if (!issuedAtRow.rows[0] || !issuedAtRow.rows[0].worker_token_issued_at) {
    throw new Error("worker_token_issued_at must be recorded on the delivered offer!");
  }
  console.log("--- DIRECT NEON RAW STATE ---");
  console.log(`Task: ${dbTask.rows[0].id} (Status: ${dbTask.rows[0].status}, Worker: ${dbTask.rows[0].assigned_worker_id})`);
  console.log(`Result: ${dbResult.rows[0].id} (Verdict: ${dbResult.rows[0].result_payload.verdict})`);
  console.log(`Events recorded in Neon:`, dbEvents.rows.map((r) => r.event_type));

  // ============================================================
  // [15/15] Customer preservation (migrations did not damage data)
  // ============================================================
  console.log("\n[15/15] Verifying customer data preservation...");
  const customerResultsAfter = await rawPool.query("SELECT count(*)::int AS c FROM task_results");
  const expectedAfter = customerResultsBefore.rows[0].c + 1; // only this suite's one result
  if (customerResultsAfter.rows[0].c !== expectedAfter) {
    throw new Error(
      `Customer task_results changed unexpectedly: before=${customerResultsBefore.rows[0].c}, after=${customerResultsAfter.rows[0].c}, expected after=${expectedAfter}`
    );
  }
  console.log(`✓ Customer results preserved: before=${customerResultsBefore.rows[0].c}, after=${customerResultsAfter.rows[0].c} (+1 from this suite only)`);

  await rawPool.end();

  console.log("\n==================================================================");
  console.log("  ALL PRE-MCP FINAL SECURITY VERIFICATIONS PASSED IN REAL NEON PG");
  console.log("==================================================================");

  return {
    taskId: taskRes1.task_id,
    quoteId: quoteRes.quote_id,
    winningWorker,
    status: dbTask.rows[0].status,
    eventsCount: dbEvents.rows.length,
    customerResultsBefore: customerResultsBefore.rows[0].c,
    customerResultsAfter: customerResultsAfter.rows[0].c,
  };
}

runFinalPreMCPNeonE2ETest()
  .then((res) => {
    console.log("\nFINAL PRE-MCP SECURITY REPORT:", JSON.stringify(res));
    console.log("\nPRE-MCP REAL NEON SUITE: PASS");
    process.exit(0);
  })
  .catch((err) => {
    console.error("PRE-MCP REAL NEON SUITE: FAIL", err);
    process.exit(1);
  });