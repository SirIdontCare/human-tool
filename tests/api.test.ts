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
import { GET as getWorkerAuth } from "../src/app/api/internal/worker-auth/route";

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

    const alexToken = await db.rotateWorkerOfferToken(createRes.task.id, "w_alex_ux");

    const acceptReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_alex_ux", token: alexToken }),
    });
    const acceptRes = await acceptTask(acceptReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(acceptRes.status).toBe(403);
    const acceptJson = await acceptRes.json();
    expect(acceptJson.code).toBe("WORKER_CAPABILITY_REQUIRED");
  });

  it("should reject worker actions with 401 WORKER_NOT_AUTHORIZED when the offer token is missing", async () => {
    const quote = await db.createQuote({
      id: "quote_route_test_no_token",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_route_test_no_token",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    const acceptReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_alex_ux" }),
    });
    const acceptRes = await acceptTask(acceptReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(acceptRes.status).toBe(401);
    const acceptJson = await acceptRes.json();
    expect(acceptJson.code).toBe("WORKER_NOT_AUTHORIZED");

    const startReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_alex_ux" }),
    });
    const startRes = await startTask(startReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(startRes.status).toBe(401);
    expect((await startRes.json()).code).toBe("WORKER_NOT_AUTHORIZED");
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

    const alexToken = await db.rotateWorkerOfferToken(createRes.task.id, "w_alex_ux");
    await db.acceptTask(createRes.task.id, "w_alex_ux", alexToken || undefined);
    await db.startTask(createRes.task.id, "w_alex_ux", alexToken || undefined);
    await db.submitTaskResult({
      id: "res_route_auth",
      taskId: createRes.task.id,
      workerId: "w_alex_ux",
      workerToken: alexToken || undefined,
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

  it("should require a valid agent or worker token for GET /api/tasks/:id", async () => {
    const quote = await db.createQuote({
      id: "quote_route_test_read",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const createRes = await db.createTask({
      id: "task_route_test_read",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });
    const alexToken = await db.rotateWorkerOfferToken(createRes.task.id, "w_alex_ux");

    // No token -> 401 UNAUTHORIZED
    const noTokenReq = new NextRequest("http://localhost:3000/api/tasks/x");
    const noTokenRes = await getTask(noTokenReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(noTokenRes.status).toBe(401);
    expect((await noTokenRes.json()).code).toBe("UNAUTHORIZED");

    // Agent token -> 200, no worker-only fields
    const agentReq = new NextRequest("http://localhost:3000", {
      headers: { "x-agent-token": createRes.agent_token },
    });
    const agentRes = await getTask(agentReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(agentRes.status).toBe(200);
    const agentJson = await agentRes.json();
    expect(agentJson.status).toBe("OFFERED");
    expect(agentJson.compensation_usd).toBeUndefined();
    expect(JSON.stringify(agentJson)).not.toContain("target_payout_usd");

    // Worker token -> 200 with worker-only compensation_usd
    const workerReq = new NextRequest("http://localhost:3000", {
      headers: { "x-worker-token": alexToken || "" },
    });
    const workerRes = await getTask(workerReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(workerRes.status).toBe(200);
    const workerJson = await workerRes.json();
    expect(workerJson.compensation_usd).toBe(25.0);
    expect(JSON.stringify(workerJson)).not.toContain("target_payout_usd");

    // Invalid token -> 401
    const badReq = new NextRequest("http://localhost:3000", {
      headers: { "x-worker-token": "otk_invalid" },
    });
    const badRes = await getTask(badReq, { params: Promise.resolve({ id: createRes.task.id }) });
    expect(badRes.status).toBe(401);
  });

  it("should return a valid agent token when POST /api/tasks is replayed idempotently", async () => {
    const quote = await db.createQuote({
      id: "quote_route_test_replay",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const firstReq = new NextRequest("http://localhost:3000/api/tasks", {
      method: "POST",
      body: JSON.stringify({ quote_id: quote.id }),
    });
    const firstRes = await createTask(firstReq);
    expect(firstRes.status).toBe(201);
    const firstJson = await firstRes.json();
    expect(firstJson.agent_token).toBeTruthy();

    const replayReq = new NextRequest("http://localhost:3000/api/tasks", {
      method: "POST",
      body: JSON.stringify({ quote_id: quote.id }),
    });
    const replayRes = await createTask(replayReq);
    expect(replayRes.status).toBe(200);
    const replayJson = await replayRes.json();
    expect(replayJson.task_id).toBe(firstJson.task_id);
    expect(replayJson.agent_token).toBeTruthy();

    // The replay token authenticates to the existing task
    const readReq = new NextRequest("http://localhost:3000", {
      headers: { "x-agent-token": replayJson.agent_token },
    });
    const readRes = await getTask(readReq, { params: Promise.resolve({ id: replayJson.task_id }) });
    expect(readRes.status).toBe(200);
  });

  it("should not leak worker credentials or target_payout_usd through POST /api/tasks or GET /api/catalogue", async () => {
    const quote = await db.createQuote({
      id: "quote_route_test_leak",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const taskReq = new NextRequest("http://localhost:3000/api/tasks", {
      method: "POST",
      body: JSON.stringify({ quote_id: quote.id }),
    });
    const taskRes = await createTask(taskReq);
    const taskJson = await taskRes.json();
    const serialized = JSON.stringify(taskJson);
    expect(serialized).not.toContain("target_payout_usd");
    expect(serialized).not.toContain("worker_token");
    expect(serialized).not.toContain("otk_");
    expect(serialized).not.toContain("token=");

    const catRes = await getCatalogue();
    expect(catRes.status).toBe(200);
    expect(JSON.stringify(await catRes.json())).not.toContain("target_payout_usd");
  });

  it("should fail closed on /api/events unless INTERNAL_DEV_SECRET is configured and matches", async () => {
    const originalSecret = process.env.INTERNAL_DEV_SECRET;
    try {
      // 1. Secret not configured -> 401 UNAUTHORIZED (fail closed)
      delete process.env.INTERNAL_DEV_SECRET;
      const noSecretReq = new NextRequest("http://localhost:3000/api/events");
      const noSecretRes = await getEvents(noSecretReq);
      expect(noSecretRes.status).toBe(401);
      expect((await noSecretRes.json()).code).toBe("UNAUTHORIZED");

      // 2. Wrong secret -> 401
      (process.env as Record<string, string | undefined>).INTERNAL_DEV_SECRET = "dev-secret-abc";
      const wrongReq = new NextRequest("http://localhost:3000/api/events", {
        headers: { "x-internal-key": "wrong" },
      });
      const wrongRes = await getEvents(wrongReq);
      expect(wrongRes.status).toBe(401);

      // 3. Correct secret -> 200 with full internal events
      await db.logEvent({
        id: "evt_test_internal",
        eventType: "task_offered",
        entityType: "task",
        entityId: "task_internal_1",
        payload: { worker_id: "w_alex_ux", target_payout_usd: 25.0 },
      });
      const okReq = new NextRequest("http://localhost:3000/api/events", {
        headers: { "x-internal-key": "dev-secret-abc" },
      });
      const okRes = await getEvents(okReq);
      expect(okRes.status).toBe(200);
      const okJson = await okRes.json();
      const evt = okJson.events.find((e: any) => e.entity_id === "task_internal_1");
      expect(evt).toBeDefined();
      expect(evt.payload.target_payout_usd).toBe(25.0);
    } finally {
      if (originalSecret) {
        (process.env as Record<string, string | undefined>).INTERNAL_DEV_SECRET = originalSecret;
      } else {
        delete process.env.INTERNAL_DEV_SECRET;
      }
    }
  });

  it("should deliver worker offer credentials only through the internal worker-auth channel", async () => {
    const originalSecret = process.env.INTERNAL_DEV_SECRET;
    try {
      // No secret -> 401
      delete process.env.INTERNAL_DEV_SECRET;
      const noSecretReq = new NextRequest("http://localhost:3000/api/internal/worker-auth?task_id=x&worker_id=w_alex_ux");
      const noSecretRes = await getWorkerAuth(noSecretReq);
      expect(noSecretRes.status).toBe(401);

      // Wrong secret -> 401
      (process.env as Record<string, string | undefined>).INTERNAL_DEV_SECRET = "dev-secret-abc";
      const wrongReq = new NextRequest("http://localhost:3000/api/internal/worker-auth?task_id=x&worker_id=w_alex_ux", {
        headers: { "x-internal-key": "wrong" },
      });
      expect((await getWorkerAuth(wrongReq)).status).toBe(401);

      // Valid secret -> fresh credential for an existing offer
      const quote = await db.createQuote({
        id: "quote_route_test_delivery",
        task_type_id: "LANDING_PAGE_REVIEW",
        input_payload: { url: "https://example.com", target_audience: "Devs" },
        quoted_price_usd: 39.0,
        target_payout_usd: 25.0,
        estimated_minutes: 30,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      const createRes = await db.createTask({
        id: "task_route_test_delivery",
        quote_id: quote.id,
        task_type_id: quote.task_type_id,
        input_payload: quote.input_payload,
      });

      const okReq = new NextRequest(
        `http://localhost:3000/api/internal/worker-auth?task_id=${createRes.task.id}&worker_id=w_alex_ux`,
        { headers: { "x-internal-key": "dev-secret-abc" } }
      );
      const okRes = await getWorkerAuth(okReq);
      expect(okRes.status).toBe(200);
      const okJson = await okRes.json();
      expect(okJson.worker_token).toMatch(/^otk_/);
      expect(okJson.worker_url).toContain(`token=${okJson.worker_token}`);

      // Delivered credential is usable by the intended worker...
      expect(await db.verifyWorkerToken(createRes.task.id, "w_alex_ux", okJson.worker_token)).toBe(true);
      // ...and never appeared in the agent-facing creation response (checked in the leak test above)
    } finally {
      if (originalSecret) {
        (process.env as Record<string, string | undefined>).INTERNAL_DEV_SECRET = originalSecret;
      } else {
        delete process.env.INTERNAL_DEV_SECRET;
      }
    }
  });

  it("should never return raw internal exception text for INTERNAL_ERROR", async () => {
    // Trigger an internal error path: validate that the response shape is the fixed public message.
    // (Covers the handleServiceError convention used by every route.)
    const quote = await db.createQuote({
      id: "quote_route_test_internal",
      task_type_id: "LANDING_PAGE_REVIEW",
      input_payload: { url: "https://example.com", target_audience: "Devs" },
      quoted_price_usd: 39.0,
      target_payout_usd: 25.0,
      estimated_minutes: 30,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    const createRes = await db.createTask({
      id: "task_route_test_internal",
      quote_id: quote.id,
      task_type_id: quote.task_type_id,
      input_payload: quote.input_payload,
    });

    // A malformed route invocation (request body read failure) exercises the catch path.
    const badReq = new NextRequest("http://localhost:3000/api/tasks/x", { method: "GET" });
    const getWithBrokenCtx = async () => {
      try {
        return await getTask(badReq, { params: Promise.reject(new Error("Cannot destructure internal context")) });
      } catch (err) {
        throw err;
      }
    };
    const res = await getWithBrokenCtx();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("INTERNAL_ERROR");
    expect(json.error).toBe("Internal server error");
    expect(json.error).not.toContain("Cannot");
    expect(json.error).not.toContain("undefined");
  });
});