/**
 * CLI for the WS10 screenshot-seeding fix: force a DELIBERATE recapture of one or more
 * featured-artifact screenshots.
 *
 * WHY THIS EXISTS: `captureArtifactScreenshot` self-heals only when the PNG is ABSENT
 * (`featured-builder.ts`'s boot loop) - it never re-shoots on a scaffold or seed-data
 * change on its own, and it never revisits a screenshot that already exists on disk.
 * That is correct for ordinary content changes, but it means the fix in
 * `featured-builder.ts` (ensuring the shared `legal-*` demo spine is installed before a
 * capture) has NO effect on the 29 `legal-*` screenshots that already exist today - they
 * were captured empty, long before that fix landed, and nothing will ever touch them
 * again on its own. This script is the deliberate trigger: delete the named artifacts'
 * current PNG so the next capture treats them as missing, ensure the demo spine first for
 * any `legal-*` target, then capture directly - narrow and on-demand, never a boot-time
 * sweep across all 42 (that would stampede Playwright, exactly what the self-heal-only-
 * when-missing rule exists to avoid).
 *
 * Requires the api server to ALREADY be running and the target id(s) already
 * built + registered (this script does not boot anything, build anything, or touch
 * MongoDB - it captures against the live `http://localhost:<port>/apps/<id>/` the exact
 * same way the boot-time pipeline does). Respects `EKOA_SCREENSHOTS_DISABLED`.
 *
 * Usage (from api/):
 *   npm run tool:recapture-featured-screenshots -- legal-nucleo legal-prazos
 *   npm run tool:recapture-featured-screenshots -- --all-legal
 *   npm run tool:recapture-featured-screenshots -- --all-legal --json
 *
 * One id's failure never aborts the batch; the process exit code is non-zero iff at
 * least one requested id failed to capture.
 */
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  getArtifactScreenshotDir,
  captureArtifactScreenshot,
} from '../../src/services/artifact-screenshot.js';
import { closeSharedBrowser } from '../../src/services/browser-pool.js';
import { ensureLegalDemoSpineInstalled } from '../../src/apps/featured-builder.js';
import { featuredArtifactsDir } from '../../src/apps/featured-seeder.js';

interface Args {
  ids: string[];
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const json = argv.includes('--json');
  if (argv.includes('--all-legal')) {
    const root = featuredArtifactsDir();
    const ids = existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name.startsWith('legal-'))
          .map((e) => e.name)
      : [];
    return { ids, json };
  }
  const ids = argv.filter((a) => !a.startsWith('--'));
  return { ids, json };
}

interface Outcome {
  id: string;
  ok: boolean;
  path?: string;
  error?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (process.env.EKOA_SCREENSHOTS_DISABLED === '1') {
    process.stderr.write('[recapture-featured-screenshots] EKOA_SCREENSHOTS_DISABLED=1 - refusing to capture anything.\n');
    process.exit(1);
  }
  if (args.ids.length === 0) {
    process.stderr.write(
      'Usage: recapture-featured-screenshots.mjs <id> [<id> ...] | --all-legal   (add --json for machine output)\n',
    );
    process.exit(1);
  }

  if (!args.json) {
    process.stdout.write(`[recapture-featured-screenshots] targets: ${args.ids.join(', ')}\n`);
  }

  // Delete each target's current PNG first - this is the ONLY signal the boot-time
  // self-heal logic checks, so it is also the correct way for a human to force one.
  const dir = getArtifactScreenshotDir();
  for (const id of args.ids) {
    const shotPath = join(dir, `${id}.png`);
    if (existsSync(shotPath)) {
      unlinkSync(shotPath);
      if (!args.json) process.stdout.write(`[recapture-featured-screenshots] deleted stale ${shotPath}\n`);
    }
  }

  // One shared-spine install covers every legal-* target in this run (owner-keyed
  // namespace) - do it once, before any of them capture, not once per id.
  if (args.ids.some((id) => id.startsWith('legal-'))) {
    if (!args.json) process.stdout.write('[recapture-featured-screenshots] ensuring the shared legal-* demo spine is installed...\n');
    try {
      const outcome = await ensureLegalDemoSpineInstalled();
      if (!args.json) {
        process.stdout.write(
          `[recapture-featured-screenshots] demo spine: ${outcome.alreadyInstalled ? 'already installed' : 'installed now'}\n`,
        );
      }
    } catch (err) {
      // Non-fatal: captures still run below, just with the family's empty first-run
      // state if this failed (e.g. legal-nucleo isn't built/registered yet).
      process.stderr.write(
        `[recapture-featured-screenshots] demo spine ensure FAILED - ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const outcomes: Outcome[] = [];
  for (const id of args.ids) {
    try {
      const result = await captureArtifactScreenshot(id);
      outcomes.push({ id, ok: true, path: result.path });
      if (!args.json) process.stdout.write(`[recapture-featured-screenshots] ${id}: captured -> ${result.path}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ id, ok: false, error: message });
      if (!args.json) process.stderr.write(`[recapture-featured-screenshots] ${id}: FAILED - ${message}\n`);
    }
  }

  await closeSharedBrowser();

  if (args.json) {
    process.stdout.write(JSON.stringify({ outcomes }, null, 2) + '\n');
  }
  process.exit(outcomes.every((o) => o.ok) ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`[recapture-featured-screenshots] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
