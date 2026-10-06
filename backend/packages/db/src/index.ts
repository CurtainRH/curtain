import { Pool, type PoolClient } from "pg";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in a transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Multi-statement SQL, no parameters (migrations). */
  exec(text: string): Promise<void>;
}

export const MIGRATIONS_DIR = join(import.meta.dir, "../../../db/migrations");

export function pgPoolDb(pool: Pool): Db {
  const wrap = (client: Pool | PoolClient): Db => ({
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => {
      const res = await client.query(text, params);
      return res.rows as T[];
    },
    exec: async (text: string): Promise<void> => {
      await client.query(text);
    },
    transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
      const conn = client instanceof Pool ? await client.connect() : client;
      const shouldRelease = client instanceof Pool;
      try {
        await conn.query("BEGIN");
        const res = await fn(wrap(conn));
        await conn.query("COMMIT");
        return res;
      } catch (err) {
        await conn.query("ROLLBACK");
        throw err;
      } finally {
        if (shouldRelease) {
          (conn as PoolClient).release();
        }
      }
    },
  });
  return wrap(pool);
}

/** Production adapter over pg.Pool (compatible with PgBouncer, Supabase, and AWS connection poolers). */
export async function createDb(url = process.env["DATABASE_URL"]): Promise<Db> {
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  return pgPoolDb(pool);
}

export const bunSqlDb = createDb;

/**
 * Applies `dir`/*.sql in filename order, once each, recorded in schema_migrations. Each file
 * runs in its own transaction; a failure rolls back and throws.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const applied = new Set((await db.query<{ filename: string }>("SELECT filename FROM schema_migrations")).map((r) => r.filename));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await Bun.file(join(dir, file)).text();
    await db.transaction(async (tx) => {
      await tx.exec(text);
      await tx.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    });
    ran.push(file);
  }
  return ran;
}
