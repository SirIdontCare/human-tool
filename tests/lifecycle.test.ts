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

describe("Sprint 1.2 Pre-MCP Security Patch Verification Suite", () => {
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

  // 2. Quote Response Sanitization (No Target Payout, no Margin)
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

  // 3. Quote-scoped agent capability: token minted once, hash-only storage
  it("should mint a high-entropy agent token at quote creation and store ONLY its hash", async () => {
    const quoteRes = await requestQuote({
      task_type: "ARCHITECTURE_SANITY_CHECK",
      input_payload: {
        architecture_summary: "Multi-tenant Kubernetes deployment with transactional pooling",
        components: ["Kubernetes", "PostgreSQL"],
        expected_scale: "10k rps",
      },
    });

    expect(quoteRes.agent_token).toMatch(/^atk_/);
    expect(quoteRes.agent_token.length).toBeGreaterThan(24);

    // Raw token is NEVER stored: the quote row holds only the SHA-256 hash.
    const quote = await db.getQuote(quoteRes.quote_id);
    expect(quote?.agent_token_hash).toBeTruthy();
    expect(quote?.agent_token_hash).not.toBe(quoteRes.agent_token);
    expect(quote?.agent_token_hash).toMatch(/^[0-9a-f]{64}$/);

    // Raw token is NEVER logged in lifecycle events.
    const events = await db.getEvents(quoteRes.quote_id);
    expect(events.length).toBeGreaterThan(0);
    for (const evt of events) {
      expect(JSON.stringify(evt.payload)).not.toContain(quoteRes.agent_token);
    }
  });

  // 4. Expired Quote Rejection (with a valid quote-scoped token)
  it("should reject expired quotes with stable error code QUOTE_EXPIRED", async () => {
    const created = await db.createQuote({
      id: "quote_expired_test",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() - 5000).toISOString(), // expired 5 seconds ago
    });

    await expect(createTaskFromQuote({ quote_id: created.quote.id }, "", created.agent_token)).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
      status: 400,
    });
  });

  // 5. Task creation requires the quote-scoped agent token
  it("should require the quote-scoped agent token for task creation (401 without / with wrong token)", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
    });

    // No token -> 401 UNAUTHORIZED
    await expect(createTaskFromQuote({ quote_id: quoteRes.quote_id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    // Wrong token -> 401 UNAUTHORIZED
    await expect(
      createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", "atk_wrong_token")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    // Correct token -> creates the task, and the task inherits the quote hash
    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);
    expect(taskRes.is_existing).toBe(false);
    const task = await db.getTask(taskRes.task_id);
    const quote = await db.getQuote(quoteRes.quote_id);
    expect(task?.agent_token_hash).toBe(quote?.agent_token_hash);
  });

  // 6. Concurrent Duplicate Task Creation: exactly one task, no rotation
  it("should return the exact same task when creating concurrently from the same quote", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "B2B SaaS" },
    });

    const results = await Promise.all([
      createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token),
      createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token),
      createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token),
    ]);

    const uniqueTaskIds = new Set(results.map((r) => r.task_id));
    expect(uniqueTaskIds.size).toBe(1);
    expect(results.filter((r) => !r.is_existing)).toHaveLength(1);
    expect(results.filter((r) => r.is_existing)).toHaveLength(2);
  });

  // 7. Replay semantics: quote_id alone can never replay; valid replays are stable
  it("should reject quote-id-only replays and keep the original token valid on valid replays", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
    });

    const taskRes1 = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    // quote_id alone -> 401, can never mint or revoke a credential
    await expect(createTaskFromQuote({ quote_id: quoteRes.quote_id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    // Valid replay -> same task, is_existing=true, NO rotation, token still valid
    const taskRes2 = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);
    expect(taskRes2.task_id).toBe(taskRes1.task_id);
    expect(taskRes2.is_existing).toBe(true);

    const task = await db.getTask(taskRes1.task_id);
    const quote = await db.getQuote(quoteRes.quote_id);
    expect(task?.agent_token_hash).toBe(quote?.agent_token_hash);
    expect(await db.verifyAgentToken(taskRes1.task_id, quoteRes.agent_token)).toBe(true);
  });

  // 8. Concurrent valid replays remain stable (no rotation race)
  it("should keep the original token valid across 3 concurrent valid replays", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
    });
    await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    const replays = await Promise.all([
      createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token),
      createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token),
      createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token),
    ]);
    expect(new Set(replays.map((r) => r.task_id)).size).toBe(1);
    expect(replays.every((r) => r.is_existing)).toBe(true);

    const view = await getTaskState(replays[0].task_id, quoteRes.agent_token);
    expect(view.status).toBe("OFFERED");
  });

  // 9. Attacker holding only quote_id cannot read the paid result
  it("should never let a quote-id-only attacker mint credentials or read results", async () => {
    const quoteRes = await requestQuote({
      task_type: "ARCHITECTURE_SANITY_CHECK",
      input_payload: {
        architecture_summary: "Confidential unlaunched multi-region ledger design",
        components: ["Neon"],
        expected_scale: "50k rps",
      },
    });
    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    // Complete the full lifecycle for the legitimate agent
    const samIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_sam_arch");
    expect(samIssue.success).toBe(true);
    const samToken = samIssue.token!;
    await acceptTask(taskRes.task_id, { worker_id: "w_sam_arch" }, samToken);
    await startTask(taskRes.task_id, { worker_id: "w_sam_arch" }, samToken);
    await submitTaskResult(
      taskRes.task_id,
      {
        worker_id: "w_sam_arch",
        result_payload: {
          verdict: "acceptable",
          recommendation: undefined,
          recommended_changes: ["Use a connection pooler"],
          confidence: 0.9,
        } as any,
      },
      samToken
    );

    // Attacker knows ONLY the quote_id (no token): replay -> 401, never a credential
    await expect(createTaskFromQuote({ quote_id: quoteRes.quote_id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    // A forged token labelled as agent fails closed
    await expect(getTaskResult(taskRes.task_id, "atk_attacker_mint")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    // Legitimate original token still reads the paid result
    const result = await getTaskResult(taskRes.task_id, quoteRes.agent_token);
    expect(result.status).toBe("COMPLETED");
  });

  // 10. Incapable Worker Acceptance (403 ONLY after authentication, and only
  //     after a verified token proves identity; capability revocation after
  //     offer issuance is the realistic path that still hits the gate)
  it("should reject task acceptance with 403 WORKER_CAPABILITY_REQUIRED when the worker's required capability was revoked after offer issuance", async () => {
    const quoteRes = await requestQuote({
      task_type: "ARCHITECTURE_SANITY_CHECK", // requires SYSTEM_ARCHITECTURE
      input_payload: {
        architecture_summary: "Multi-tenant Kubernetes deployment",
        components: ["Kubernetes", "PostgreSQL"],
        expected_scale: "10k rps",
      },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);
    const samIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_sam_arch");
    expect(samIssue.success).toBe(true);
    const samToken = samIssue.token!;

    // w_sam_arch held a verified SYSTEM_ARCHITECTURE capability when the offer
    // was issued, but it is REVOKED before acceptance. The capability gate is
    // evaluated only AFTER authentication (valid offer token), so the worker
    // is rejected with 403, never leaking worker state to unauthenticated callers.
    expect(await db.setWorkerCapabilityStatus("w_sam_arch", "SYSTEM_ARCHITECTURE", "REVOKED")).toBe(true);

    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_sam_arch" }, samToken)
    ).rejects.toMatchObject({
      code: "WORKER_CAPABILITY_REQUIRED",
      status: 403,
    });
  });

  // 11. Auth ordering: an unauthenticated caller cannot enumerate anything
  it("should return uniform 401 for unauthenticated accepts regardless of worker existence, capability, or offer state", async () => {
    const quoteRes = await requestQuote({
      task_type: "ARCHITECTURE_SANITY_CHECK",
      input_payload: {
        architecture_summary: "Distributed system on Neon Postgres",
        components: ["Next.js", "Neon Postgres"],
        expected_scale: "50k rps",
      },
    });
    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    for (const wid of ["w_does_not_exist", "w_alex_ux", "w_sam_arch"]) {
      await expect(acceptTask(taskRes.task_id, { worker_id: wid })).rejects.toMatchObject({
        code: "WORKER_NOT_AUTHORIZED",
        status: 401,
      });
    }
  });

  // 12. Concurrent Task Acceptance (Exactly One Winner)
  it("should allow exactly one worker to accept concurrently, returning TASK_ALREADY_ACCEPTED to loser", async () => {
    const quoteRes = await requestQuote({
      task_type: "ARCHITECTURE_SANITY_CHECK",
      input_payload: {
        architecture_summary: "Distributed system on Neon Postgres",
        components: ["Next.js", "Neon Postgres"],
        expected_scale: "50k rps",
      },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);
    const issue1 = await db.issueWorkerOfferToken(taskRes.task_id, "w_sam_arch");
    const issue2 = await db.issueWorkerOfferToken(taskRes.task_id, "w_morgan_general");
    expect(issue1.success).toBe(true);
    expect(issue2.success).toBe(true);

    const [res1, res2] = await Promise.allSettled([
      acceptTask(taskRes.task_id, { worker_id: "w_sam_arch" }, issue1.token),
      acceptTask(taskRes.task_id, { worker_id: "w_morgan_general" }, issue2.token),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
    const rejected = [res1, res2].filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe("TASK_ALREADY_ACCEPTED");
    expect(rejected[0].reason.status).toBe(409);
  });

  // 13. Concurrent Duplicate Result Submissions (Atomic Single Transaction)
  it("should handle concurrent submissions atomically: exactly one success, other returns 409 RESULT_ALREADY_SUBMITTED", async () => {
    const quoteRes = await requestQuote({
      task_type: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Neon supports branching in Postgres", context: "Documentation check" },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);
    const elenaIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_elena_fact");
    expect(elenaIssue.success).toBe(true);
    const elenaToken = elenaIssue.token!;

    await acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken);
    await startTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken);

    const validResult = {
      verdict: "true" as const,
      explanation: "Neon architecture decouples storage and compute allowing instant branching.",
      confidence: 0.99,
    };

    const [sub1, sub2] = await Promise.allSettled([
      submitTaskResult(taskRes.task_id, { worker_id: "w_elena_fact", result_payload: validResult }, elenaToken),
      submitTaskResult(taskRes.task_id, { worker_id: "w_elena_fact", result_payload: validResult }, elenaToken),
    ]);

    const fulfilled = [sub1, sub2].filter((s) => s.status === "fulfilled");
    const rejected = [sub1, sub2].filter((s) => s.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe("RESULT_ALREADY_SUBMITTED");
    expect(rejected[0].reason.status).toBe(409);
  });

  // 14. Result Retrieval Guard Before Completion (RESULT_NOT_READY)
  it("should reject result retrieval before task completion with RESULT_NOT_READY", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    await expect(
      getTaskResult(taskRes.task_id, quoteRes.agent_token)
    ).rejects.toMatchObject({
      code: "RESULT_NOT_READY",
      status: 400,
    });
  });

  // 15. Agent Token Authorization Boundary on Results
  it("should reject result access with UNAUTHORIZED when agent token is missing or invalid", async () => {
    const quoteRes = await requestQuote({
      task_type: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Verifiable fact check claim", context: "Context check" },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);
    const elenaIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_elena_fact");
    expect(elenaIssue.success).toBe(true);
    const elenaToken = elenaIssue.token!;

    await acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken);
    await startTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken);
    await submitTaskResult(
      taskRes.task_id,
      {
        worker_id: "w_elena_fact",
        result_payload: { verdict: "true", explanation: "Verified via authoritative records.", confidence: 0.98 },
      },
      elenaToken
    );

    // Reject with invalid token
    await expect(
      getTaskResult(taskRes.task_id, "atk_invalid_token_123")
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    // Accept with the quote-scoped agent token
    const result = await getTaskResult(taskRes.task_id, quoteRes.agent_token);
    expect(result.status).toBe("COMPLETED");
    expect((result.result as any).verdict).toBe("true");
  });

  // 16. Fail-Closed Task View Authorization
  it("should require a valid agent or worker token for task state and expose compensation only to authenticated workers", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    await expect(getTaskState(taskRes.task_id)).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(getTaskState(taskRes.task_id, "atk_bad")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(getTaskState(taskRes.task_id, undefined, "otk_bad")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    // Agent view: no compensation_usd, never target_payout_usd
    const agentView = await getTaskState(taskRes.task_id, quoteRes.agent_token);
    expect(agentView.status).toBe("OFFERED");
    expect((agentView as TaskStateNoComp).compensation_usd).toBeUndefined();
    expect(JSON.stringify(agentView)).not.toContain("target_payout_usd");

    // Worker view (delivered offer credential): worker-only compensation_usd
    const alexIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux");
    expect(alexIssue.success).toBe(true);
    const workerView = await getTaskState(taskRes.task_id, undefined, alexIssue.token);
    expect(workerView.compensation_usd).toBe(25.0);
    expect(JSON.stringify(workerView)).not.toContain("target_payout_usd");
  });

  // 17. Fail-Closed Agent Auth: missing stored agent hash is always UNAUTHORIZED
  it("should fail closed with UNAUTHORIZED when the stored agent_token_hash is missing", async () => {
    const quoteRes = await requestQuote({
      task_type: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Check claim", context: "Context for checking the claim" },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    // Simulate pre-migration drift: stored hash missing
    expect(await db.setAgentTokenHash(taskRes.task_id, null)).toBe(true);

    await expect(
      getTaskState(taskRes.task_id, "atk_whatever")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(
      getTaskResult(taskRes.task_id, "atk_whatever")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    // Worker access via a valid offer token still works (worker auth is independent)
    const elenaIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_elena_fact");
    expect(elenaIssue.success).toBe(true);
    const workerView = await getTaskState(taskRes.task_id, undefined, elenaIssue.token);
    expect(workerView.compensation_usd).toBe(18.0);
  });

  // 18. Worker tokens are MANDATORY for accept/start/submit (no worker_id fallback)
  it("should require the per-offer worker token for accept/start/submit and reject worker_id alone", async () => {
    const quoteRes = await requestQuote({
      task_type: "EXPERT_FACT_VERIFICATION",
      input_payload: { claim: "Claim to verify", context: "Context for verifying the claim" },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    // accept without token -> 401 WORKER_NOT_AUTHORIZED (worker_id only)
    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" })
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });

    const elenaIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_elena_fact");
    expect(elenaIssue.success).toBe(true);
    const elenaToken = elenaIssue.token!;

    await acceptTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken);

    // start without token -> 401
    await expect(
      startTask(taskRes.task_id, { worker_id: "w_elena_fact" })
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });
    await startTask(taskRes.task_id, { worker_id: "w_elena_fact" }, elenaToken);

    // submit without token -> 401
    await expect(
      submitTaskResult(taskRes.task_id, {
        worker_id: "w_elena_fact",
        result_payload: { verdict: "true", explanation: "Authoritative source verification reasoning.", confidence: 0.98 },
      })
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });
  });

  // 19. Token must match the claimed worker identity (no cross-worker token reuse)
  it("should reject a token that belongs to a different worker offer", async () => {
    const quoteRes = await requestQuote({
      task_type: "ARCHITECTURE_SANITY_CHECK",
      input_payload: {
        architecture_summary: "Event-driven pipeline processing ten thousand requests per second",
        components: ["Next.js", "Neon Postgres"],
        expected_scale: "10k rps",
      },
    });

    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);
    const samIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_sam_arch");
    expect(samIssue.success).toBe(true);
    const samToken = samIssue.token!;

    // morgan's worker_id + sam's token -> 401 (identity comes from the token)
    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_morgan_general" }, samToken)
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });

    // sam's worker_id + a bogus token -> 401
    await expect(
      acceptTask(taskRes.task_id, { worker_id: "w_sam_arch" }, "otk_other_bad")
    ).rejects.toMatchObject({ code: "WORKER_NOT_AUTHORIZED", status: 401 });
  });

  // 20. Worker token issuance: first-issue succeeds, repeats fail safe, rotate=1 rotates
  it("should issue worker tokens once, refuse repeats without rotation, and rotate only explicitly", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
    });
    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    // First issuance -> fresh token usable immediately
    const first = await db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux");
    expect(first.success).toBe(true);
    expect(first.token).toMatch(/^otk_/);
    const firstToken = first.token!;
    expect(await db.verifyWorkerToken(taskRes.task_id, "w_alex_ux", firstToken)).toBe(true);

    // Repeat without rotate=1 -> 409 INVALID_STATE, delivered token unaffected
    const repeat = await db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux");
    expect(repeat.success).toBe(false);
    expect(repeat.code).toBe(409);
    expect(await db.verifyWorkerToken(taskRes.task_id, "w_alex_ux", firstToken)).toBe(true);

    // Explicit rotate=1 -> fresh token, old token revoked
    const rotated = await db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux", { rotate: true });
    expect(rotated.success).toBe(true);
    expect(rotated.token).not.toBe(firstToken);
    expect(await db.verifyWorkerToken(taskRes.task_id, "w_alex_ux", firstToken)).toBe(false);
    expect(await db.verifyWorkerToken(taskRes.task_id, "w_alex_ux", rotated.token!)).toBe(true);
  });

  // 21. Issuance must never strand an engaged worker (rotate blocked on ACCEPTED/IN_PROGRESS)
  it("should refuse token issuance/rotation for ACCEPTED or IN_PROGRESS tasks", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
    });
    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    const issue = await db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux");
    expect(issue.success).toBe(true);
    const token = issue.token!;

    await acceptTask(taskRes.task_id, { worker_id: "w_alex_ux" }, token);
    await startTask(taskRes.task_id, { worker_id: "w_alex_ux" }, token);

    const rotateEngaged = await db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux", { rotate: true });
    expect(rotateEngaged.success).toBe(false);
    expect(rotateEngaged.code).toBe(409);

    // The engaged worker's credential must remain usable
    expect(await db.verifyWorkerToken(taskRes.task_id, "w_alex_ux", token)).toBe(true);
  });

  // 22. Concurrent first issuance yields exactly one success
  it("should yield exactly one success for concurrent first issuance", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
    });
    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    const results = await Promise.allSettled([
      db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux"),
      db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux"),
    ]);
    const successes = results.filter(
      (r) => r.status === "fulfilled" && (r.value as { success: boolean }).success === true
    );
    expect(successes).toHaveLength(1);

    // Exactly one delivered token is usable
    const issuedTokens = results
      .map((r) => (r.status === "fulfilled" ? (r.value as { token?: string }).token : undefined))
      .filter((t): t is string => Boolean(t));
    const usable = issuedTokens.filter((t) => db.verifyWorkerToken(taskRes.task_id, "w_alex_ux", t));
    expect(await Promise.all(usable)).toHaveLength(1);
  });

  // 23. Agent-facing responses never leak worker credentials or target payout
  it("should never serialize worker tokens, worker secrets, or target_payout_usd in agent-facing responses", async () => {
    const quoteRes = await requestQuote({
      task_type: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com/checkout", target_audience: "B2B SaaS" },
    });
    const taskRes = await createTaskFromQuote({ quote_id: quoteRes.quote_id }, "", quoteRes.agent_token);

    const serializedCreate = JSON.stringify(taskRes);
    expect(serializedCreate).not.toContain("target_payout_usd");
    expect(serializedCreate).not.toContain("worker_token");
    expect(serializedCreate).not.toContain("otk_");
    expect(serializedCreate).not.toContain(quoteRes.agent_token);

    // worker links must not embed credentials
    for (const offer of taskRes.offers || []) {
      expect(offer.worker_url).not.toContain("token=");
    }

    const agentView = await getTaskState(taskRes.task_id, quoteRes.agent_token);
    expect(JSON.stringify(agentView)).not.toContain("target_payout_usd");
    expect(JSON.stringify(agentView)).not.toContain("compensation_usd");

    // worker-authorized view exposes compensation_usd but never the internal field name
    const alexIssue = await db.issueWorkerOfferToken(taskRes.task_id, "w_alex_ux");
    expect(alexIssue.success).toBe(true);
    const workerView = await getTaskState(taskRes.task_id, undefined, alexIssue.token);
    expect(workerView.compensation_usd).toBe(25.0);
    expect(JSON.stringify(workerView)).not.toContain("target_payout_usd");
  });

  // 24. Published result schemas are the single source of truth and match submission validation
  it("should publish result_schemas whose constraints exactly mirror the Zod submission validators", async () => {
    const taskTypes = await db.getAllTaskTypes();
    const byCode = new Map(taskTypes.map((t) => [t.code, t.result_schema]));

    for (const code of Object.keys(RESULT_SCHEMAS)) {
      // DB-served schema equals the canonical contract
      expect(byCode.get(code)).toEqual(RESULT_SCHEMAS[code]);

      // Schema-valid samples MUST pass the real submission validator
      const validSamples: Record<string, Record<string, unknown>> = {
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
      };
      const valid = validateTaskResult(code, validSamples[code]);
      expect(valid.success, `published-schema-valid payload rejected for ${code}`).toBe(true);

      // Constraint violations encoded in the published schema MUST be rejected by the validator
      const schema = RESULT_SCHEMAS[code];
      const props = schema.properties as Record<string, any>;
      const violationSamples: Record<string, Record<string, unknown>[]> = {
        LANDING_PAGE_REVIEW: [
          { top_issues: [], confidence: 0.95 }, // minItems 3 / missing fields
          {
            top_issues: [
              { issue: "Too short", evidence: "Short evidence", why_it_matters: "Short why", recommended_change: "Short rec", severity: "high" },
              { issue: "Too short", evidence: "Short evidence", why_it_matters: "Short why", recommended_change: "Short rec", severity: "high" },
              { issue: "Too short", evidence: "Short evidence", why_it_matters: "Short why", recommended_change: "Short rec", severity: "high" },
            ],
            confidence: 0.95,
          }, // minLength violations & missing highest_impact_change
          {
            top_issues: [
              { issue: "Issue description one", evidence: "Evidence description one", why_it_matters: "Why it matters one", recommended_change: "Recommended change one", severity: "invalid_severity" },
              { issue: "Issue description two", evidence: "Evidence description two", why_it_matters: "Why it matters two", recommended_change: "Recommended change two", severity: "medium" },
              { issue: "Issue description three", evidence: "Evidence description three", why_it_matters: "Why it matters three", recommended_change: "Recommended change three", severity: "low" },
            ],
            confidence: 0.95,
          }, // enum violation on severity
          {
            top_issues: [
              { issue: "Issue description one", evidence: "Evidence description one", why_it_matters: "Why it matters one", recommended_change: "Recommended change one", severity: "high" },
              { issue: "Issue description two", evidence: "Evidence description two", why_it_matters: "Why it matters two", recommended_change: "Recommended change two", severity: "medium" },
            ],
            confidence: 0.95,
          }, // exactly 3 required (2 provided)
        ],
        ARCHITECTURE_SANITY_CHECK: [
          { verdict: "unacceptable", recommended_changes: ["Use a transaction pooler"], confidence: 0.9 }, // enum
          { verdict: "acceptable", recommended_changes: [], confidence: 0.9 }, // minItems 1
          { verdict: "acceptable", recommended_changes: [""], confidence: 0.9 }, // item minLength 1
          { verdict: "acceptable", recommended_changes: ["Use a transaction pooler"], confidence: -0.2 }, // minimum 0
        ],
        EXPERT_FACT_VERIFICATION: [
          { verdict: "unverifiable", explanation: "A sufficiently long explanation for the fact check verdict.", confidence: 0.9 }, // enum
          { verdict: "true", explanation: "Too short", confidence: 0.9 }, // minLength 10
          { verdict: "true", explanation: "A sufficiently long explanation for the fact check verdict.", confidence: 2.0 }, // maximum 1
        ],
      };
      for (const [i, sample] of (violationSamples[code] || []).entries()) {
        const invalid = validateTaskResult(code, sample);
        expect(invalid.success, `constraint violation ${i} accepted for ${code}`).toBe(false);
      }
    }
  });

  // 25. State machine contract (unchanged invariants)
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