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

describe("Sprint 1.1 Thin API Route Transport & Stable Error Code Invariants", () => {
  beforeEach(() => {
    db.resetMemStore();
  });

  it("should return stable error code INVALID_INPUT when quote payload is malformed", async () => {
    const quoteReq = new NextRequest("http://localhost:3000/api/quotes", {
      method: "POST",
      body: JSON.stringify({
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: { url: "not-a-valid-url" }, // missing target_audience & invalid url
      }),
    });
    const quoteRes = await createQuote(quoteReq);
    expect(quoteRes.status).toBe(400);
    const quoteJson = await quoteRes.json();
    expect(quoteJson.code).toBe("INVALID_INPUT");
    expect(quoteJson.error).toBeDefined();
  });

  it("should return stable error code WORKER_CAPABILITY_REQUIRED on incapable worker acceptance", async () => {
    const quote = await db.createQuote({
      id: "quote_route_test_cap",
      task_type_id: "ARCHITECTURE_SANITY_CHECK",
      input_payload: { architecture_summary: "Test description for validation", components: ["Next.js"], expected_scale: "10k" },
      quoted_price_usd: 69.0,
      target_payout_usd: 45.0,
      estimated_minutes: 60,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_route_test_cap",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    const acceptReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_alex_ux" }),
    });
    const acceptRes = await acceptTask(acceptReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(acceptRes.status).toBe(403);
    const acceptJson = await acceptRes.json();
    expect(acceptJson.code).toBe("WORKER_CAPABILITY_REQUIRED");
  });

  it("should return stable error code UNAUTHORIZED on missing or bad agent token", async () => {
    const quote = await db.createQuote({
      id: "quote_route_test_auth",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_route_test_auth",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    const offer = createRes.offers.find((o) => o.worker_id === "w_alex_ux");
    await db.acceptTask(createRes.task.id, "w_alex_ux", offer?.worker_token);
    await db.startTask(createRes.task.id, "w_alex_ux", offer?.worker_token);
    await db.submitTaskResult({
      id: "res_route_auth",
      taskId: createRes.task.id,
      workerId: "w_alex_ux",
      workerToken: offer?.worker_token,
      resultPayload: {
        top_issues: ["Issue 1"],
        highest_impact_change: "Change 1",
        confidence: 0.95,
      },
    });

    // Request result with no token
    const noTokenReq = new NextRequest("http://localhost:3000");
    const noTokenRes = await getResult(noTokenReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(noTokenRes.status).toBe(401);
    const noTokenJson = await noTokenRes.json();
    expect(noTokenJson.code).toBe("UNAUTHORIZED");

    // Request result with valid token in Authorization header
    const authReq = new NextRequest("http://localhost:3000", {
      headers: { Authorization: `Bearer ${createRes.agent_token}` },
    });
    const authRes = await getResult(authReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(authRes.status).toBe(200);
    const authJson = await authRes.json();
    expect(authJson.status).toBe("COMPLETED");
  });

  it("should redact sensitive input payload in public /api/events", async () => {
    await db.logEvent({
      id: "evt_test_audit",
      eventType: "quote_requested",
      entityType: "quote",
      entityId: "quote_audit_test",
      payload: {
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: { private_url: "https://secret.com" },
      },
    });

    const publicReq = new NextRequest("http://localhost:3000/api/events");
    const publicRes = await getEvents(publicReq);
    expect(publicRes.status).toBe(200);
    const publicJson = await publicRes.json();

    const evt = publicJson.events.find((e: any) => e.entity_id === "quote_audit_test");
    expect(evt).toBeDefined();
    expect(evt.payload.input_payload).toBe("[REDACTED: SENSITIVE CUSTOMER PAYLOAD]");
  });
});
