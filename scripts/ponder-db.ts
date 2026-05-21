/**
 * Ponder DB Inspector & Reset Tool
 *
 * Usage:
 *   RAILWAY_DB_TARGET=postgresql://... npx ts-node scripts/ponder-db.ts
 *   RAILWAY_DB_TARGET=postgresql://... npx ts-node scripts/ponder-db.ts --reset-sync
 *   RAILWAY_DB_TARGET=postgresql://... npx ts-node scripts/ponder-db.ts --reset-all
 *
 *   Or pass the URL as the first argument:
 *   npx ts-node scripts/ponder-db.ts postgresql://... [--reset-sync] [--reset-all]
 *
 * Modes:
 *   (default)     Inspect — list all ponder internal tables and row counts
 *   --reset-sync  Drop corrupted sync state (intervals, logs, factory_addresses)
 *                 while keeping the RPC cache (blocks, transactions, rpc_request_results).
 *                 Also drops all prepare-N and production-N application schemas.
 *                 Use this to fix a db1 that was indexed by 0.16.x and has missing events.
 *   --reset-all   Drop everything ponder-related including the RPC cache. Full clean slate.
 */

import { Client } from "pg";
import { createInterface } from "readline";

const args = process.argv.slice(2);
const urlArg = args.find(
  (a) => a.startsWith("postgresql://") || a.startsWith("postgres://")
);
const DB_URL = process.env.RAILWAY_DB_TARGET ?? process.env.DATABASE_URL ?? urlArg;
const MODE = args.includes("--reset-all")
  ? "reset-all"
  : args.includes("--reset-sync")
  ? "reset-sync"
  : "inspect";

if (!DB_URL) {
  console.error(
    "Error: provide RAILWAY_DB_TARGET env var or pass the URL as first argument"
  );
  process.exit(1);
}

const client = new Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

async function getRowCount(qualifiedTable: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(*) AS count FROM ${qualifiedTable}`
  );
  return Number(rows[0].count);
}

async function getPonderSchemas(): Promise<string[]> {
  const { rows } = await client.query<{ schema_name: string }>(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name ~ '^(prepare|production)-[0-9]+'
    ORDER BY schema_name
  `);
  return rows.map((r) => r.schema_name);
}

async function inspect(): Promise<void> {
  const { rows: tables } = await client.query<{ schema: string; tablename: string }>(`
    SELECT schemaname AS schema, tablename
    FROM pg_tables
    WHERE tablename LIKE '_ponder%'
       OR schemaname LIKE 'ponder%'
    ORDER BY schemaname, tablename
  `);

  if (tables.length === 0) {
    const { rows: schemas } = await client.query(
      `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`
    );
    console.log("No ponder internal tables found.");
    console.log("Available schemas:", schemas.map((s: any) => s.schema_name).join(", "));
    return;
  }

  console.log("\n=== Ponder Internal Tables ===\n");

  for (const { schema, tablename } of tables) {
    const qualified = `"${schema}"."${tablename}"`;
    const count = await getRowCount(qualified);
    console.log(`\n── ${schema}.${tablename} (${count} rows)`);

    if (count > 0) {
      const { rows } = await client.query(`SELECT * FROM ${qualified} LIMIT 10`);
      const trimmed = rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => {
            const s =
              typeof v === "object" && v !== null
                ? JSON.stringify(v)
                : String(v ?? "");
            return [k, s.length > 120 ? s.slice(0, 120) + "…" : s];
          })
        )
      );
      console.table(trimmed);
    }
  }

  const appSchemas = await getPonderSchemas();
  if (appSchemas.length > 0) {
    console.log(`\n=== Application Schemas (${appSchemas.length}) ===\n`);
    console.log(appSchemas.join(", "));
  }
}

// These ponder_sync tables were corrupted by 0.16.x dropping same-block factory events.
// Dropping them forces 0.15.18 to re-fetch logs and re-discover factory addresses cleanly.
const CORRUPTED_SYNC_TABLES = [
  "ponder_sync.intervals",         // marks blocks as already fetched — core corruption
  "ponder_sync.logs",              // missing same-block events for factory positions
  "ponder_sync.factory_addresses", // may be missing addresses from same-block discovery
];

// These ponder_sync tables are safe to keep — they were populated correctly
// and contain valuable cached data that speeds up re-indexing.
const SAFE_SYNC_TABLES = [
  "ponder_sync.blocks",              // block headers, unaffected by event dropping
  "ponder_sync.transactions",        // transaction data, unaffected
  "ponder_sync.rpc_request_results", // cached eth_call results — most valuable to keep
  "ponder_sync.traces",
  "ponder_sync.transaction_receipts",
  "ponder_sync.kysely_migration",
  "ponder_sync.kysely_migration_lock",
  "ponder_sync.factories",
];

async function resetSync(): Promise<void> {
  console.log("\n=== Reset Plan (--reset-sync) ===\n");
  console.log("This fixes a database that was indexed by ponder 0.16.x.");
  console.log("It drops the corrupted sync state while keeping the RPC cache.\n");

  const appSchemas = await getPonderSchemas();

  console.log("TRUNCATE (corrupted sync state):");
  CORRUPTED_SYNC_TABLES.forEach((t) => console.log(`  ${t}`));

  console.log("\nKEEP (clean RPC cache):");
  SAFE_SYNC_TABLES.forEach((t) => console.log(`  ${t}`));

  if (appSchemas.length > 0) {
    console.log(`\nDROP SCHEMAS (${appSchemas.length} application schemas with 0.16.x data):`);
    console.log(" ", appSchemas.join(", "));
  }

  console.log(
    "\n0.15.18 will re-fetch logs and factory addresses from scratch,\n" +
    "but reuse cached block headers and eth_call results for a faster sync.\n"
  );

  const ok = await confirm("Proceed?");
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  for (const table of CORRUPTED_SYNC_TABLES) {
    const [schema, tablename] = table.split(".");
    try {
      await client.query(`TRUNCATE TABLE "${schema}"."${tablename}" CASCADE`);
      console.log(`  ✓ truncated ${table}`);
    } catch (e: any) {
      console.log(`  ⚠ skipped ${table}: ${e.message}`);
    }
  }

  for (const schema of appSchemas) {
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    console.log(`  ✓ dropped schema ${schema}`);
  }

  console.log("\nDone. Start ponder 0.15.18 — it will re-index correctly using the warm RPC cache.");
}

async function resetAll(): Promise<void> {
  const { rows: tables } = await client.query<{ schema: string; tablename: string }>(`
    SELECT schemaname AS schema, tablename
    FROM pg_tables
    WHERE tablename LIKE '_ponder%'
       OR schemaname LIKE 'ponder%'
    ORDER BY schemaname, tablename
  `);

  const appSchemas = await getPonderSchemas();

  console.log("\n=== Reset Plan (--reset-all) ===\n");
  console.log("DROP everything — all sync state, all RPC cache, all application schemas.");
  console.log("This is equivalent to a completely fresh database.\n");

  tables.forEach(({ schema, tablename }) => console.log(`  DROP: ${schema}.${tablename}`));
  appSchemas.forEach((s) => console.log(`  DROP SCHEMA: ${s}`));

  const ok = await confirm("\nProceed?");
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  for (const { schema, tablename } of tables) {
    await client.query(`TRUNCATE TABLE "${schema}"."${tablename}" CASCADE`);
    console.log(`  ✓ truncated ${schema}.${tablename}`);
  }

  for (const schema of appSchemas) {
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    console.log(`  ✓ dropped schema ${schema}`);
  }

  console.log("\nDone. Fresh start — ponder will re-fetch everything from RPC.");
}

try {
  await client.connect();

  if (MODE === "inspect")    await inspect();
  if (MODE === "reset-sync") await resetSync();
  if (MODE === "reset-all")  await resetAll();
} finally {
  await client.end();
}
