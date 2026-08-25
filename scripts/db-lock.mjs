/**
 * The command-line half of the embedded-database lock.
 *
 * This mirrors `apps/customer-web/src/server/db/lock.ts` — same file, same format, same
 * PID semantics — so the app and the scripts exclude each other rather than each guarding
 * against a hazard the other cannot see.
 *
 * ## Why this file exists
 *
 * It did not, and the omission destroyed a data directory. `db-migrate.mjs` *read* the
 * lock but never *wrote* one, then deleted `postmaster.pid` unconditionally on the way in.
 * Run a migration while the dev server is up and the sequence is: the live postmaster's
 * interlock file is removed, PGlite happily starts a second postmaster on the same WAL,
 * and both write it. The directory came back as
 * `PANIC: could not locate a valid checkpoint record` — unopenable, and unrecoverable
 * because PGlite ships no `pg_resetwal`.
 *
 * A lock that is checked but not taken only protects other people from you. Taking it is
 * the half that protects the database.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCK_FILE = 'snapup.lock';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists under another user, which still counts as alive. Only ESRCH
    // — no such process — makes a lock stale.
    return error.code === 'EPERM';
  }
}

/**
 * Take the lock on `dataDir`, or throw. Returns a release function.
 *
 * Call the release only after the database has been closed. Releasing while the engine is
 * still open advertises the directory as free before it is, which is the same collision
 * from the other direction.
 */
export function acquireDatabaseLock(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const lockPath = join(dataDir, LOCK_FILE);

  try {
    const holder = Number(readFileSync(lockPath, 'utf8').trim());
    if (Number.isInteger(holder) && holder !== process.pid && isAlive(holder)) {
      throw new Error(
        `The embedded database at ${dataDir} is open in process ${holder}.\n\n` +
          `Stop the dev server before running this, or a second postmaster would write the ` +
          `same write-ahead log and corrupt it beyond what PGlite can repair.\n\n` +
          `If process ${holder} is genuinely gone, delete ${lockPath} and retry.`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The embedded database')) throw error;
    // ENOENT or an unreadable lock: nothing live to respect.
  }

  writeFileSync(lockPath, String(process.pid), 'utf8');

  // Only now — with the lock held, so no live SnapUp process can be holding the directory
  // — is a leftover `postmaster.pid` provably debris from a process that is gone. PGlite
  // blocks forever rather than erroring when it finds one, so clearing it here is what
  // lets the database come back after a crash or a force-kill.
  rmSync(join(dataDir, 'postmaster.pid'), { force: true });

  return () => {
    try {
      if (readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      /* already gone, or taken over */
    }
  };
}
