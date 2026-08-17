import fs from "fs";
import path from "path";
import { Pool, PoolClient } from "pg";
import { loadEnvConfig } from "@next/env";

// Load Next.js environment variables (.env, .env.local, etc.)
loadEnvConfig(process.cwd());

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
