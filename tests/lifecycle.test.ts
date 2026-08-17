import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { canTransition, VALID_TRANSITIONS } from "../src/lib/state-machine";
import { requestQuote } from "../src/services/quotes";
import { createTaskFromQuote, acceptTask, startTask, submitTaskResult, getTaskResult } from "../src/services/tasks";
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
    // target_payout_usd and margin MUST NOT be exposed
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

    // w_alex_ux has UX_CONVERSION_ANALYSIS, but NOT SYSTEM_ARCHITECTURE
    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_alex_ux" })
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
    const offer1 = taskRes.offers?.find((o) => o.worker_id === "w_sam_arch");
    const offer2 = taskRes.offers?.find((o) => o.worker_id === "w_morgan_general");

    const [res1, res2] = await Promise.allSettled([
      acceptTask(taskRes.task_id, { worker_id: "w_sam_arch" }, offer1?.worker_token),
      acceptTask(taskRes.task_id, { worker_id: "w_morgan_general" }, offer2?.worker_token),
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
    const workerOffer = taskRes.offers?.find((o) => o.worker_id === "w_elena_fact");

    await acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" }, workerOffer?.worker_token);
    await startTask(taskRes.task_id, { worker_id: "w_elena_fact" }, workerOffer?.worker_token);

    const validResult = {
      verdict: "true" as const,
      explanation: "Neon architecture decouples storage and compute allowing instant branching.",
      confidence: 0.99,
    };

    const [sub1, sub2] = await Promise.allSettled([
      submitTaskResult(taskRes.task_id, { worker_id: "w_elena_fact", result_payload: validResult }, workerOffer?.worker_token),
      submitTaskResult(taskRes.task_id, { worker_id: "w_elena_fact", result_payload: validResult }, workerOffer?.worker_token),
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
    const offer = taskRes.offers?.find((o) => o.worker_id === "w_elena_fact");

    await acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" }, offer?.worker_token);
    await startTask(taskRes.task_id, { worker_id: "w_elena_fact" }, offer?.worker_token);
    await submitTaskResult(
      taskRes.task_id,
      {
        worker_id: "w_elena_fact",
        result_payload: { verdict: "true", explanation: "Verified via authoritative records.", confidence: 0.98 },
      },
      offer?.worker_token
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
});
