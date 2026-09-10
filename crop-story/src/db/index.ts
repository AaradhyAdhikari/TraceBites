import { Pool } from "pg";
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgresql://cropstory:cropstory@localhost:5433/cropstory";

// Next dev reloads modules on every edit; without this the pool count climbs
// until Postgres refuses connections.
const globalForDb = globalThis as unknown as { __cropStoryPool?: Pool };
const pool = globalForDb.__cropStoryPool ?? new Pool({ connectionString: url, max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__cropStoryPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
