/**
 * Migration runner.
 *
 * Applies sql/*.sql in lexical order, once each, tracked in _migrations.
 * Deliberately plain SQL rather than generated artefacts: a fresh clone can
 * reach a working database with `npm run db:migrate` and no codegen step.
 *
 * For schema changes from here on, either add the next numbered file by hand or
 * use `npm run db:generate` (drizzle-kit) and move the generated file into sql/.
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const url = process.env.DATABASE_URL ?? "postgresql://tracebites:tracebites@localhost:5433/tracebites";

async function main() {
  const pool = new Pool({ connectionString: url });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const dir = join(process.cwd(), "sql");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const { rows } = await pool.query<{ name: string }>("SELECT name FROM _migrations");
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    // The ledger guards are idempotent by design (CREATE OR REPLACE / DROP IF
    // EXISTS) and re-run every time, so a dropped trigger cannot stay dropped.
    const alwaysRun = file.includes("ledger_guards");
    if (applied.has(file) && !alwaysRun) continue;

    const sql = readFileSync(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
      await client.query("COMMIT");
      console.log(`· applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`✗ ${file} failed`);
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log("migrations up to date");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
