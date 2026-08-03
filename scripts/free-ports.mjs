/**
 * Free the ports Hopper pins, before `npm run dev` claims them.
 *
 * The dev servers use --strictPort deliberately: a console that silently
 * moves to :5190 because something stale held :5173 is worse than a loud
 * failure, especially when the URL is muscle memory mid-demo. But the loud
 * failure still needs clearing by hand, so `predev` runs this first.
 *
 * Only kills processes that are actually LISTENING on our own ports.
 */
import { execFileSync } from 'node:child_process';

const PORTS = [
  [8787, 'api'],
  [5173, 'console'],
  [5174, 'site'],
];

const listenersOn = (port) => {
  try {
    // -sTCP:LISTEN so we never touch a client that merely connected to us
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
  } catch {
    return []; // lsof exits non-zero when nothing matches
  }
};

let freed = 0;

for (const [port, name] of PORTS) {
  const pids = listenersOn(port);
  if (pids.length === 0) continue;

  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      /* already gone */
    }
  }

  // give SIGTERM a moment, then insist
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && listenersOn(port).length > 0) {
    try {
      execFileSync('sleep', ['0.1']);
    } catch {
      break;
    }
  }
  for (const pid of listenersOn(port)) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {
      /* already gone */
    }
  }

  const still = listenersOn(port);
  if (still.length) {
    console.log(`ports      :${port} (${name}) still held by ${still.join(', ')} — not ours to kill?`);
  } else {
    console.log(`ports      freed :${port} (${name}) — was ${pids.join(', ')}`);
    freed += 1;
  }
}

if (freed === 0) console.log('ports      8787, 5173, 5174 all clear');
