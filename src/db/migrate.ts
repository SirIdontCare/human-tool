import fs from "fs";
import path from "path";
import { Pool, PoolClient } from "pg";
import { loadEnvConfig } from "@next/env";

// Load Next.js environment variables (.env, .env.local, etc.)
loadEnvConfig(process.cwd());

// Migration 004 reconciles legacy drift destructively. Before it is applied to
// a database where it is not yet applied, run a safety preflight so paid
// customer deliverables are never silently deleted or corrupted:
//
//  A. A duplicate quote_id group containing MORE THAN ONE task_result would
//     lose a paid result during dedup -> ABORT with a clear operator error.
//  B. Legacy status SUBMITTED without a task_result would silently become a
//     valid COMPLETED task -> ABORT with a clear operator error.
//
// Fresh databases and databases where 004 is already applied pass naturally.
export const PREFLIGHT_MIGRATION = "004_security_contract_reconciliation";

export type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;

export async function preflightMigration004(query: QueryFn): Promise<void> {
  const dupResultRows = (await query(
    `SELECT t.quote_id, count(DISTINCT t.id)::int AS task_count, count(r.id)::int AS result_count
     FROM tasks t
     JOIN task_results r ON r.task_id = t.id
     GROUP BY t.quote_id
     HAVING count(DISTINCT t.id) > 1 AND count(r.id) > 1`
  )) as Array<{ quote_id: string; task_count: number; result_count: number }>;

  if (dupResultRows.length > 0) {
    throw new Error(
      "PREFLIGHT BLOCKED migration 004: duplicate quote_id groups contain multiple paid results " +
        `(quote_ids: ${dupResultRows.map((r) => r.quote_id).join(", ")}). ` +
        "Reconcile manually before applying 004 — paid deliverables must never be deleted."
    );
  }

  const orphanSubmitted = (await query(
    `SELECT id FROM tasks WHERE status = 'SUBMITTED' AND id NOT IN (SELECT task_id FROM task_results) LIMIT 1`
  )) as Array<{ id: string }>;

  if (orphanSubmitted.length > 0) {
    throw new Error(
      "PREFLIGHT BLOCKED migration 004: legacy status SUBMITTED exists without a task_result " +
        `(task_id: ${orphanSubmitted[0].id}). Reconcile explicitly before applying 004 — ` +
        "it must not silently become a valid COMPLETED task."
    );
  }
}

export async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL is missing in production. Cannot run migrations.");
    }
    console.log("No DATABASE_URL found. Skipping PostgreSQL migrations (in-memory mode).");
    return;
  }

  console.log("Connecting to PostgreSQL to run migrations...");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? false : true,
  });

  try {
    // 1. Ensure schema_migrations table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(64) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Query already applied migrations
    const appliedRes = await pool.query(`SELECT version FROM schema_migrations ORDER BY version ASC`);
    const appliedVersions = new Set(appliedRes.rows.map((r) => r.version));

    // 3. Read migration files from migrations directory
    const migrationsDir = path.join(process.cwd(), "migrations");
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory '${migrationsDir}' does not exist.`);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    console.log(`Discovered ${files.length} migration files in migrations/.`);

    for (const file of files) {
      const version = path.basename(file, ".sql");
      if (appliedVersions.has(version)) {
        console.log(`[SKIPPED] Migration ${file} is already applied.`);
        continue;
      }

      console.log(`[APPLYING] Migration ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");

        // Safety preflight: migration 004 is destructive on drifted databases.
        if (version === PREFLIGHT_MIGRATION) {
          await preflightMigration004(async (sql, params: unknown[] = []) => {
            const res = await client.query(sql, params);
            return res.rows;
          });
        }

        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW())`,
          [version]
        );
        await client.query("COMMIT");
        console.log(`[SUCCESS] Migration ${file} applied and recorded in schema_migrations.`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[FAILED] Migration ${file} failed:`, err);
        throw err;
      } finally {
        client.release();
      }
    }

    console.log("All database schema migrations completed successfully!");
  } catch (err) {
    console.error("Database migration runner failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigration();
}

export default runMigration;
