import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "../src/db";
import { POST as createQuote } from "../src/app/api/quotes/route";
import { POST as createTask } from "../src/app/api/tasks/route";
import { GET as getTask } from "../src/app/api/tasks/[id]/route";
import { POST as acceptTask } from "../src/app/api/tasks/[id]/accept/route";
import { POST as startTask } from "../src/app/api/tasks/[id]/start/route";
import { POST as submitTask } from "../src/app/api/tasks/[id]/submit/route";
import { GET as getResult } from "../src/app/api/tasks/[id]/result/route";
import { GET as getCatalogue } from "../src/app/api/catalogue/route";
import { GET as getEvents } from "../src/app/api/events/route";

describe("Sprint 1 API Invariants & End-to-End Route Integration", () => {
  beforeEach(() => {
    db.resetMemStore();
  });

  it("should test quote creation, expiry, and task creation through the actual routes", async () => {
    // 1. Create a quote
    const quoteReq = new NextRequest("http://localhost:3000/api/quotes", {
      method: "POST",
      body: JSON.stringify({
        task_type: "EXPERT_FACT_VERIFICATION",
        input_payload: {
          claim: "Neon PostgreSQL separates storage from compute.",
          context: "Architecture document review",
        },
      }),
    });
    const quoteRes = await createQuote(quoteReq);
    expect(quoteRes.status).toBe(201);
    const quoteJson = await quoteRes.json();
    expect(quoteJson.quote_id).toBeDefined();

    // 2. Create task from valid quote
    const taskReq = new NextRequest("http://localhost:3000/api/tasks", {
      method: "POST",
      body: JSON.stringify({ quote_id: quoteJson.quote_id }),
    });
    const taskRes = await createTask(taskReq);
    expect(taskRes.status).toBe(201);
    const taskJson = await taskRes.json();
    expect(taskJson.task_id).toBeDefined();
    expect(taskJson.agent_token).toBeDefined();
    expect(taskJson.offers.length).toBeGreaterThanOrEqual(1);

    // 3. Repeated task creation from same quote returns 200 idempotently
    const repeatReq = new NextRequest("http://localhost:3000/api/tasks", {
      method: "POST",
      body: JSON.stringify({ quote_id: quoteJson.quote_id }),
    });
    const repeatRes = await createTask(repeatReq);
    expect(repeatRes.status).toBe(200);
    const repeatJson = await repeatRes.json();
    expect(repeatJson.task_id).toBe(taskJson.task_id);
    expect(repeatJson.is_existing).toBe(true);
  });

  it("should enforce authorization boundaries: agent token on result, worker token on accept/submit", async () => {
    // Setup task
    const quote = await db.createQuote({
      id: "quote_route_auth_test",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "B2B SaaS" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_route_auth_test",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    const validOffer = createRes.offers.find((o) => o.worker_id === "w_alex_ux");

    // 1. Accept with invalid worker token -> 401
    const badAcceptReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_alex_ux", token: "invalid_worker_token" }),
    });
    const badAcceptRes = await acceptTask(badAcceptReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(badAcceptRes.status).toBe(401);

    // 2. Accept with incapable worker (e.g. w_alex_ux on ARCHITECTURE task) -> 403
    const archTask = await db.createTask({
      id: "task_arch_incapable",
      quote_id: "quote_arch_fake",
      task_type_id: "ARCHITECTURE_SANITY_CHECK",
      input_payload: { architecture_summary: "Description for test", components: ["App"], expected_scale: "10k" },
    });
    const incapableReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_alex_ux" }),
    });
    const incapableRes = await acceptTask(incapableReq, { params: Promise.resolve({ id: archTask.task.id }) });
    expect(incapableRes.status).toBe(403);
    const incapableJson = await incapableRes.json();
    expect(incapableJson.error).toContain("does not possess the required verified capability");

    // 3. Valid accept and start
    const goodAcceptReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_alex_ux", token: validOffer?.worker_token }),
    });
    const goodAcceptRes = await acceptTask(goodAcceptReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(goodAcceptRes.status).toBe(200);

    const goodStartReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_alex_ux", token: validOffer?.worker_token }),
    });
    await startTask(goodStartReq, { params: Promise.resolve({ id: createRes.task.id }) });

    // 4. Submit valid result
    const submitReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({
        worker_id: "w_alex_ux",
        token: validOffer?.worker_token,
        result_payload: {
          top_issues: ["Hero section is unclear"],
          highest_impact_change: "Add 3-line quickstart code sample above fold",
          conversion_blockers: [],
          confidence: 0.95,
        },
      }),
    });
    const submitRes = await submitTask(submitReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(submitRes.status).toBe(200);

    // 5. Retrieve result without agent token -> 401
    const noTokenReq = new NextRequest("http://localhost:3000");
    const noTokenRes = await getResult(noTokenReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(noTokenRes.status).toBe(401);

    // 6. Retrieve result with valid agent token -> 200
    const validTokenReq = new NextRequest(`http://localhost:3000?agent_token=${createRes.agent_token}`);
    const validTokenRes = await getResult(validTokenReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(validTokenRes.status).toBe(200);
    const resultJson = await validTokenRes.json();
    expect(resultJson.status).toBe("COMPLETED");
  });

  it("should protect public /api/events and redact sensitive input payload", async () => {
    // Log quote event with customer payload
    await db.createQuote({
      id: "quote_secret_payload",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: {
        url: "https://secret-startup.internal/page",
        target_audience: "Confidential customer list",
      },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    await db.logEvent({
      id: "evt_secret_test",
      eventType: "quote_requested",
      entityType: "quote",
      entityId: "quote_secret_payload",
      payload: {
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: { secret_field: "my-internal-customer-data" },
      },
    });

    // Public request to /api/events
    const publicReq = new NextRequest("http://localhost:3000/api/events");
    const publicRes = await getEvents(publicReq);
    expect(publicRes.status).toBe(200);
    const publicJson = await publicRes.json();

    const quoteEvent = publicJson.events.find((e: any) => e.entity_id === "quote_secret_payload");
    expect(quoteEvent).toBeDefined();
    // input_payload must be redacted
    expect(quoteEvent.payload.input_payload).toBe("[REDACTED: SENSITIVE CUSTOMER PAYLOAD]");
  });
});
