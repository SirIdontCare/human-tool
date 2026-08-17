import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { loadEnvConfig } from "@next/env";

// Load Next.js environment variables (.env, .env.local, .env.development, etc.)
loadEnvConfig(process.cwd());

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("No DATABASE_URL found. Skipping live PostgreSQL migration (in-memory mode enabled).");
    return;
  }

  console.log("Connecting to PostgreSQL to run migrations...");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
    await pool.query(schemaSql);

    // Clean up any duplicates from earlier pre-constraint test runs
    await pool.query(`
      DELETE FROM tasks WHERE id NOT IN (
        SELECT MIN(id) FROM tasks GROUP BY quote_id
      );
      DELETE FROM task_offers WHERE id NOT IN (
        SELECT MIN(id) FROM task_offers GROUP BY task_id, worker_id
      );

      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agent_token_hash VARCHAR(64);
      ALTER TABLE task_offers ADD COLUMN IF NOT EXISTS worker_token_hash VARCHAR(64);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_quote_id_unique ON tasks(quote_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_offers_unique ON task_offers(task_id, worker_id);
    `);

    console.log("Database schema migration completed successfully!");
  } catch (err) {
    console.error("Database migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigration();
}

export default runMigration;
