import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerHumanCapabilityTools } from "./tools";
import { db } from "../db";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "human-tool",
    version: "0.1.0",
  });

  registerHumanCapabilityTools(server);

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  let isClosing = false;
  const shutdown = async () => {
    if (isClosing) return;
    isClosing = true;

    try {
      await server.close();
    } catch {
      // ignore on exit
    }

    try {
      await db.close();
    } catch {
      // ignore on exit
    }

    process.exit(0);
  };

  // Handle process termination signals
  process.on("SIGINT", () => {
    shutdown().catch(() => {});
  });
  process.on("SIGTERM", () => {
    shutdown().catch(() => {});
  });

  // Handle transport / client disconnection
  transport.onclose = () => {
    shutdown().catch(() => {});
  };
  server.server.onclose = () => {
    shutdown().catch(() => {});
  };
  process.stdin.on("close", () => {
    shutdown().catch(() => {});
  });
  process.stdin.on("end", () => {
    shutdown().catch(() => {});
  });

  await server.connect(transport);
  console.error("[human-tool MCP] Server connected via stdio transport");
}

