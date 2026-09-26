import { Pool } from "pg";
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgresql://tracebites:tracebites@localhost:5433/tracebites";

// Next dev reloads modules on every edit; without this the pool count climbs
// until Postgres refuses connections.
const globalForDb = globalThis as unknown as { __traceBitesPool?: Pool };
const pool = globalForDb.__traceBitesPool ?? new Pool({ connectionString: url, max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__traceBitesPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
