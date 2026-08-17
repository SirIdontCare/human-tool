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
