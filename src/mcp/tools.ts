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
    "Request a deterministic quote and quote-scoped capability credential (agent_token) for qualified human work. " +
      "Use when qualified human judgment would materially improve reliability, AI confidence is insufficient, " +
      "independent verification is valuable, or the task requires human capability the model cannot reliably provide. " +
      "Supported task_types: LANDING_PAGE_REVIEW, ARCHITECTURE_SANITY_CHECK, EXPERT_FACT_VERIFICATION.",
    {
      task_type: z
        .enum([
          "LANDING_PAGE_REVIEW",
          "ARCHITECTURE_SANITY_CHECK",
          "EXPERT_FACT_VERIFICATION",
        ])
        .describe("The canonical task type code from the catalogue: LANDING_PAGE_REVIEW, ARCHITECTURE_SANITY_CHECK, or EXPERT_FACT_VERIFICATION"),
      input_payload: z
        .record(z.unknown())
        .describe("Structured input payload meeting the schema of the specified task_type (e.g. for LANDING_PAGE_REVIEW: { url, target_audience }; for ARCHITECTURE_SANITY_CHECK: { architecture_summary, components, expected_scale }; for EXPERT_FACT_VERIFICATION: { claim, context })"),
    },
    async ({ task_type, input_payload }) => {
      try {
        const quote = await requestQuote({
          task_type,
          input_payload,
        });

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
    "Create and dispatch a verified human task from an unexpired quote using the quote-scoped agent capability credential. " +
      "Qualified human workers matching the required capability will be offered the task. " +
      "Returns the created task ID and status. Calling with an identical quote_id and valid agent_token is idempotent.",
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

        // Safe agent-facing payload: strictly no worker credentials or internal margins
        const responseData = {
          task_id: task.task_id,
          quote_id: task.quote_id,
          task_type: task.task_type,
          status: task.status,
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
    "Check progress and retrieve the verified structured human outcome for a task. " +
      "Requires the agent_token capability credential. If the task is still in progress (OFFERED, ACCEPTED, IN_PROGRESS), " +
      "returns a structured not-ready state with current progress so the agent can reason about next steps. " +
      "If COMPLETED, returns the verified structured result payload.",
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
          return {
            isError: false,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    task_id,
                    status: taskStatus,
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
