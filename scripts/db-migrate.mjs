#!/usr/bin/env node
/**
 * Applies `apps/customer-web/src/server/db/schema.sql` to the database in `DATABASE_URL`.
 *
 *   npm run db:migrate                                  # embedded, ./.data/snapup
 *   DATABASE_URL='file:./.data/snapup' npm run db:migrate
 *   DATABASE_URL='postgresql://…'      npm run db:migrate
 *
 * Every statement in the schema is idempotent (`CREATE TABLE IF NOT EXISTS`, and so on), so
 * running this against an already-migrated database is a no-op rather than an error. That
 * is deliberate: a migration you are afraid to re-run is one that gets skipped during an
 * incident.
 *
 * This is not a migration *framework*. There is no version table and no down-migrations,
 * because there is one schema and it has never been deployed. The moment this schema is
 * carrying real trading data, altering a column becomes a versioned migration and this
 * script should be replaced rather than extended.
 */

import { readFile, mkdir, rm, readFile as read } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { acquireDatabaseLock } from './db-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCHEMA_PATH = join(ROOT, 'apps', 'customer-web', 'src', 'server', 'db', 'schema.sql');

/** Matches `embeddedDataDir` in `db/embedded.ts`; the two must agree on what a URL means. */
const DEFAULT_URL = 'file:./.data/snapup';

/**
 * Released in `main`'s `finally`, after the engine is closed.
 *
 * Order matters: handing the lock back while PGlite still holds the directory would
 * advertise it as free a moment before it is, which is the same collision this lock
 * exists to prevent, just from the other side.
 */
let releaseLock = () => {};

/** Set for the embedded engine only; hosted Postgres has no handle to close. */
let closeDatabase = async () => {};

function embeddedDataDir(url) {
  for (const prefix of ['pglite://', 'file:']) {
    if (url.startsWith(prefix)) {
      const path = url.slice(prefix.length);
      return path.startsWith('//') ? path.slice(2) : path;
    }
  }
  return null;
}

/**
 * Splits the schema into individual statements.
 *
 * The HTTP driver sends one statement per request, so the file has to be split rather than
 * shipped whole.
 *
 * Two things this has to survive, both of which a naive `split(';')` gets wrong:
 *
 *   - **Line comments**, which are full of prose, and prose is where a stray semicolon
 *     would otherwise cut a statement in half.
 *   - **Dollar-quoted blocks.** The `DO $$ … END $$;` guards that add constraints
 *     idempotently contain semicolons *inside* the body. Splitting on those produces
 *     fragments that are not valid SQL, and the migration fails on a file that is
 *     perfectly correct.
 *
 * Single-quoted literals are tracked for the same reason — the regex constraint on
 * `api_key_ref` contains no semicolon today, but relying on that is relying on nobody ever
 * adding one.
 */
function splitStatements(sql) {
  const withoutComments = sql
    // Normalised before anything else. Git checks this file out with CRLF on Windows, and
    // in JavaScript `.` does not match `\r` — it is a line terminator — so `/--.*$/`
    // silently strips nothing on a CRLF file. The unstripped comments then reach the
    // scanner below, where the one describing the scrypt format ('scrypt$N$r$p$salt$hash')
    // reads as a dollar-quote opener and swallows the rest of the schema. It surfaces as
    // "syntax error at end of input", which points nowhere near the cause.
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let dollarTag = null;

  for (let index = 0; index < withoutComments.length; index += 1) {
    const rest = withoutComments.slice(index);

    if (dollarTag) {
      current += withoutComments[index];
      if (rest.startsWith(dollarTag)) {
        current += dollarTag.slice(1);
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    if (inSingleQuote) {
      current += withoutComments[index];
      if (withoutComments[index] === "'") inSingleQuote = false;
      continue;
    }

    // `$$` or `$tag$` opens a dollar-quoted body that runs to the matching closer.
    const opener = /^\$[A-Za-z_]*\$/.exec(rest);
    if (opener) {
      dollarTag = opener[0];
      current += dollarTag;
      index += dollarTag.length - 1;
      continue;
    }

    if (withoutComments[index] === "'") {
      inSingleQuote = true;
      current += withoutComments[index];
      continue;
    }

    if (withoutComments[index] === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }

    current += withoutComments[index];
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** First few words, for a progress line that identifies the statement without dumping it. */
function describe(statement) {
  return statement.split(/\s+/).slice(0, 4).join(' ');
}

async function connect(url) {
  const dataDir = embeddedDataDir(url);
  if (!dataDir) {
    console.log(`Target: hosted Postgres\n`);
    return neon(url);
  }

  const absolute = resolve(ROOT, dataDir);
  await mkdir(absolute, { recursive: true });
  // Taken, not merely checked. An earlier version of this script read the lock but
  // never wrote one, then cleared `postmaster.pid` regardless — so migrating against a
  // live dev server removed the running postmaster’s interlock and started a second
  // one on the same write-ahead log. PGlite ships no `pg_resetwal`, so the directory
  // that produced was gone for good. `acquireDatabaseLock` refuses while a live holder
  // exists, and clears a stale pid file only once it owns the directory.
  releaseLock = acquireDatabaseLock(absolute);
  console.log(`Target: embedded Postgres at ${absolute}\n`);


  const { PGlite } = await import('@electric-sql/pglite');
  const database = await PGlite.create(absolute);
  closeDatabase = () => database.close();
  return async (statement, ...values) => {
    const result = await database.query(statement, values.length ? values : undefined);
    return result.rows;
  };
}

async function main() {
  const url = process.env.DATABASE_URL ?? DEFAULT_URL;

  if (!process.env.DATABASE_URL) {
    console.log(`DATABASE_URL is not set — defaulting to ${DEFAULT_URL}\n`);
    console.log('That is a real PostgreSQL engine running in-process and persisted to disk,');
    console.log('so accounts and stores survive a restart with nothing to install. Point');
    console.log('DATABASE_URL at hosted Postgres when you outgrow one machine.\n');
  }

  const schema = await readFile(SCHEMA_PATH, 'utf8');
  const statements = splitStatements(schema);
  const sql = await connect(url);

  console.log(`Applying ${statements.length} statements from schema.sql\n`);

  for (const statement of statements) {
    process.stdout.write(`  ${describe(statement)} … `);
    await sql(statement);
    console.log('ok');
  }

  // Read the schema back rather than trusting that the writes meant what they said. A
  // migration that reports success and leaves no tables is the failure worth catching here.
  const tables = await sql(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`
  );

  console.log(`\nSchema applied. Tables now present: ${tables.map((r) => r.table_name).join(', ')}`);
  console.log('\nThe database starts empty — no seed data is inserted, deliberately.');
  console.log('A seeded store carries no surveyed coordinates and no authorised network, so');
  console.log('it would refuse every shopper. Register the first store and its real gateway');
  console.log('IP through the admin console at /stores, and create the first console account');
  console.log('at /signup — the first one becomes the owner.');
}

main()
  .catch((error) => {
    console.error('\nMigration failed:', error.message);
    // `exitCode` rather than `exit`, so the cleanup below still runs. Exiting outright
    // would skip it and leave a lock file and a live postmaster behind on every failed
    // run, and the next invocation would meet a lock held by a PID that no longer exists.
    process.exitCode = 1;
  })
  .finally(async () => {
    // Close before releasing. Handing the lock back while PGlite still holds the
    // directory advertises it as free a moment before it is.
    await closeDatabase().catch(() => {});
    releaseLock();
  });
