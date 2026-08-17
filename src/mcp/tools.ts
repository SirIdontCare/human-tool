import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requestQuote } from "@/services/quotes";
import { createTaskFromQuote, getTaskResult } from "@/services/tasks";
import { ServiceError } from "@/lib/errors";

// Uniform tool error mapping: ServiceError passes through with its stable
// machine-readable code; unexpected internal exceptions are logged server-side
// and returned as a fixed public message (never the raw exception text).
function toToolError(err: unknown) {
  if (err instanceof ServiceError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: err.message,
              code: err.code,
              status: err.status,
              details: err.details,
            },
            null,
            2
          ),
        },
      ],
    };
  }
  console.error("[human-tool MCP] Internal error:", err);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: "Internal server error",
            code: "INTERNAL_ERROR",
            status: 500,
          },
          null,
          2
        ),
      },
    ],
  };
}

export function registerHumanCapabilityTools(server: McpServer) {
  // TOOL 1: quote_human
  server.tool(
    "quote_human",
    "Request a deterministic quote and quote-scoped capability credential (agent_token) for capability-matched human work. " +
      "Prefer a specific catalogue task type when one accurately fits (LANDING_PAGE_REVIEW, ARCHITECTURE_SANITY_CHECK, EXPERT_FACT_VERIFICATION, AI_VIDEO_REVIEW, SOFTWARE_PRODUCT_REVIEW, AI_WORKFLOW_REVIEW). " +
      "Use HUMAN_JUDGMENT_REQUEST when human judgment would materially improve the outcome but none of the specific task types fits. " +
      "Availability is NOT guaranteed: an unfulfillable HUMAN_JUDGMENT_REQUEST returns available: false and reason: NO_MATCHING_HUMAN_CAPABILITY.",
    {
      task_type: z
        .enum([
          "LANDING_PAGE_REVIEW",
          "ARCHITECTURE_SANITY_CHECK",
          "EXPERT_FACT_VERIFICATION",
          "AI_VIDEO_REVIEW",
          "SOFTWARE_PRODUCT_REVIEW",
          "AI_WORKFLOW_REVIEW",
          "HUMAN_JUDGMENT_REQUEST",
        ])
        .describe("The canonical task type code from the catalogue: LANDING_PAGE_REVIEW, ARCHITECTURE_SANITY_CHECK, EXPERT_FACT_VERIFICATION, AI_VIDEO_REVIEW, SOFTWARE_PRODUCT_REVIEW, AI_WORKFLOW_REVIEW, or HUMAN_JUDGMENT_REQUEST"),
      input_payload: z
        .record(z.unknown())
        .describe("Structured input payload meeting the schema of the specified task_type"),
    },
    async ({ task_type, input_payload }) => {
      try {
        const quote = await requestQuote({
          task_type,
          input_payload,
        });

        if (!quote.available) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    available: false,
                    reason: quote.reason || "NO_MATCHING_HUMAN_CAPABILITY",
                    task_type: quote.task_type,
                    message: quote.message || "No verified human capability is currently active for the requested expertise.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Safe agent-facing payload: quote metadata + raw capability credential
        const responseData = {
          available: quote.available,
          quote_id: quote.quote_id,
          task_type: quote.task_type,
          customer_price_usd: quote.customer_price_usd,
          estimated_minutes: quote.estimated_minutes,
          required_capability: quote.required_capability,
          expires_at: quote.expires_at,
          created_at: quote.created_at,
          agent_token: quote.agent_token,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return toToolError(err);
      }
    }
  );

  // TOOL 2: call_human
  server.tool(
    "call_human",
    "Create and dispatch a task from an unexpired quote using the quote-scoped agent capability credential. " +
      "capability-matched human workers matching the required capability will be offered the task. " +
      "Status Semantics: The initial status is OFFERED (human_status: 'WAITING_FOR_ACCEPTANCE'), meaning the task is created and dispatched to the worker queue; " +
      "no human worker has accepted or started work yet. Returns the created task ID, status, and human_status. Calling with an identical quote_id and valid agent_token is idempotent.",
    {
      quote_id: z
        .string()
        .min(1)
        .describe("The unique quote ID returned by quote_human"),
      agent_token: z
        .string()
        .min(1)
        .describe("The quote-scoped agent capability credential returned by quote_human"),
    },
    async ({ quote_id, agent_token }) => {
      try {
        const task = await createTaskFromQuote({ quote_id }, "", agent_token);

        const humanStatus =
          task.status === "OFFERED"
            ? "WAITING_FOR_ACCEPTANCE"
            : task.status === "ACCEPTED"
            ? "ACCEPTED_AWAITING_START"
            : task.status === "IN_PROGRESS"
            ? "IN_PROGRESS"
            : task.status === "COMPLETED"
            ? "COMPLETED"
            : task.status;

        // Safe agent-facing payload: strictly no worker credentials or internal margins
        const responseData = {
          task_id: task.task_id,
          quote_id: task.quote_id,
          task_type: task.task_type,
          status: task.status,
          human_status: humanStatus,
          customer_price_usd: task.customer_price_usd,
          estimated_minutes: task.estimated_minutes,
          is_existing: Boolean(task.is_existing),
          created_at: task.created_at,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return toToolError(err);
      }
    }
  );

  // TOOL 3: get_result
  server.tool(
    "get_result",
    "Check progress and retrieve the structured human outcome for a task. " +
      "Requires the agent_token capability credential. If the task is not yet completed (OFFERED: waiting for worker acceptance; " +
      "ACCEPTED: worker accepted, awaiting start; IN_PROGRESS: worker currently reviewing), returns a structured not-ready state with " +
      "current status and human_status ('WAITING_FOR_ACCEPTANCE' | 'ACCEPTED_AWAITING_START' | 'IN_PROGRESS') so the agent can reason about progress. " +
      "If COMPLETED, returns the structured verified outcome payload.",
    {
      task_id: z
        .string()
        .min(1)
        .describe("The unique task ID returned by call_human"),
      agent_token: z
        .string()
        .min(1)
        .describe("The agent capability token for this task"),
    },
    async ({ task_id, agent_token }) => {
      try {
        const result = await getTaskResult(task_id, agent_token);

        const responseData = {
          task_id: result.task_id,
          task_type: result.task_type,
          status: result.status,
          human_status: "COMPLETED",
          is_ready: true,
          result: result.result,
          submitted_at: result.submitted_at,
          accepted_at: result.accepted_at,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        if (err instanceof ServiceError && err.code === "RESULT_NOT_READY") {
          // If the task is not completed yet, return a structured machine-usable
          // not-ready state (NOT an MCP error/crash) so the agent can reason.
          const taskStatus = (err.details as any)?.status || "IN_PROGRESS";
          const humanStatus =
            taskStatus === "OFFERED"
              ? "WAITING_FOR_ACCEPTANCE"
              : taskStatus === "ACCEPTED"
              ? "ACCEPTED_AWAITING_START"
              : taskStatus === "IN_PROGRESS"
              ? "IN_PROGRESS"
              : taskStatus;

          return {
            isError: false,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    task_id,
                    status: taskStatus,
                    human_status: humanStatus,
                    is_ready: false,
                    message: err.message,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        return toToolError(err);
      }
    }
  );
}
