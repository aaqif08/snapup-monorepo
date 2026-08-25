import 'server-only';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * An exclusive lock on an embedded-database directory.
 *
 * ## Why this exists
 *
 * PGlite does not lock its data directory. Two processes can open the same one, and
 * neither is told: each reads whatever was last flushed and writes its own view back. The
 * loser's writes are silently reverted.
 *
 * That is not hypothetical — it happened while this feature was being built. A script that
 * opened the directory to *inspect* it, alongside the running dev server, rolled back a
 * completed password reset. The app reported success, the login worked, and the change was
 * gone after a restart. Nothing in any log said why.
 *
 * Silent divergence is the worst failure class available: it looks like the application
 * lying about whether a write happened. So the second opener is refused with an
 * explanation instead.
 *
 * ## Stale locks
 *
 * A lock whose owning process is gone — a `kill -9`, a crash, a laptop closing — must not
 * brick the database. The lock therefore records a PID, and a lock owned by a PID that no
 * longer exists is taken over rather than respected. That is the standard trade: a
 * recycled PID could in principle be mistaken for a live owner, which is why the message
 * tells the operator how to clear it by hand rather than pretending the check is perfect.
 */

const LOCK_FILE = 'snapup.lock';

export class DatabaseLockedError extends Error {
  constructor(dataDir: string, holder: number) {
    super(
      `The embedded database at ${dataDir} is already open in process ${holder}.\n\n` +
        `PGlite allows one process per data directory. A second one would silently revert ` +
        `the first one's writes.\n\n` +
        `If that process is gone, delete ${join(dataDir, LOCK_FILE)} and retry. ` +
        `To inspect the database while the app runs, use its API rather than opening the ` +
        `directory — or point DATABASE_URL at hosted Postgres, which has no such limit.`
    );
    this.name = 'DatabaseLockedError';
  }
}

/**
 * Removes a `postmaster.pid` left by a process that died without shutting down.
 *
 * PGlite is real Postgres, and real Postgres refuses to start when that file is present —
 * it is the interlock that stops two postmasters sharing one data directory. In PGlite it
 * does not merely refuse: **the open blocks indefinitely.**
 *
 * The consequence, discovered the hard way: any ungraceful stop — a crash, a power cut,
 * `Stop-Process -Force`, a container killed on deploy — leaves the app unable to open its
 * own database, with no error, forever. For an unattended pilot that is a shop that does
 * not come back up.
 *
 * Deleting it is only safe because of where this is called from: the caller has just
 * established that no live process holds `snapup.lock`, and no live process holding the
 * directory means the pid file cannot belong to anything running. The pid *inside* it
 * cannot be checked — PGlite writes a placeholder (`-42`) since WASM has no OS process —
 * which is precisely why the lock file exists to answer the question instead.
 */
function clearStalePostmasterPid(dataDir: string): void {
  const pidPath = join(dataDir, 'postmaster.pid');
  try {
    rmSync(pidPath, { force: true });
  } catch {
    // Nothing there, or not ours to remove. The open will fail loudly on its own.
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 checks for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user, which still counts as
    // alive. Only ESRCH — no such process — makes the lock stale.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Take the lock, or throw. Returns a release function.
 *
 * Reentrant within a process: the same PID re-acquiring is a no-op, which matters because
 * Next bundles routes separately and a `processSingleton` miss would otherwise look like a
 * second opener.
 */
export function acquireDatabaseLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const lockPath = join(dataDir, LOCK_FILE);

  try {
    const holder = Number(readFileSync(lockPath, 'utf8').trim());
    if (Number.isInteger(holder) && holder !== process.pid && isAlive(holder)) {
      throw new DatabaseLockedError(dataDir, holder);
    }
  } catch (error) {
    if (error instanceof DatabaseLockedError) throw error;
    // ENOENT, or an unreadable/corrupt lock file. Either way there is nothing to respect.
  }

  // Reaching here means no live SnapUp process holds this directory, so anything Postgres
  // left behind is debris from a process that is gone.
  clearStalePostmasterPid(dataDir);

  writeFileSync(lockPath, String(process.pid), 'utf8');

  const release = () => {
    try {
      // Only remove a lock this process still owns. Releasing after a takeover would
      // delete the new owner's lock.
      if (readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      /* already gone */
    }
  };

  // Deliberately NOT released on `process.on('exit')`.
  //
  // That handler looks like tidiness and is actually the bug that corrupted a data
  // directory during development. `exit` fires while the PGlite engine is still open —
  // the WASM postmaster has not flushed or shut down. Removing the lock there advertises
  // the directory as free a moment before it actually is, and a dev server starting in
  // that window finds no lock, concludes the leftover `postmaster.pid` is debris, clears
  // it, and boots a second postmaster onto a live WAL. The result was
  // `PANIC: could not locate a valid checkpoint record` and a directory PGlite can no
  // longer open at all, since it ships no `pg_resetwal`.
  //
  // Leaving the file behind costs nothing: the PID staleness check above already takes
  // over a lock whose owner is gone, and unlike an early release it cannot claim the
  // directory is free while a process still holds it. Callers that genuinely finish with
  // the database — tests, scripts — call the returned function after `close()`.
  return release;
}
