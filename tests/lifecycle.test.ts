import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { validateTaskInput, validateTaskResult } from "../src/lib/schemas";
import { canTransition, VALID_TRANSITIONS } from "../src/lib/state-machine";
import { verifyTokenHash, hashToken } from "../src/lib/auth";

describe("Sprint 1 P0/P1 Invariants & Security Hardening Tests", () => {
  beforeEach(() => {
    db.resetMemStore();
  });

  // 1. Concurrent Task Creation from Same Quote (Idempotency & Database Unique Constraint)
  it("should return the exact same task when creating concurrently from the same quote", async () => {
    const quote = await db.createQuote({
      id: "quote_test_idempotent",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "B2B SaaS" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    // Fire 5 concurrent creation requests for the SAME quote
    const results = await Promise.all([
      db.createTask({ id: "task_idem_1", quote_id: quote.id, task_type_id: quote.task_type_id, input_payload: quote.input_payload }),
      db.createTask({ id: "task_idem_2", quote_id: quote.id, task_type_id: quote.task_type_id, input_payload: quote.input_payload }),
      db.createTask({ id: "task_idem_3", quote_id: quote.id, task_type_id: quote.task_type_id, input_payload: quote.input_payload }),
      db.createTask({ id: "task_idem_4", quote_id: quote.id, task_type_id: quote.task_type_id, input_payload: quote.input_payload }),
      db.createTask({ id: "task_idem_5", quote_id: quote.id, task_type_id: quote.task_type_id, input_payload: quote.input_payload }),
    ]);

    // Exactly one created, others returned existing
    const uniqueTaskIds = new Set(results.map((r) => r.task.id));
    expect(uniqueTaskIds.size).toBe(1);
    const existingFlags = results.map((r) => r.is_existing);
    expect(existingFlags.filter((f) => f === false)).toHaveLength(1);
    expect(existingFlags.filter((f) => f === true)).toHaveLength(4);
  });

  // 2. Incapable Worker Acceptance Enforcement (403 Forbidden)
  it("should reject task acceptance with 403 when worker lacks verified capability", async () => {
    const quote = await db.createQuote({
      id: "quote_test_capability",
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

    const createRes = await db.createTask({
      id: "task_test_capability",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    // w_alex_ux has UX_CONVERSION_ANALYSIS, but NOT SYSTEM_ARCHITECTURE
    const acceptRes = await db.acceptTask(createRes.task.id, "w_alex_ux");
    expect(acceptRes.success).toBe(false);
    expect(acceptRes.code).toBe(403);
    expect(acceptRes.error).toContain("does not possess the required verified capability");
  });

  // 3. Concurrent Task Acceptance (Exactly One 200, One 409)
  it("should allow exactly one worker to accept concurrently, returning 409 to the loser", async () => {
    const quote = await db.createQuote({
      id: "quote_test_race_accept",
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

    const createRes = await db.createTask({
      id: "task_test_race_accept",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    // Both w_sam_arch and w_morgan_general have SYSTEM_ARCHITECTURE capability
    const offer1 = createRes.offers.find((o) => o.worker_id === "w_sam_arch");
    const offer2 = createRes.offers.find((o) => o.worker_id === "w_morgan_general");

    const [res1, res2] = await Promise.all([
      db.acceptTask(createRes.task.id, "w_sam_arch", offer1?.worker_token),
      db.acceptTask(createRes.task.id, "w_morgan_general", offer2?.worker_token),
    ]);

    const successes = [res1, res2].filter((r) => r.success);
    const conflicts = [res1, res2].filter((r) => !r.success && r.code === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].error).toContain("already accepted by another worker");
  });

  // 4. Concurrent Duplicate Submissions (One Success, One 409, Never 500)
  it("should handle concurrent result submissions atomically: exactly one success, other returns 409", async () => {
    const quote = await db.createQuote({
      id: "quote_test_race_submit",
      task_type_id: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Neon supports branching in Postgres", context: "Documentation check" },
      quoted_price_usd: 29.0,
      target_payout_usd: 18.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_test_race_submit",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    const workerOffer = createRes.offers.find((o) => o.worker_id === "w_elena_fact");
    await db.acceptTask(createRes.task.id, "w_elena_fact", workerOffer?.worker_token);
    await db.startTask(createRes.task.id, "w_elena_fact", workerOffer?.worker_token);

    const validResult = {
      verdict: "true" as const,
      explanation: "Neon architecture decouples storage and compute allowing instant branching.",
      confidence: 0.99,
    };

    // 2 concurrent submissions
    const [sub1, sub2] = await Promise.all([
      db.submitTaskResult({
        id: "res_race_1",
        taskId: createRes.task.id,
        workerId: "w_elena_fact",
        workerToken: workerOffer?.worker_token,
        resultPayload: validResult,
      }),
      db.submitTaskResult({
        id: "res_race_2",
        taskId: createRes.task.id,
        workerId: "w_elena_fact",
        workerToken: workerOffer?.worker_token,
        resultPayload: validResult,
      }),
    ]);

    const successes = [sub1, sub2].filter((s) => s.success);
    const conflicts = [sub1, sub2].filter((s) => !s.success && s.code === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].error).toContain("already submitted");
  });

  // 5. State Machine Invariants
  it("should strictly enforce valid transitions and reject illegal jumps", () => {
    // Valid transitions
    expect(canTransition("OFFERED", "ACCEPTED")).toBe(true);
    expect(canTransition("ACCEPTED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);

    // Illegal jumps
    expect(canTransition("OFFERED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("OFFERED", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("COMPLETED", "ACCEPTED")).toBe(false);
    expect(canTransition("CANCELLED", "ACCEPTED")).toBe(false);

    // Declared transitions match state definitions
    expect(VALID_TRANSITIONS.OFFERED).toEqual(["ACCEPTED", "CANCELLED", "EXPIRED"]);
    expect(VALID_TRANSITIONS.ACCEPTED).toEqual(["IN_PROGRESS", "CANCELLED", "FAILED"]);
    expect(VALID_TRANSITIONS.IN_PROGRESS).toEqual(["COMPLETED", "CANCELLED", "FAILED"]);
    expect(VALID_TRANSITIONS.COMPLETED).toEqual([]);
  });

  // 6. task_offers Row Persisted for Every Offered Worker
  it("should persist one task_offers row with unguessable token hash per qualified worker", async () => {
    const quote = await db.createQuote({
      id: "quote_test_offers_count",
      task_type_id: "ARCHITECTURE_SANITY_CHECK",
      input_payload: { architecture_summary: "Test architecture description for verification", components: ["App"], expected_scale: "10k" },
      quoted_price_usd: 69.0,
      target_payout_usd: 45.0,
      estimated_minutes: 60,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_test_offers_count",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    // Qualified workers for SYSTEM_ARCHITECTURE: w_sam_arch, w_morgan_general
    const qualified = await db.getWorkersByCapability("SYSTEM_ARCHITECTURE");
    expect(createRes.offers).toHaveLength(qualified.length);

    const persistedOffers = await db.getOffersForTask(createRes.task.id);
    expect(persistedOffers).toHaveLength(qualified.length);

    // Verify token hash is stored
    for (const offer of persistedOffers) {
      expect(offer.worker_token_hash).toBeDefined();
      expect(offer.worker_token_hash.length).toBe(64); // SHA-256 hex
    }
  });

  // 7. Worker Offer Token Authorization Boundary
  it("should reject worker mutation when worker offer token is invalid or missing", async () => {
    const quote = await db.createQuote({
      id: "quote_test_worker_auth",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "B2B SaaS" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_test_worker_auth",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    // Reject invalid token on accept
    const badAccept = await db.acceptTask(createRes.task.id, "w_alex_ux", "invalid_worker_token_xyz");
    expect(badAccept.success).toBe(false);
    expect(badAccept.code).toBe(401);

    // Valid accept
    const validOffer = createRes.offers.find((o) => o.worker_id === "w_alex_ux");
    const goodAccept = await db.acceptTask(createRes.task.id, "w_alex_ux", validOffer?.worker_token);
    expect(goodAccept.success).toBe(true);

    // Reject invalid token on start
    const badStart = await db.startTask(createRes.task.id, "w_alex_ux", "wrong_token");
    expect(badStart.success).toBe(false);
    expect(badStart.code).toBe(401);

    // Reject invalid token on submit
    const badSubmit = await db.submitTaskResult({
      id: "res_bad_tok",
      taskId: createRes.task.id,
      workerId: "w_alex_ux",
      workerToken: "wrong_token",
      resultPayload: {
        top_issues: ["Issue 1"],
        highest_impact_change: "Change 1",
        confidence: 0.9,
      },
    });
    expect(badSubmit.success).toBe(false);
    expect(badSubmit.code).toBe(401);
  });

  // 8. Agent Task Token Authorization Boundary
  it("should verify unguessable agent token hash and reject unauthorized result access", async () => {
    const quote = await db.createQuote({
      id: "quote_test_agent_auth",
      task_type_id: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Verifiable fact check claim", context: "Context check" },
      quoted_price_usd: 29.0,
      target_payout_usd: 18.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_test_agent_auth",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    expect(createRes.agent_token).toMatch(/^atk_/);

    // Verify token hash verification
    const isValid = await db.verifyAgentToken(createRes.task.id, createRes.agent_token);
    expect(isValid).toBe(true);

    const isFakeValid = await db.verifyAgentToken(createRes.task.id, "atk_fake_invalid_token_123");
    expect(isFakeValid).toBe(false);
  });
});
