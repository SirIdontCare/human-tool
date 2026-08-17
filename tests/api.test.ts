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

describe("Sprint 1: End-to-End Next.js API Routes Test", () => {
  beforeEach(() => {
    db.resetMemStore();
  });

  it("should support the full API lifecycle across all endpoints", async () => {
    // 0. GET /api/catalogue
    const catRes = await getCatalogue();
    expect(catRes.status).toBe(200);
    const catData = await catRes.json();
    expect(catData.task_types).toHaveLength(3);

    // 1. POST /api/quotes
    const quoteReq = new NextRequest("http://localhost:3000/api/quotes", {
      method: "POST",
      body: JSON.stringify({
        task_type: "ARCHITECTURE_SANITY_CHECK",
        input_payload: {
          architecture_summary: "Distributed queue with serverless Neon Postgres backend",
          components: ["Next.js", "Neon Postgres", "Redis"],
          expected_scale: "10,000 requests per minute",
        },
      }),
    });

    const quoteRes = await createQuote(quoteReq);
    expect(quoteRes.status).toBe(201);
    const quoteJson = await quoteRes.json();
    expect(quoteJson.quote_id).toBeDefined();
    expect(quoteJson.customer_price_usd).toBe(69);

    // 2. POST /api/tasks
    const taskReq = new NextRequest("http://localhost:3000/api/tasks", {
      method: "POST",
      body: JSON.stringify({ quote_id: quoteJson.quote_id }),
    });

    const taskRes = await createTask(taskReq);
    expect(taskRes.status).toBe(201);
    const taskJson = await taskRes.json();
    expect(taskJson.task_id).toBeDefined();
    expect(taskJson.status).toBe("OFFERED");

    // 3. GET /api/tasks/[id]
    const getTaskRes = await getTask(new NextRequest("http://localhost:3000"), {
      params: Promise.resolve({ id: taskJson.task_id }),
    });
    expect(getTaskRes.status).toBe(200);
    const getTaskJson = await getTaskRes.json();
    expect(getTaskJson.id).toBe(taskJson.task_id);

    // 4. POST /api/tasks/[id]/accept
    const acceptReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_sam_arch" }),
    });
    const acceptRes = await acceptTask(acceptReq, {
      params: Promise.resolve({ id: taskJson.task_id }),
    });
    expect(acceptRes.status).toBe(200);
    const acceptJson = await acceptRes.json();
    expect(acceptJson.status).toBe("ACCEPTED");

    // 5. POST /api/tasks/[id]/start
    const startReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({ worker_id: "w_sam_arch" }),
    });
    const startRes = await startTask(startReq, {
      params: Promise.resolve({ id: taskJson.task_id }),
    });
    expect(startRes.status).toBe(200);
    const startJson = await startRes.json();
    expect(startJson.status).toBe("IN_PROGRESS");

    // 6. Early result check should return 400
    const earlyResultRes = await getResult(new NextRequest("http://localhost:3000"), {
      params: Promise.resolve({ id: taskJson.task_id }),
    });
    expect(earlyResultRes.status).toBe(400);

    // 7. POST /api/tasks/[id]/submit
    const submitReq = new NextRequest("http://localhost:3000", {
      method: "POST",
      body: JSON.stringify({
        worker_id: "w_sam_arch",
        result_payload: {
          verdict: "good",
          critical_issues: [],
          recommended_changes: ["Add connection pooling for Neon serverless driver"],
          scaling_risks: ["Spike loads over 50k rps require read replicas"],
          confidence: 0.95,
        },
      }),
    });
    const submitRes = await submitTask(submitReq, {
      params: Promise.resolve({ id: taskJson.task_id }),
    });
    expect(submitRes.status).toBe(200);
    const submitJson = await submitRes.json();
    expect(submitJson.status).toBe("COMPLETED");

    // 8. GET /api/tasks/[id]/result
    const resultRes = await getResult(new NextRequest("http://localhost:3000"), {
      params: Promise.resolve({ id: taskJson.task_id }),
    });
    expect(resultRes.status).toBe(200);
    const resultJson = await resultRes.json();
    expect(resultJson.status).toBe("COMPLETED");
    expect(resultJson.result.verdict).toBe("good");

    // 9. GET /api/events
    const eventReq = new NextRequest("http://localhost:3000/api/events");
    const eventRes = await getEvents(eventReq);
    expect(eventRes.status).toBe(200);
    const eventJson = await eventRes.json();
    expect(eventJson.events.length).toBeGreaterThanOrEqual(6);
  });
});
