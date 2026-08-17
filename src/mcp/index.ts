import { loadEnvConfig } from "@next/env";
import { startStdioServer } from "./server";

// Load environment variables (.env.local, .env, etc.)
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  console.error(
    "[human-tool MCP] Error: DATABASE_URL is required to run the MCP server. " +
      "MCP tasks must persist to the shared database so worker and dispatch processes can access them."
  );
  process.exit(1);
}

startStdioServer().catch((err) => {
  console.error("[human-tool MCP] Fatal error starting server:", err);
  process.exit(1);
});

