import { Pool, PoolClient, types } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

// ✅ Return timestamps as raw ISO strings instead of JS Date objects.
// This prevents the pg driver from silently shifting timezone during
// Date construction. The frontend is responsible for parsing & display.
types.setTypeParser(1114, (val: string) => val);  // TIMESTAMP WITHOUT TZ
types.setTypeParser(1184, (val: string) => val);  // TIMESTAMP WITH TZ (timestamptz)

const sslConfig = (() => {
  if (process.env.DB_SSL !== 'true') return false;
  const caPath = process.env.DB_CA_PATH;
  if (caPath) {
    try {
      return {
        rejectUnauthorized: false,
        ca: fs.readFileSync(path.resolve(caPath)).toString(),
      };
    } catch {
      console.warn('⚠️  Could not read DB_CA_PATH, using SSL without CA cert');
    }
  }
  return { rejectUnauthorized: false };
})();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslConfig,
  // Keep min at 0 so the pool doesn't hold persistent idle connections
  // that cloud DBs (Supabase/Neon/Render) silently kill, causing
  // "Connection terminated unexpectedly" on the next query.
  min: 0,
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  // Idle connections are closed after 10s — well before cloud DB kills them
  idleTimeoutMillis: 10000,
  // Raised from 10s to 20s — dashboard fires 6 parallel queries; under load
  // the pool needs more headroom before giving up on a new connection.
  connectionTimeoutMillis: 20000,
  // TCP keepalive: sends a heartbeat packet so the OS/network never
  // silently drops a connection that pg-pool still thinks is alive.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('connect', (client) => {
  // ✅ Force UTC on every session so timestamp casts are always timezone-consistent.
  // Without this, bare strings like "2026-05-26T10:30:00" would be interpreted using
  // whatever the OS/cloud-DB default timezone is (varies by host).
  client.query("SET TIME ZONE 'UTC'").catch((err) =>
    console.warn('⚠️  Could not set session timezone:', err.message)
  );
  // Fires for every pooled connection, so not worth logging individually.
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
  // Do NOT exit the process on idle client errors. The pg pool will automatically remove
  // the errored client and create a new one when a query is issued.
  // Exiting here causes the entire backend to crash unnecessarily.
});

// ── Auto-retry every pool.query() call, app-wide ────────────────────────────
// The remote RDS connection intermittently blips (DNS resolution failures,
// connection timeouts) — previously only call sites explicitly wrapped in
// safeQuery() were protected, which meant hitting this on any of the ~500+
// unwrapped call sites (e.g. GET /salons/me) still 500'd on the first blip.
// Patching pool.query itself here means every call gets the same retry
// behavior for free, with zero changes needed in individual repositories.
// Only the plain Promise-returning form is used anywhere in this codebase
// (no callback-style pool.query calls), so wrapping it this way is safe.
const rawQuery: (...args: any[]) => Promise<any> = pool.query.bind(pool);
const retryingQuery = ((...args: any[]) => safeQuery(() => rawQuery(...args))) as typeof pool.query;

// ── Transaction scope (withPoolTransaction) ─────────────────────────────────
// Lets one multi-step operation that is spread over many repositories —
// each calling pool.query()/pool.connect() on its own — commit or roll back
// as a single unit, without threading a client through every call. While a
// scope is active in the current async context:
//   - pool.query() runs on the scope's connection, each statement inside its
//     own SAVEPOINT, so a failing statement that the caller catches and
//     ignores leaves the rest intact — exactly like autocommit;
//   - pool.connect() returns a stand-in client on the same connection whose
//     BEGIN / COMMIT / ROLLBACK become SAVEPOINT / RELEASE / ROLLBACK TO;
//   - statements are serialized, since one connection runs one at a time.
// Outside a scope nothing changes. Only used where all-or-nothing is
// required (recording a confirmed Payment Machine payment).
type TxScope = { client: PoolClient; active: boolean; queue: Promise<unknown>; seq: number };
const txScope = new AsyncLocalStorage<TxScope>();
const activeScope = (): TxScope | null => {
  const scope = txScope.getStore();
  return scope?.active ? scope : null;
};
const isCallbackCall = (args: any[]) => typeof args[args.length - 1] === 'function';
const statementText = (args: any[]) => String(typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '').trim().toUpperCase();
const emptyResult = (command: string) => ({ command, rowCount: 0, rows: [], fields: [], oid: 0 });

function serialize<T>(scope: TxScope, task: () => Promise<T>): Promise<T> {
  const run = scope.queue.then(task, task);
  scope.queue = run.catch(() => undefined);
  return run;
}

/** One statement inside the scope, behind its own savepoint. */
function scopedStatement(scope: TxScope, args: any[]): Promise<any> {
  return serialize(scope, async () => {
    const savepoint = `tx_scope_q${++scope.seq}`;
    await scope.client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await (scope.client.query as any)(...args);
      await scope.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (err) {
      await scope.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await scope.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      throw err;
    }
  });
}

/** pool.connect() inside a scope: its own transaction becomes a nested savepoint. */
function scopedClient(scope: TxScope): PoolClient {
  const sections: string[] = [];
  const query = (...args: any[]): Promise<any> => {
    if (!scope.active) return Promise.reject(new Error('Transaction scope already ended'));
    const text = statementText(args);
    if (/^(BEGIN|START TRANSACTION)\b/.test(text)) {
      const savepoint = `tx_scope_s${++scope.seq}`;
      sections.push(savepoint);
      return serialize(scope, () => scope.client.query(`SAVEPOINT ${savepoint}`)).then(() => emptyResult('BEGIN'));
    }
    if (/^(COMMIT|END)\b/.test(text)) {
      const savepoint = sections.pop();
      if (!savepoint) return Promise.resolve(emptyResult('COMMIT'));
      return serialize(scope, () => scope.client.query(`RELEASE SAVEPOINT ${savepoint}`)).then(() => emptyResult('COMMIT'));
    }
    if (/^ROLLBACK\s*;?$/.test(text)) {
      const savepoint = sections.pop();
      if (!savepoint) return Promise.resolve(emptyResult('ROLLBACK'));
      return serialize(scope, async () => {
        await scope.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await scope.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }).then(() => emptyResult('ROLLBACK'));
    }
    // The caller's own savepoints run as written, inside its section.
    if (/^(SAVEPOINT|RELEASE|ROLLBACK\s+TO)\b/.test(text)) {
      return serialize(scope, () => (scope.client.query as any)(...args));
    }
    return scopedStatement(scope, args);
  };
  return { query, release: () => undefined, on: () => undefined } as unknown as PoolClient;
}

pool.query = ((...args: any[]) => {
  const scope = activeScope();
  if (!scope || isCallbackCall(args)) return retryingQuery(...(args as [any]));
  return scopedStatement(scope, args);
}) as typeof pool.query;

const rawConnect = pool.connect.bind(pool) as () => Promise<PoolClient>;
pool.connect = ((...args: any[]) => {
  const scope = activeScope();
  if (!scope || args.length > 0) return (rawConnect as any)(...args);
  return Promise.resolve(scopedClient(scope));
}) as typeof pool.connect;

/**
 * Runs `fn` as one database transaction: every pool.query()/pool.connect()
 * it makes, however deep, commits together when it resolves and rolls back
 * together when it throws (or the connection dies). Joins an already active
 * scope instead of nesting. Side effects outside the database (messages,
 * sockets, queues) are not rolled back.
 */
export async function withPoolTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (activeScope()) return fn();
  const client = await rawConnect();
  const scope: TxScope = { client, active: true, queue: Promise.resolve(), seq: 0 };
  let destroy = false;
  try {
    await client.query('BEGIN');
    // Never wait forever on someone else's lock, and never leave locks held
    // by an abandoned scope.
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
    const result = await txScope.run(scope, fn);
    scope.active = false;
    await serialize(scope, () => client.query('COMMIT'));
    return result;
  } catch (err) {
    scope.active = false;
    try {
      await serialize(scope, () => client.query('ROLLBACK'));
    } catch {
      destroy = true; // connection is broken — don't return it to the pool
    }
    throw err;
  } finally {
    client.release(destroy ? new Error('transaction scope rollback failed') : undefined);
  }
}

export default pool;

/**
 * safeQuery — wraps any pool.query() call with auto-retry.
 *
 * WHY: Cloud databases (Supabase, Neon, Render, Railway, etc.) silently
 * terminate idle PostgreSQL connections. pg-pool doesn't detect this until
 * the next query attempt, causing "Connection terminated unexpectedly".
 * Two retries with a short backoff ride out short-lived DNS/connection
 * blips that a single immediate retry can still land inside of.
 *
 * USAGE:///
 *   const { rows } = await safeQuery(() => pool.query(sql, params));
 */
export async function safeQuery<T>(queryFn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await queryFn();
  } catch (err: any) {
    const isStaleConn =
      err?.message?.includes('Connection terminated unexpectedly') ||
      err?.message?.includes('terminating connection') ||
      err?.message?.includes('Connection terminated') ||
      err?.message?.includes('timeout exceeded when trying to connect') ||
      err?.code === 'ECONNRESET' ||
      err?.code === 'ENOTFOUND';

    if (retries > 0 && isStaleConn) {
      console.warn('🔁 [safeQuery] Stale DB connection detected — retrying query...');
      await new Promise((resolve) => setTimeout(resolve, 400));
      return safeQuery(queryFn, retries - 1);
    }
    throw err;
  }
}
