#!/usr/bin/env node
/**
 * Chooses which app this Railway service builds and runs.
 *
 *   node scripts/railway-app.mjs build     -> npm run build:<app>
 *   node scripts/railway-app.mjs start     -> npm run start:<app>
 *
 * ## Why a script rather than shell expansion
 *
 * One repository, two services, and `railway.json` is read from the repository root by
 * both — so the command has to pick its own app. The obvious spelling is
 * `npm run build:${SNAPUP_APP:-customer}`, which works only because npm happens to run
 * scripts through `sh` on Linux. That is a property of the deployment container, it cannot
 * be tested on a Windows workstation, and the failure mode is a service that dies at build
 * time on a platform nobody can reproduce locally. This does the same job in Node, which
 * behaves identically everywhere and can be run on the machine that wrote it.
 *
 * Defaults to `customer`. An unset variable must not be able to turn the shopper app into
 * something else — the gateway is the service customers actually hit.
 */

import { spawn } from 'node:child_process';

const PHASES = new Set(['build', 'start']);
const APPS = new Set(['customer', 'admin']);

const phase = process.argv[2];
if (!PHASES.has(phase)) {
  console.error(`Usage: node scripts/railway-app.mjs <${[...PHASES].join('|')}>`);
  process.exit(1);
}

const app = (process.env.SNAPUP_APP ?? 'customer').trim().toLowerCase();
if (!APPS.has(app)) {
  // Fail loudly rather than falling back. A typo here would otherwise deploy the shopper
  // app to the console's hostname and look like a routing problem for hours.
  console.error(
    `SNAPUP_APP is "${app}", which is not one of: ${[...APPS].join(', ')}. Refusing to guess.`
  );
  process.exit(1);
}

const script = `${phase}:${app}`;
console.log(`railway-app: SNAPUP_APP=${app} -> npm run ${script}`);

// A single command string through the shell, so `npm` resolves via PATH on both Linux and
// Windows. Passing an argument array alongside `shell: true` is deprecated (DEP0190)
// because the array is concatenated rather than escaped; `script` here is built from two
// values this file has already checked against a fixed set, so there is nothing to escape.
const child = spawn(`npm run ${script}`, { stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
