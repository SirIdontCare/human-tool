import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { validateTaskInput, validateTaskResult } from "../src/lib/schemas";
import { canTransition } from "../src/lib/state-machine";

describe("Sprint 1: Human-Tool Core Lifecycle & Invariants", () => {
  beforeEach(() => {
    db.resetMemStore();
  });

  // 1. Task Lifecycle Happy Path
  it("should complete the full happy path: Quote -> Task -> Accept -> Start -> Submit -> Result", async () => {
    // Step 1: Agent requests Quote
    const quotePayload = {
      url: "https://agentflow.dev",
      target_audience: "Autonomous AI agent developers and founders",
      specific_goals: "Increase API key generation and sandbox retention",
    };

    const taskType = await db.getTaskType("LANDING_PAGE_REVIEW");
    expect(taskType).toBeDefined();
    expect(taskType?.customer_price_usd).toBe(39.0);
    expect(taskType?.target_payout_usd).toBe(25.0);

    const inputValidation = validateTaskInput("LANDING_PAGE_REVIEW", quotePayload);
    expect(inputValidation.success).toBe(true);

    const quoteId = "quote_test_happy_path";
    const quote = await db.createQuote({
      id: quoteId,
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: quotePayload,
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    expect(quote.id).toBe(quoteId);

    // Step 2: Agent creates Task from Quote
    const taskId = "task_test_happy_path";
    const task = await db.createTask({
      id: taskId,
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });
    expect(task.id).toBe(taskId);
    expect(task.status).toBe("OFFERED");
    expect(task.assigned_worker_id).toBeNull();

    // Step 3: Human Worker accepts Task
    const workerId = "w_alex_ux";
    const acceptRes = await db.acceptTask(taskId, workerId);
    expect(acceptRes.success).toBe(true);
    expect(acceptRes.task?.status).toBe("ACCEPTED");
    expect(acceptRes.task?.assigned_worker_id).toBe(workerId);

    // Step 4: Worker starts Task
    const startRes = await db.startTask(taskId, workerId);
    expect(startRes.success).toBe(true);
    expect(startRes.task?.status).toBe("IN_PROGRESS");

    // Step 5: Worker submits validated structured result
    const resultPayload = {
      top_issues: [
        "Hero headline lacks immediate value proposition for agent developers",
        "Code sample is missing TypeScript type declarations",
        "API pricing tier limits are ambiguous on free tier",
      ],
      highest_impact_change: "Add an interactive 3-line curl/SDK quickstart directly above the fold",
      conversion_blockers: [
        "Sign up requires email verification before accessing API keys",
      ],
      confidence: 0.95,
    };

    const resultValidation = validateTaskResult("LANDING_PAGE_REVIEW", resultPayload);
    expect(resultValidation.success).toBe(true);

    const submitRes = await db.submitTaskResult({
      id: "res_test_happy_path",
      taskId,
      workerId,
      resultPayload,
    });
    expect(submitRes.success).toBe(true);
    expect(submitRes.task?.status).toBe("COMPLETED");

    // Step 6: Agent retrieves result
    const storedResult = await db.getTaskResult(taskId);
    expect(storedResult).toBeDefined();
    expect(storedResult?.result_payload).toEqual(resultPayload);
    expect(storedResult?.worker_id).toBe(workerId);
  });

  // 2. Invalid State Transitions
  it("should enforce the state machine and reject invalid state transitions", async () => {
    expect(canTransition("CREATED", "ACCEPTED")).toBe(true);
    expect(canTransition("OFFERED", "ACCEPTED")).toBe(true);
    expect(canTransition("ACCEPTED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "COMPLETED")).toBe(true);

    // Invalid jumps
    expect(canTransition("CREATED", "SUBMITTED")).toBe(false);
    expect(canTransition("CREATED", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("COMPLETED", "ACCEPTED")).toBe(false);
    expect(canTransition("CANCELLED", "ACCEPTED")).toBe(false);
  });

  // 3. Concurrency / Two Workers Accepting Same Task
  it("should prevent race conditions when two workers attempt to accept the same task", async () => {
    const quote = await db.createQuote({
      id: "quote_race_test",
      task_type_id: "ARCHITECTURE_SANITY_CHECK",
      input_payload: {
        architecture_summary: "Multi-tenant PostgreSQL on Neon with connection pooling",
        components: ["Next.js", "Neon Postgres", "Redis Cache"],
        expected_scale: "10k requests per second",
      },
      quoted_price_usd: 69.0,
      target_payout_usd: 45.0,
      estimated_minutes: 60,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const task = await db.createTask({
      id: "task_race_test",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    // Worker 1 accepts
    const res1 = await db.acceptTask(task.id, "w_sam_arch");
    expect(res1.success).toBe(true);
    expect(res1.task?.assigned_worker_id).toBe("w_sam_arch");

    // Worker 2 attempts to accept the same task
    const res2 = await db.acceptTask(task.id, "w_morgan_general");
    expect(res2.success).toBe(false);
    expect(res2.code).toBe(409);
    expect(res2.error).toContain("already accepted by another worker");
  });

  // 4. Malformed Result Payload
  it("should reject malformed result payloads that do not adhere to task type schema", () => {
    // Malformed Landing Page Review: missing highest_impact_change and confidence out of bounds
    const badLandingPageResult = {
      top_issues: ["Color scheme is dull"],
      confidence: 1.5, // invalid: max is 1.0
    };
    const val1 = validateTaskResult("LANDING_PAGE_REVIEW", badLandingPageResult);
    expect(val1.success).toBe(false);

    // Malformed Architecture Review: invalid verdict enum
    const badArchResult = {
      verdict: "super_awesome", // invalid enum
      critical_issues: [],
      recommended_changes: ["Upgrade RAM"],
      scaling_risks: [],
      confidence: 0.9,
    };
    const val2 = validateTaskResult("ARCHITECTURE_SANITY_CHECK", badArchResult);
    expect(val2.success).toBe(false);

    // Malformed Fact Check: missing explanation
    const badFactResult = {
      verdict: "true",
      confidence: 0.9,
    };
    const val3 = validateTaskResult("EXPERT_FACT_VERIFICATION", badFactResult);
    expect(val3.success).toBe(false);
  });

  // 5. Expired Quote
  it("should identify and reject expired quotes", async () => {
    const expiredQuote = await db.createQuote({
      id: "quote_expired_test",
      task_type_id: "EXPERT_FACT_VERIFICATION",
      input_payload: {
        claim: "Vercel serverless functions have a 5-minute timeout by default",
        context: "Documentation review",
      },
      quoted_price_usd: 29.0,
      target_payout_usd: 18.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() - 1000).toISOString(), // expired in past
    });

    const isExpired = new Date(expiredQuote.expires_at).getTime() < Date.now();
    expect(isExpired).toBe(true);
  });

  // 6. Duplicate Submission
  it("should prevent duplicate result submissions on an already completed task", async () => {
    const quote = await db.createQuote({
      id: "quote_dup_test",
      task_type_id: "EXPERT_FACT_VERIFICATION",
      input_payload: {
        claim: "Neon PostgreSQL separates compute from storage.",
        context: "Technical validation",
      },
      quoted_price_usd: 29.0,
      target_payout_usd: 18.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const task = await db.createTask({
      id: "task_dup_test",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    await db.acceptTask(task.id, "w_elena_fact");
    await db.startTask(task.id, "w_elena_fact");

    const validResult = {
      verdict: "true" as const,
      explanation: "Neon architecture separates Postgres compute nodes from custom Page Server storage layers.",
      confidence: 0.99,
      source_notes: "Neon Architecture whitepaper and official docs.",
    };

    // First submission: Success
    const sub1 = await db.submitTaskResult({
      id: "res_dup_1",
      taskId: task.id,
      workerId: "w_elena_fact",
      resultPayload: validResult,
    });
    expect(sub1.success).toBe(true);

    // Second submission: Blocked with 409
    const sub2 = await db.submitTaskResult({
      id: "res_dup_2",
      taskId: task.id,
      workerId: "w_elena_fact",
      resultPayload: validResult,
    });
    expect(sub2.success).toBe(false);
    expect(sub2.code).toBe(409);
    expect(sub2.error).toContain("already submitted");
  });

  // 7. Result Retrieval Before Completion
  it("should not return results before task completion", async () => {
    const quote = await db.createQuote({
      id: "quote_early_res_test",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: {
        url: "https://example.com",
        target_audience: "SaaS users",
      },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const task = await db.createTask({
      id: "task_early_res_test",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    // In OFFERED status, result is null and status is not COMPLETED
    expect(task.status).not.toBe("COMPLETED");
    const result = await db.getTaskResult(task.id);
    expect(result).toBeNull();
  });

  // 8. Unsupported Task Type
  it("should reject unsupported task types", async () => {
    const unsupportedType = "LEGAL_CONTRACT_REVIEW";
    const taskType = await db.getTaskType(unsupportedType);
    expect(taskType).toBeNull();

    const inputVal = validateTaskInput(unsupportedType, { foo: "bar" });
    expect(inputVal.success).toBe(false);
  });
});
