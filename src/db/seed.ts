import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { loadEnvConfig } from "@next/env";

// Load Next.js environment variables (.env, .env.local, .env.development, etc.)
loadEnvConfig(process.cwd());

async function runSeed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("No DATABASE_URL found. Skipping live PostgreSQL seed (in-memory mode auto-seeded).");
    return;
  }

  console.log("Connecting to PostgreSQL to run seed data...");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  try {
    const seedSql = fs.readFileSync(path.join(__dirname, "seed.sql"), "utf-8");
    await pool.query(seedSql);
    console.log("Database seed completed successfully!");
  } catch (err) {
    console.error("Database seed failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runSeed();
}

export default runSeed;
