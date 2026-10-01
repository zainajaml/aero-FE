import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  application_name: "aero-zenith-flow-backend",
});

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type Database = typeof db;
/** A database handle usable both outside and inside a transaction. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
