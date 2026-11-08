import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import pg, { type Pool, type PoolClient, type QueryResultRow } from "pg";

// numeric and int8 arrive as strings by default; this app only stores small
// money values and counts, so plain numbers are safe.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);

const globalForPool = globalThis as unknown as { pgPool?: Pool };

// pg treats sslmode=require as verify-full and warns on every connection; Neon
// URLs carry require, so ask for verify-full explicitly (same behavior, no warning).
function withVerifiedSsl(url: string | undefined) {
  return url?.replace(/([?&])sslmode=(?:prefer|require|verify-ca)/, "$1sslmode=verify-full");
}

function pool() {
  if (!globalForPool.pgPool) {
    // the dashboard runs about a dozen queries at once; Neon's pooler endpoint takes many more
    globalForPool.pgPool = new pg.Pool({
      connectionString: withVerifiedSsl(process.env.DATABASE_URL),
      max: 10,
      idleTimeoutMillis: 5_000, // free idle clients fast; many instances share the pooler
      connectionTimeoutMillis: 10_000, // fail instead of hanging when Neon wakes from scale-to-zero slowly
    });
    // an idle client dropped by Neon/PgBouncer emits 'error'; unhandled, it kills the process
    globalForPool.pgPool.on("error", (e) => console.error("pg pool idle client error", e.message));
    // lets Vercel Fluid compute close idle clients before suspending the function
    attachDatabasePool(globalForPool.pgPool);
  }
  return globalForPool.pgPool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  return (await pool().query<T>(text, params)).rows;
}

/** Runs `fn` inside a transaction on one pooled connection. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Date | string | null → ISO string. */
export const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);
