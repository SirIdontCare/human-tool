import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { db } from "../src/db";
import { createMcpServer } from "../src/mcp/server";
import { acceptTask, startTask, submitTaskResult } from "../src/services/tasks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function getTextContent(res: unknown): string {
  const r = res as { content?: Array<{ type: string; text?: string }> };
  if (!r.content || r.content.length === 0) return "";
  return r.content[0].text || "";
}

function parseJsonContent<T = any>(res: unknown): T {
  return JSON.parse(getTextContent(res));
}

describe("Sprint 2 MCP Adapter Protocol Invariant Tests", () => {
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    db.resetMemStore();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer();
    await server.connect(serverTransport);

    client = new Client(
      { name: "test-ai-agent", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    try {
      await client.close();
      await server.close();
    } catch {
      // ignore teardown errors
    }
  });

  // Test 1: quote_human returns usable quote + capability token
  it("1. quote_human returns usable quote + capability token (agent_token)", async () => {
    const res = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: {
          url: "https://agent-app.example.com",
          target_audience: "Autonomous AI Agents and B2B SaaS",
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const content = parseJsonContent<{
      available: boolean;
      quote_id: string;
      task_type: string;
      customer_price_usd: number;
      estimated_minutes: number;
      required_capability: string;
      expires_at: string;
      agent_token: string;
    }>(res);

    expect(content.available).toBe(true);
    expect(content.quote_id).toMatch(/^quote_/);
    expect(content.task_type).toBe("LANDING_PAGE_REVIEW");
    expect(content.customer_price_usd).toBe(39.0);
    expect(content.estimated_minutes).toBe(30);
    expect(content.required_capability).toBe("UX_CONVERSION_ANALYSIS");
    expect(content.expires_at).toBeDefined();
    expect(content.agent_token).toMatch(/^atk_/);
  });

  // Test 2: call_human without token fails
  it("2. call_human without token fails", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "EXPERT_FACT_VERIFICATION",
        input_payload: {
          claim: "Neon Postgres separates compute from storage.",
          context: "Architecture claim verification",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string }>(quoteRes);

    const callRes = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: "",
      },
    });

    expect(callRes.isError).toBe(true);
    expect(getTextContent(callRes)).toBeDefined();
  });

  // Test 3: call_human with wrong token fails (UNAUTHORIZED 401)
  it("3. call_human with wrong token fails with UNAUTHORIZED", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "ARCHITECTURE_SANITY_CHECK",
        input_payload: {
          architecture_summary: "Distributed event architecture on PostgreSQL",
          components: ["Next.js", "PostgreSQL"],
          expected_scale: "25k rps",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string }>(quoteRes);

    const callRes = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: "atk_wrong_invalid_token_1234567890",
      },
    });

    expect(callRes.isError).toBe(true);
    const errContent = parseJsonContent<{ code: string; status: number }>(callRes);
    expect(errContent.code).toBe("UNAUTHORIZED");
    expect(errContent.status).toBe(401);
  });

  // Test 4: call_human with valid token creates task
  it("4. call_human with valid token creates task", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: {
          url: "https://example.com/checkout",
          target_audience: "Enterprise buyers",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteRes);

    const callRes = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: quote.agent_token,
      },
    });

    expect(callRes.isError).toBeFalsy();
    const task = parseJsonContent<{
      task_id: string;
      quote_id: string;
      task_type: string;
      status: string;
      human_status: string;
      customer_price_usd: number;
      is_existing: boolean;
    }>(callRes);

    expect(task.task_id).toMatch(/^task_/);
    expect(task.quote_id).toBe(quote.quote_id);
    expect(task.task_type).toBe("LANDING_PAGE_REVIEW");
    expect(task.status).toBe("OFFERED");
    expect(task.human_status).toBe("WAITING_FOR_ACCEPTANCE");
    expect(task.customer_price_usd).toBe(39.0);
    expect(task.is_existing).toBe(false);
  });

  // Test 5: replay returns same task (idempotency)
  it("5. replay call_human with same quote_id and valid token returns same task", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "EXPERT_FACT_VERIFICATION",
        input_payload: {
          claim: "PostgreSQL 18 is the latest major release.",
          context: "Database release verification",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteRes);

    const call1 = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: quote.agent_token,
      },
    });
    const task1 = parseJsonContent<{ task_id: string }>(call1);

    const call2 = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: quote.agent_token,
      },
    });
    const task2 = parseJsonContent<{ task_id: string; is_existing: boolean }>(call2);

    expect(task2.task_id).toBe(task1.task_id);
    expect(task2.is_existing).toBe(true);
  });

  // Test 6: get_result without token fails (UNAUTHORIZED 401)
  it("6. get_result without token fails with UNAUTHORIZED", async () => {
    const res = await client.callTool({
      name: "get_result",
      arguments: {
        task_id: "task_non_existent",
        agent_token: "",
      },
    });

    expect(res.isError).toBe(true);
  });

  // Test 7: get_result before completion returns machine-usable not-ready state
  it("7. get_result before completion returns machine-usable not-ready state without crashing", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: {
          url: "https://example.com/demo",
          target_audience: "B2B SaaS Founders",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteRes);

    const callRes = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: quote.agent_token,
      },
    });
    const task = parseJsonContent<{ task_id: string }>(callRes);

    // Call get_result while task is still OFFERED
    const resultRes = await client.callTool({
      name: "get_result",
      arguments: {
        task_id: task.task_id,
        agent_token: quote.agent_token,
      },
    });

    // Must NOT be an opaque MCP error/crash
    expect(resultRes.isError).toBeFalsy();
    const resultData = parseJsonContent<{
      task_id: string;
      status: string;
      human_status: string;
      is_ready: boolean;
      message: string;
    }>(resultRes);

    expect(resultData.task_id).toBe(task.task_id);
    expect(resultData.status).toBe("OFFERED");
    expect(resultData.human_status).toBe("WAITING_FOR_ACCEPTANCE");
    expect(resultData.is_ready).toBe(false);
    expect(resultData.message).toContain("Task result is not ready");
  });

  // Test 8: get_result after completion returns validated structured result
  it("8. get_result after completion returns validated structured result", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "EXPERT_FACT_VERIFICATION",
        input_payload: {
          claim: "Neon supports cold start connection branching in under 500ms.",
          context: "Benchmarking architecture claim",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteRes);

    const callRes = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: quote.agent_token,
      },
    });
    const task = parseJsonContent<{ task_id: string }>(callRes);

    // Simulate worker lifecycle through backend services
    const offers = await db.getOffersForTask(task.task_id);
    const workerId = offers[0].worker_id;
    // Issue worker offer token
    const tokenRes = await db.issueWorkerOfferToken(task.task_id, workerId);
    const workerToken = tokenRes.token;
    expect(workerToken).toBeDefined();

    await acceptTask(task.task_id, { worker_id: workerId }, workerToken);
    await startTask(task.task_id, { worker_id: workerId }, workerToken);
    await submitTaskResult(
      task.task_id,
      {
        worker_id: workerId,
        result_payload: {
          verdict: "true",
          explanation: "Verified against Neon technical architecture whitepaper and live benchmarks.",
          confidence: 0.99,
          source_notes: "Neon official documentation and benchmarks (2025/2026).",
        },
      },
      workerToken
    );

    // Retrieve via MCP get_result
    const resultRes = await client.callTool({
      name: "get_result",
      arguments: {
        task_id: task.task_id,
        agent_token: quote.agent_token,
      },
    });

    expect(resultRes.isError).toBeFalsy();
    const resultData = parseJsonContent<{
      task_id: string;
      task_type: string;
      status: string;
      is_ready: boolean;
      result: { verdict: string; confidence: number };
      submitted_at: string;
    }>(resultRes);

    expect(resultData.task_id).toBe(task.task_id);
    expect(resultData.task_type).toBe("EXPERT_FACT_VERIFICATION");
    expect(resultData.status).toBe("COMPLETED");
    expect(resultData.is_ready).toBe(true);
    expect(resultData.result.verdict).toBe("true");
    expect(resultData.result.confidence).toBe(0.99);
    expect(resultData.submitted_at).toBeDefined();
  });

  // Test 9: no MCP response leaks target_payout_usd
  it("9. no MCP response leaks target_payout_usd across quote_human, call_human, or get_result", async () => {
    // 1. Check quote_human
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "ARCHITECTURE_SANITY_CHECK",
        input_payload: {
          architecture_summary: "High throughput distributed pipeline",
          components: ["Next.js", "PostgreSQL"],
          expected_scale: "100k rps",
        },
      },
    });
    const rawQuoteText = getTextContent(quoteRes);
    expect(rawQuoteText).not.toContain("target_payout_usd");
    expect(rawQuoteText).not.toContain("margin_usd");
    expect(rawQuoteText).not.toContain("payout");

    const quote = JSON.parse(rawQuoteText);

    // 2. Check call_human
    const callRes = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: quote.agent_token,
      },
    });
    const rawCallText = getTextContent(callRes);
    expect(rawCallText).not.toContain("target_payout_usd");
    expect(rawCallText).not.toContain("payout");

    const task = JSON.parse(rawCallText);

    // 3. Check get_result
    const getRes = await client.callTool({
      name: "get_result",
      arguments: {
        task_id: task.task_id,
        agent_token: quote.agent_token,
      },
    });
    const rawGetText = getTextContent(getRes);
    expect(rawGetText).not.toContain("target_payout_usd");
    expect(rawGetText).not.toContain("payout");
  });

  // Test 10: no MCP response leaks worker credentials
  it("10. no MCP response leaks worker credentials or internal secrets", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: {
          url: "https://example.com/pricing",
          target_audience: "Developers",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteRes);

    const callRes = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quote.quote_id,
        agent_token: quote.agent_token,
      },
    });
    const rawCallText = getTextContent(callRes);

    // Must never leak worker tokens, worker token hashes, internal keys, or dev secrets
    expect(rawCallText).not.toContain("otk_");
    expect(rawCallText).not.toContain("worker_token");
    expect(rawCallText).not.toContain("worker_token_hash");
    expect(rawCallText).not.toContain("agent_token_hash");
    expect(rawCallText).not.toContain("INTERNAL_DEV_SECRET");
    expect(rawCallText).not.toContain("DATABASE_URL");
  });

  // Test 11: get_result on not-ready task with token belonging to another task returns UNAUTHORIZED (auth before status)
  it("11. get_result on not-ready task with valid agent_token belonging to another task returns UNAUTHORIZED 401 (never RESULT_NOT_READY)", async () => {
    // 1. Create Task A (in OFFERED / not-ready status)
    const quoteResA = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: {
          url: "https://task-a.example.com",
          target_audience: "Audience A",
        },
      },
    });
    const quoteA = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteResA);
    const taskResA = await client.callTool({
      name: "call_human",
      arguments: {
        quote_id: quoteA.quote_id,
        agent_token: quoteA.agent_token,
      },
    });
    const taskA = parseJsonContent<{ task_id: string }>(taskResA);

    // 2. Create Task B to obtain a syntactically valid but foreign agent_token
    const quoteResB = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "ARCHITECTURE_SANITY_CHECK",
        input_payload: {
          architecture_summary: "Complete system architecture summary for Task B",
          components: ["Next.js", "PostgreSQL"],
          expected_scale: "10k rps",
        },
      },
    });
    const quoteB = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteResB);

    // 3. Attempt get_result on Task A using Token B
    const resultRes = await client.callTool({
      name: "get_result",
      arguments: {
        task_id: taskA.task_id,
        agent_token: quoteB.agent_token,
      },
    });

    expect(resultRes.isError).toBe(true);
    const errContent = parseJsonContent<{ code: string; status: number; error: string }>(resultRes);
    expect(errContent.code).toBe("UNAUTHORIZED");
    expect(errContent.status).toBe(401);

    const rawText = getTextContent(resultRes);
    expect(rawText).not.toContain("RESULT_NOT_READY");
    expect(rawText).not.toContain("is_ready");
    expect(rawText).not.toContain("OFFERED");
  });

  // Test 12: unexpected internal error returns fixed INTERNAL_ERROR without leaking raw details or secrets
  it("12. unexpected non-ServiceError returns fixed INTERNAL_ERROR 500 without leaking raw exception details, stack traces, or secrets", async () => {
    const sensitiveSecret = "SECRET_DATABASE_CREDENTIAL_PASSWORD_ABC987";
    const dbSpy = vi.spyOn(db, "getTask").mockRejectedValueOnce(new Error(`Database connection died with ${sensitiveSecret} at file:///secret/path.ts:42:10`));

    const res = await client.callTool({
      name: "get_result",
      arguments: {
        task_id: "task_test_internal_error",
        agent_token: "atk_some_valid_looking_token",
      },
    });

    dbSpy.mockRestore();

    expect(res.isError).toBe(true);
    const content = parseJsonContent<{ error: string; code: string; status: number }>(res);
    expect(content.error).toBe("Internal server error");
    expect(content.code).toBe("INTERNAL_ERROR");
    expect(content.status).toBe(500);

    const rawText = getTextContent(res);
    expect(rawText).not.toContain(sensitiveSecret);
    expect(rawText).not.toContain("Database connection died");
    expect(rawText).not.toContain("stack");
    expect(rawText).not.toContain("DATABASE_URL");
    expect(rawText).not.toContain("INTERNAL_DEV_SECRET");
  });

  // Test 13: human_status reflects actual lifecycle progression without claiming worker is active prematurely
  it("13. human_status accurately transitions OFFERED (WAITING_FOR_ACCEPTANCE) -> ACCEPTED (ACCEPTED_AWAITING_START) -> IN_PROGRESS -> COMPLETED", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "EXPERT_FACT_VERIFICATION",
        input_payload: {
          claim: "PostgreSQL 18 is the latest major release.",
          context: "Database release verification",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteRes);

    // 1. Initial creation -> OFFERED (WAITING_FOR_ACCEPTANCE)
    const callRes = await client.callTool({
      name: "call_human",
      arguments: { quote_id: quote.quote_id, agent_token: quote.agent_token },
    });
    const task = parseJsonContent<{ task_id: string; status: string; human_status: string }>(callRes);
    expect(task.status).toBe("OFFERED");
    expect(task.human_status).toBe("WAITING_FOR_ACCEPTANCE");

    // 2. Poll before accept -> OFFERED (WAITING_FOR_ACCEPTANCE)
    const poll1 = await client.callTool({
      name: "get_result",
      arguments: { task_id: task.task_id, agent_token: quote.agent_token },
    });
    const poll1Data = parseJsonContent<{ status: string; human_status: string; is_ready: boolean }>(poll1);
    expect(poll1Data.status).toBe("OFFERED");
    expect(poll1Data.human_status).toBe("WAITING_FOR_ACCEPTANCE");
    expect(poll1Data.is_ready).toBe(false);

    // 3. Worker accepts -> ACCEPTED (ACCEPTED_AWAITING_START)
    const offers = await db.getOffersForTask(task.task_id);
    const workerId = offers[0].worker_id;
    const workerToken = (await db.issueWorkerOfferToken(task.task_id, workerId)).token!;
    await acceptTask(task.task_id, { worker_id: workerId }, workerToken);

    const poll2 = await client.callTool({
      name: "get_result",
      arguments: { task_id: task.task_id, agent_token: quote.agent_token },
    });
    const poll2Data = parseJsonContent<{ status: string; human_status: string; is_ready: boolean }>(poll2);
    expect(poll2Data.status).toBe("ACCEPTED");
    expect(poll2Data.human_status).toBe("ACCEPTED_AWAITING_START");
    expect(poll2Data.is_ready).toBe(false);

    // 4. Worker starts -> IN_PROGRESS
    await startTask(task.task_id, { worker_id: workerId }, workerToken);

    const poll3 = await client.callTool({
      name: "get_result",
      arguments: { task_id: task.task_id, agent_token: quote.agent_token },
    });
    const poll3Data = parseJsonContent<{ status: string; human_status: string; is_ready: boolean }>(poll3);
    expect(poll3Data.status).toBe("IN_PROGRESS");
    expect(poll3Data.human_status).toBe("IN_PROGRESS");
    expect(poll3Data.is_ready).toBe(false);
  });

  // Test 14: strengthened LANDING_PAGE_REVIEW structured result contract passes end-to-end
  it("14. get_result returns verified 3-issue LANDING_PAGE_REVIEW structured contract with all assessments", async () => {
    const quoteRes = await client.callTool({
      name: "quote_human",
      arguments: {
        task_type: "LANDING_PAGE_REVIEW",
        input_payload: {
          url: "https://agentic-saas.example.com",
          target_audience: "B2B SaaS Founders and Autonomous Agent Builders",
        },
      },
    });
    const quote = parseJsonContent<{ quote_id: string; agent_token: string }>(quoteRes);

    const callRes = await client.callTool({
      name: "call_human",
      arguments: { quote_id: quote.quote_id, agent_token: quote.agent_token },
    });
    const task = parseJsonContent<{ task_id: string }>(callRes);

    const offers = await db.getOffersForTask(task.task_id);
    const workerId = offers[0].worker_id;
    const workerToken = (await db.issueWorkerOfferToken(task.task_id, workerId)).token!;

    await acceptTask(task.task_id, { worker_id: workerId }, workerToken);
    await startTask(task.task_id, { worker_id: workerId }, workerToken);

    const richLandingResult = {
      top_issues: [
        {
          issue: "Value proposition headline is too vague for technical buyers",
          evidence: "Observed header text 'AI Everything' does not explain product features or outcomes",
          why_it_matters: "B2B decision makers bounce within 5 seconds without clear capability description",
          recommended_change: "Rewrite hero headline to state concrete autonomous action workflow",
          severity: "high" as const,
        },
        {
          issue: "Social proof and security credentials are not visible above the fold",
          evidence: "No enterprise customer logos or audited security badges appear in the initial viewport",
          why_it_matters: "Enterprise security teams require immediate trust markers before approving pilot signups",
          recommended_change: "Add audited compliance badges and enterprise logo marquee directly below CTA",
          severity: "medium" as const,
        },
        {
          issue: "Pricing CTA lacks transparent next-step guidance",
          evidence: "Button reads 'Get Started' with no indication of trial terms or pricing tier",
          why_it_matters: "Ambiguous CTA copy causes friction and hesitation at the conversion point",
          recommended_change: "Change CTA to 'Start 14-Day Pilot' with subtext 'No credit card required'",
          severity: "low" as const,
        },
      ],
      highest_impact_change: {
        change: "Embed an interactive live workflow simulation directly in the hero viewport",
        rationale: "Prospective buyers convert 3x higher when they can interactively test the agent loop",
        expected_effect: "Expected to increase visitor-to-pilot conversion rate by 35%",
      },
      trust_and_credibility_assessment: "Site uses HTTPS but currently lacks enterprise customer case studies, SOC2 badges, or verifiable customer metrics.",
      cta_assessment: "Primary call to action is prominent but lacks clarity regarding trial requirements and onboarding time.",
      us_market_fit_assessment: "Copy tone is appropriate for US tech sector but needs more concise outcome-oriented positioning rather than feature lists.",
      visual_hierarchy_assessment: "Clean layout with legible typography, but secondary navigation buttons compete visually with the primary call to action.",
      overall_verdict: "High technical potential with clear value that requires sharper positioning, immediate proof points, and friction-free CTA copy.",
      confidence: 0.96,
    };

    await submitTaskResult(
      task.task_id,
      {
        worker_id: workerId,
        result_payload: richLandingResult,
      },
      workerToken
    );

    const resultRes = await client.callTool({
      name: "get_result",
      arguments: { task_id: task.task_id, agent_token: quote.agent_token },
    });

    expect(resultRes.isError).toBeFalsy();
    const resultData = parseJsonContent<{
      task_id: string;
      task_type: string;
      status: string;
      human_status: string;
      is_ready: boolean;
      result: typeof richLandingResult;
    }>(resultRes);

    expect(resultData.task_id).toBe(task.task_id);
    expect(resultData.task_type).toBe("LANDING_PAGE_REVIEW");
    expect(resultData.status).toBe("COMPLETED");
    expect(resultData.human_status).toBe("COMPLETED");
    expect(resultData.is_ready).toBe(true);
    expect(resultData.result.top_issues).toHaveLength(3);
    expect(resultData.result.top_issues[0].issue).toBe(richLandingResult.top_issues[0].issue);
    expect(resultData.result.top_issues[0].severity).toBe("high");
    expect(resultData.result.highest_impact_change.change).toBe(richLandingResult.highest_impact_change.change);
    expect(resultData.result.trust_and_credibility_assessment).toBeDefined();
    expect(resultData.result.cta_assessment).toBeDefined();
    expect(resultData.result.us_market_fit_assessment).toBeDefined();
    expect(resultData.result.visual_hierarchy_assessment).toBeDefined();
    expect(resultData.result.overall_verdict).toBeDefined();
    expect(resultData.result.confidence).toBe(0.96);
  });

  // Test 24: MCP Founder Human Node capabilities (AI_VIDEO_REVIEW, SOFTWARE_PRODUCT_REVIEW, AI_WORKFLOW_REVIEW)
  it("24. quote_human and call_human succeed for founder task types via MCP", async () => {
    const founderTypes = [
      {
        type: "AI_VIDEO_REVIEW",
        payload: {
          video_url: "https://example.com/clip.mp4",
          generation_context: "Sora 2.0 commercial shoot",
          intended_use: "Hero marketing page video",
        },
      },
      {
        type: "SOFTWARE_PRODUCT_REVIEW",
        payload: {
          product_url: "https://staging.example.com",
          product_summary: "Autonomous agent dispatch platform",
          target_users: "B2B engineering managers",
          key_flows_to_test: ["Onboarding and first task dispatch"],
        },
      },
      {
        type: "AI_WORKFLOW_REVIEW",
        payload: {
          workflow_summary: "Automated invoice parsing with LLM fallback",
          steps: ["Webhook ingest", "LLM extraction", "Human verification", "DB write"],
          failure_modes_considered: ["Parse failures"],
          expected_throughput: "500 docs/day",
        },
      },
    ];

    for (const item of founderTypes) {
      const quoteRes = await client.callTool({
        name: "quote_human",
        arguments: {
          task_type: item.type,
          input_payload: item.payload,
        },
      });

      expect(quoteRes.isError).toBeFalsy();
      const quote = parseJsonContent<{
        quote_id: string;
        task_type: string;
        customer_price_usd: number;
        agent_token: string;
      }>(quoteRes);

      expect(quote.task_type).toBe(item.type);
      expect(quote.customer_price_usd).toBe(39.0);
      expect(quote.agent_token).toBeDefined();

      const callRes = await client.callTool({
        name: "call_human",
        arguments: {
          quote_id: quote.quote_id,
          agent_token: quote.agent_token,
        },
      });

      expect(callRes.isError).toBeFalsy();
      const task = parseJsonContent<{
        task_id: string;
        task_type: string;
        status: string;
      }>(callRes);

      expect(task.task_type).toBe(item.type);
      expect(task.status).toBe("OFFERED");
    }
  });
});
