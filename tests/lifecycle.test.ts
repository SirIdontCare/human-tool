import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { canTransition, VALID_TRANSITIONS } from "../src/lib/state-machine";
import { requestQuote } from "../src/services/quotes";
import {
  createTaskFromQuote,
  acceptTask,
  startTask,
  submitTaskResult,
  getTaskResult,
  getTaskState,
} from "../src/services/tasks";
import { RESULT_SCHEMAS } from "../src/lib/catalogue";
import { validateTaskResult } from "../src/lib/schemas";
import { ServiceError } from "../src/lib/errors";

describe("Sprint 1.1 Hardened Invariant & Security Verification Suite", () => {
  beforeEach(() => {
    db.resetMemStore();
  });

  // 1. Production Database Safety
  it("should fail fast in production mode if DATABASE_URL is missing and never use in-memory storage", async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDbUrl = process.env.DATABASE_URL;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.DATABASE_URL;

      await expect(db.getAllTaskTypes()).rejects.toThrow(
        /DATABASE_URL environment variable is required in production/
      );
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
    }
  });

  // 2. Quote Response Sanitization (No Target Payout or Platform Margin Exposed to Agents)
  it("should not expose target_payout_usd or internal platform margin in quote responses", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://agent-startup.io", target_audience: "AI Developers" },
    });

    expect(quoteRes.customer_price_usd).toBe(39.0);
    expect(quoteRes.available).toBe(true);
    expect(JSON.stringify(quoteRes)).not.toContain("target_payout_usd");
    expect((quoteRes as any).target_payout_usd).toBeUndefined();
    expect((quoteRes as any).margin_usd).toBeUndefined();
  });

  // 3. Expired Quote Rejection with Stable Error Code
  it("should reject expired quotes with stable error code QUOTE_EXPIRED", async () => {
    const expiredQuote = await db.createQuote({
      id: "quote_expired_test",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() - 5000).toISOString(), // expired 5 seconds ago
    });

    await expect(createTaskFromQuote({ quote_id: expiredQuote.id })).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
      status: 400,
    });
  });

  // 4. Concurrent Duplicate Task Creation (Database Idempotency)
  it("should return the exact same task when creating concurrently from the same quote", async () => {
    const quote = await db.createQuote({
      id: "quote_test_idempotent_1_1",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "B2B SaaS" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const results = await Promise.all([
      createTaskFromQuote({ quote_id: quote.id }),
      createTaskFromQuote({ quote_id: quote.id }),
      createTaskFromQuote({ quote_id: quote.id }),
    ]);

    const uniqueTaskIds = new Set(results.map((r) => r.task_id));
    expect(uniqueTaskIds.size).toBe(1);
    expect(results.filter((r) => !r.is_existing)).toHaveLength(1);
    expect(results.filter((r) => r.is_existing)).toHaveLength(2);
  });

  // 5. Incapable Worker Acceptance Enforcement with Stable Error Code
  it("should reject task acceptance with 403 and WORKER_CAPABILITY_REQUIRED when worker lacks verified capability", async () => {
    const quote = await db.createQuote({
      id: "quote_test_cap_1_1",
      task_type_id: "ARCHITECTURE_SANITY_CHECK", // requires SYSTEM_ARCHITECTURE
      input_payload: {
        architecture_summary: "Multi-tenant Kubernetes deployment",
        components: ["Kubernetes", "PostgreSQL"],
        expected_scale: "10k rps",
      },
      quoted_price_usd: 69.0,
      target_payout_usd: 45.0,
      estimated_minutes: 60,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });
    const alexToken = (await db.rotateWorkerOfferToken(taskRes.task_id, "w_alex_ux")) ?? undefined;

    // w_alex_ux has UX_CONVERSION_ANALYSIS, but NOT SYSTEM_ARCHITECTURE
    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_alex_ux" }, alexToken)
    ).rejects.toMatchObject({
      code: "WORKER_CAPABILITY_REQUIRED",
      status: 403,
    });
  });

  // 6. Concurrent Task Acceptance (Exactly One 200, One 409 with TASK_ALREADY_ACCEPTED)
  it("should allow exactly one worker to accept concurrently, returning TASK_ALREADY_ACCEPTED to loser", async () => {
    const quote = await db.createQuote({
      id: "quote_test_race_accept_1_1",
      task_type_id: "ARCHITECTURE_SANITY_CHECK",
      input_payload: {
        architecture_summary: "Distributed system on Neon Postgres",
        components: ["Next.js", "Neon Postgres"],
        expected_scale: "50k rps",
      },
      quoted_price_usd: 69.0,
      target_payout_usd: 45.0,
      estimated_minutes: 60,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });
    const token1 = await db.rotateWorkerOfferToken(taskRes.task_id, "w_sam_arch");
    const token2 = await db.rotateWorkerOfferToken(taskRes.task_id, "w_morgan_general");

    const [res1, res2] = await Promise.allSettled([
      acceptTask(taskRes.task_id, { worker_id: "w_sam_arch" }, token1 || undefined),
      acceptTask(taskRes.task_id, { worker_id: "w_morgan_general" }, token2 || undefined),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
    const rejected = [res1, res2].filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe("TASK_ALREADY_ACCEPTED");
    expect(rejected[0].reason.status).toBe(409);
  });

  // 7. Concurrent Duplicate Result Submissions (Atomic Single Transaction)
  it("should handle concurrent submissions atomically: exactly one success, other returns 409 RESULT_ALREADY_SUBMITTED", async () => {
    const quote = await db.createQuote({
      id: "quote_test_race_submit_1_1",
      task_type_id: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Neon supports branching in Postgres", context: "Documentation check" },
      quoted_price_usd: 29.0,
      target_payout_usd: 18.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });
    const elenaToken = await db.rotateWorkerOfferToken(taskRes.task_id, "w_elena_fact");

    await acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken || undefined);
    await startTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken || undefined);

    const validResult = {
      verdict: "true" as const,
      explanation: "Neon architecture decouples storage and compute allowing instant branching.",
      confidence: 0.99,
    };

    const [sub1, sub2] = await Promise.allSettled([
      submitTaskResult(taskRes.task_id, { worker_id: "w_elena_fact", result_payload: validResult }, elenaToken || undefined),
      submitTaskResult(taskRes.task_id, { worker_id: "w_elena_fact", result_payload: validResult }, elenaToken || undefined),
    ]);

    const fulfilled = [sub1, sub2].filter((s) => s.status === "fulfilled");
    const rejected = [sub1, sub2].filter((s) => s.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe("RESULT_ALREADY_SUBMITTED");
    expect(rejected[0].reason.status).toBe(409);
  });

  // 8. Result Retrieval Guard Before Completion (RESULT_NOT_READY)
  it("should reject result retrieval before task completion with RESULT_NOT_READY", async () => {
    const quote = await db.createQuote({
      id: "quote_test_not_ready",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });

    await expect(
      getTaskResult(taskRes.task_id, taskRes.agent_token)
    ).rejects.toMatchObject({
      code: "RESULT_NOT_READY",
      status: 400,
    });
  });

  // 9. Agent Token Authorization Boundary (UNAUTHORIZED)
  it("should reject result access with UNAUTHORIZED when agent token is missing or invalid", async () => {
    const quote = await db.createQuote({
      id: "quote_test_auth_check",
      task_type_id: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Verifiable fact check claim", context: "Context check" },
      quoted_price_usd: 29.0,
      target_payout_usd: 18.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });
    const elenaToken = await db.rotateWorkerOfferToken(taskRes.task_id, "w_elena_fact");

    await acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken || undefined);
    await startTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken || undefined);
    await submitTaskResult(
      taskRes.task_id,
      {
        worker_id: "w_elena_fact",
        result_payload: { verdict: "true", explanation: "Verified via authoritative records.", confidence: 0.98 },
      },
      elenaToken || undefined
    );

    // Reject with invalid token
    await expect(
      getTaskResult(taskRes.task_id, "atk_invalid_token_123")
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    // Accept with valid agent token
    const result = await getTaskResult(taskRes.task_id, taskRes.agent_token);
    expect(result.status).toBe("COMPLETED");
    expect((result.result as any).verdict).toBe("true");
  });

  // 10. Fail-Closed Task View Authorization: an agent OR worker token is always required
  it("should require a valid agent or worker token for task state and expose compensation only to authenticated workers", async () => {
    const quote = await db.createQuote({
      id: "quote_test_view_auth",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });

    // No token / invalid tokens -> 401 UNAUTHORIZED
    await expect(getTaskState(taskRes.task_id)).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(getTaskState(taskRes.task_id, "atk_bad")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(getTaskState(taskRes.task_id, undefined, "otk_bad")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    // Agent view: no compensation_usd, never target_payout_usd
    const agentView = await getTaskState(taskRes.task_id, taskRes.agent_token);
    expect(agentView.status).toBe("OFFERED");
    expect((agentView as TaskStateNoComp).compensation_usd).toBeUndefined();
    expect(JSON.stringify(agentView)).not.toContain("target_payout_usd");

    // Worker view (delivered offer credential): worker-only compensation_usd
    const alexToken = await db.rotateWorkerOfferToken(taskRes.task_id, "w_alex_ux");
    const workerView = await getTaskState(taskRes.task_id, undefined, alexToken || undefined);
    expect(workerView.compensation_usd).toBe(25.0);
    expect(JSON.stringify(workerView)).not.toContain("target_payout_usd");
  });

  // 11. Fail-Closed Agent Auth: a task WITHOUT a stored agent token hash is always UNAUTHORIZED
  it("should fail closed with UNAUTHORIZED when the stored agent_token_hash is missing", async () => {
    const quote = await db.createQuote({
      id: "quote_test_null_hash",
      task_type_id: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Check claim", context: "Context for checking the claim" },
      quoted_price_usd: 29.0,
      target_payout_usd: 18.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });

    // Simulate pre-migration drift: stored hash missing
    expect(await db.setAgentTokenHash(taskRes.task_id, null)).toBe(true);

    await expect(
      getTaskState(taskRes.task_id, "atk_whatever")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(
      getTaskResult(taskRes.task_id, "atk_whatever")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    // Worker access via a valid offer token still works (worker auth is independent)
    const elenaToken = await db.rotateWorkerOfferToken(taskRes.task_id, "w_elena_fact");
    const workerView = await getTaskState(taskRes.task_id, undefined, elenaToken || undefined);
    expect(workerView.compensation_usd).toBe(18.0);
  });

  // 12. Worker tokens are MANDATORY for accept/start/submit (no worker_id fallback)
  it("should require the per-offer worker token for accept/start/submit and reject worker_id alone", async () => {
    const quote = await db.createQuote({
      id: "quote_test_mandatory_token",
      task_type_id: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Claim to verify", context: "Context for verifying the claim" },
      quoted_price_usd: 29.0,
      target_payout_usd: 18.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });
    const elenaToken = await db.rotateWorkerOfferToken(taskRes.task_id, "w_elena_fact");

    // accept without token -> 401 WORKER_NOT_AUTHORIZED (capable worker, worker_id only)
    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" })
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });

    await acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken || undefined);

    // start without token -> 401
    await expect(
      startTask(taskRes.task_id, { worker_id: "w_elena_fact" })
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });
    await startTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken || undefined);

    // submit without token -> 401
    await expect(
      submitTaskResult(taskRes.task_id, {
        worker_id: "w_elena_fact",
        result_payload: { verdict: "true", explanation: "Authoritative source verification reasoning.", confidence: 0.98 },
      })
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });
  });

  // 13. Token must match the claimed worker identity (no cross-worker token reuse)
  it("should reject a token that belongs to a different worker offer", async () => {
    const quote = await db.createQuote({
      id: "quote_test_token_mismatch",
      task_type_id: "ARCHITECTURE_SANITY_CHECK",
      input_payload: {
        architecture_summary: "Event-driven pipeline processing ten thousand requests per second",
        components: ["Next.js", "Neon Postgres"],
        expected_scale: "10k rps",
      },
      quoted_price_usd: 69.0,
      target_payout_usd: 45.0,
      estimated_minutes: 60,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskRes = await createTaskFromQuote({ quote_id: quote.id });
    const samToken = await db.rotateWorkerOfferToken(taskRes.task_id, "w_sam_arch");

    // morgan's worker_id + sam's token -> 401
    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_morgan_general" }, samToken || undefined)
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });

    // sam's worker_id + a bogus token -> 401
    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_sam_arch" }, "otk_other_bad")
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });
  });

  // 14. Idempotent task replays must not strand the agent (token rotation on replay)
  it("should return a valid current agent token when a task is replayed; previous token is revoked", async () => {
    const quote = await db.createQuote({
      id: "quote_test_replay",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const created = await createTaskFromQuote({ quote_id: quote.id });
    expect(created.agent_token).toBeTruthy();
    expect(created.is_existing).toBe(false);

    // Replay returns the SAME task with a FRESH valid token
    const replayed = await createTaskFromQuote({ quote_id: quote.id });
    expect(replayed.task_id).toBe(created.task_id);
    expect(replayed.is_existing).toBe(true);
    expect(replayed.agent_token).toBeTruthy();

    // Drive the task to COMPLETED with the replayed token
    const alexToken = await db.rotateWorkerOfferToken(replayed.task_id, "w_alex_ux");
    await acceptTask(replayed.task_id, { worker_id: "w_alex_ux" }, alexToken || undefined);
    await startTask(replayed.task_id, { worker_id: "w_alex_ux" }, alexToken || undefined);
    await submitTaskResult(
      replayed.task_id,
      {
        worker_id: "w_alex_ux",
        result_payload: {
          top_issues: ["Hero copy is generic"],
          highest_impact_change: "Add interactive demo above the fold",
          confidence: 0.94,
        },
      },
      alexToken || undefined
    );

    // The REPLAY token retrieves the result
    const res = await getTaskResult(replayed.task_id, replayed.agent_token);
    expect(res.status).toBe("COMPLETED");

    // The ORIGINAL token was revoked by the replay rotation
    await expect(
      getTaskResult(replayed.task_id, created.agent_token || "")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  // 15. Agent-facing responses never leak worker credentials or target payout
  it("should never serialize worker tokens, worker secrets, or target_payout_usd in agent-facing responses", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com/checkout", target_audience: "B2B SaaS" },
    });
    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id });

    const serializedCreate = JSON.stringify(taskRes);
    expect(serializedCreate).not.toContain("target_payout_usd");
    expect(serializedCreate).not.toContain("worker_token");
    expect(serializedCreate).not.toContain("otk_");

    // worker links must not embed credentials
    for (const offer of taskRes.offers || []) {
      expect(offer.worker_url).not.toContain("token=");
    }

    const agentView = await getTaskState(taskRes.task_id, taskRes.agent_token);
    expect(JSON.stringify(agentView)).not.toContain("target_payout_usd");
    expect(JSON.stringify(agentView)).not.toContain("compensation_usd");

    // worker-authorized view exposes compensation_usd but never the internal field name
    const alexToken = await db.rotateWorkerOfferToken(taskRes.task_id, "w_alex_ux");
    const workerView = await getTaskState(taskRes.task_id, undefined, alexToken || undefined);
    expect(workerView.compensation_usd).toBe(25.0);
    expect(JSON.stringify(workerView)).not.toContain("target_payout_usd");
  });

  // 16. Published result schemas are the single source of truth and match what validation accepts
  it("should publish result_schemas that exactly match the canonical schemas and the Zod validators", async () => {
    const taskTypes = await db.getAllTaskTypes();
    const byCode = new Map(taskTypes.map((t) => [t.code, t.result_schema]));

    for (const code of Object.keys(RESULT_SCHEMAS)) {
      expect(byCode.get(code)).toEqual(RESULT_SCHEMAS[code]);

      // A payload that satisfies the published schema must pass submission validation
      const validSamples: Record<string, Record<string, unknown>> = {
        LANDING_PAGE_REVIEW: {
          top_issues: ["Hero value prop unclear"],
          highest_impact_change: "Add quickstart above the fold",
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
      };
      const valid = validateTaskResult(code, validSamples[code]);
      expect(valid.success, `published-schema-valid payload rejected for ${code}`).toBe(true);

      // A payload violating the published enum/bounds must be rejected
      const invalidSamples: Record<string, Record<string, unknown>> = {
        LANDING_PAGE_REVIEW: {
          top_issues: ["Issue"],
          highest_impact_change: "Change",
          confidence: 2.5, // outside [0,1]
        },
        ARCHITECTURE_SANITY_CHECK: {
          verdict: "unacceptable", // NOT in canonical enum
          recommended_changes: ["Use a transaction pooler"],
          confidence: 0.9,
        },
        EXPERT_FACT_VERIFICATION: {
          verdict: "unverifiable", // NOT in canonical enum
          explanation: "A sufficiently long explanation for the fact check verdict.",
          confidence: 0.9,
        },
      };
      const invalid = validateTaskResult(code, invalidSamples[code]);
      expect(invalid.success, `published-schema-invalid payload accepted for ${code}`).toBe(false);
    }
  });

  // 17. State machine contract (unchanged invariants)
  it("should enforce the canonical OFFERED -> ACCEPTED -> IN_PROGRESS -> COMPLETED machine", () => {
    expect(canTransition("OFFERED", "ACCEPTED")).toBe(true);
    expect(canTransition("ACCEPTED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransition("OFFERED", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(VALID_TRANSITIONS.COMPLETED).toEqual([]);
  });
});

type TaskStateNoComp = { compensation_usd?: unknown };