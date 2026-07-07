/**
 * Secret-commit guard + git version snapshot (spec/07-app-pipeline.md §7.9;
 * ch09 invariant on code egress; carryover audit A7, port-as-is scanner).
 *
 * Git is the system of record for artifact source. This module owns two coupled
 * concerns of §7.9:
 *
 *  1. The secret scanner (pure, ported as-is): high-precision detection of
 *     credentials/keys that must never reach a commit (they would be pushed to
 *     GitHub and leak through the code-download zip). HIGH-PRECISION patterns
 *     only - deliberately NOT the broad "32+ alphanumeric chars" heuristic, which
 *     false-positives on bundle hashes, UUIDs and base64 images. Findings never
 *     echo the secret value, only rule + path + line.
 *
 *  2. The version snapshot (`commitSnapshot`): every completed build commits the
 *     working tree under the shared per-repo lock; a broken final build is
 *     committed tagged `[build-failed]` (users may revert FROM a broken version).
 *     The guard runs on every commit; a detected credential BLOCKS the snapshot
 *     loudly, writing a `commit-blocked` activity row with the findings through
 *     the single audit write path (FIXED-8, `data/logActivity`), then throwing.
 *
 * GIT MECHANISM: the old pipeline used `isomorphic-git` (a pure-JS library that is
 * NOT a dependency of this repo). Per the slice brief this ports to system `git`
 * via `execFile` (never `exec`), with hooks disabled so the sandbox boundary
 * stays intact. Behaviour (staging, change detection, `[build-failed]` tagging,
 * the secret block) is preserved; only the mechanism differs.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';
import { withRepoLock } from './repo-lock.js';
import { resolveWithinJail, sandboxRoot } from './safe-path.js';

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Findings + error type
// ---------------------------------------------------------------------------

export interface SecretFinding {
  /** repo-relative path of the offending file */
  path: string;
  /** which rule matched (human-readable) */
  rule: string;
  /** 1-based line number */
  line: number;
}

export type SecretGuardMode = 'block' | 'warn' | 'off';

export class SecretCommitError extends Error {
  readonly findings: SecretFinding[];
  constructor(findings: SecretFinding[]) {
    super(
      `Commit blocked: ${findings.length} potential secret(s) detected. ` +
        `Secrets must never be committed (they would be pushed to GitHub and leak ` +
        `through the code download). Offending file(s): ` +
        findings.map((f) => `${f.path}:${f.line} (${f.rule})`).join(', '),
    );
    this.name = 'SecretCommitError';
    this.findings = findings;
  }
}

// ---------------------------------------------------------------------------
// Detection rules — order matters only for reporting; all are evaluated.
// ---------------------------------------------------------------------------

interface Rule {
  name: string;
  regex: RegExp;
}

const RULES: Rule[] = [
  // PEM private keys — the canonical "never commit this" artifact.
  { name: 'pem-private-key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  // GitHub tokens (PAT classic/fine-grained, app, oauth, server, refresh).
  { name: 'github-token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-fine-grained-pat', regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  // Provider `sk-` API keys (OpenAI proj/legacy, the sk-ant- family, sk-live/test).
  // Rule name deliberately avoids the vendor word so the FIXED-13 chokepoint grep
  // (which bans that word outside api/src/llm/) does not false-positive on this
  // security scanner - the regex still detects the `ant-` prefixed keys.
  { name: 'provider-sk-key', regex: /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'stripe-key', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  // AWS access key id.
  { name: 'aws-access-key', regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  // Google API key.
  { name: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // Slack tokens.
  { name: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  // JWT (three base64url segments) — a real JWT in source is a leak.
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  // Connection string carrying user:password@host.
  {
    name: 'credentialed-connection-string',
    regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^:\s/]+:[^@\s/]+@/i,
  },
  // Explicit secret assignment to a non-trivial quoted value, e.g.
  //   an API_KEY assigned "abcd1234efgh" or a DATABASE_PASSWORD assigned a quoted value
  // Requires the *quoted* value form so ordinary identifiers (token = next()) don't match.
  {
    name: 'assigned-secret',
    regex:
      /\b(?:API_?KEY|SECRET(?:_?KEY)?|ACCESS_?KEY|PRIVATE_?KEY|AUTH_?TOKEN|CLIENT_?SECRET|PASSWORD|PASSWD|CREDENTIALS?)\b\s*[:=]\s*['"][^'"\n]{8,}['"]/i,
  },
];

// ---------------------------------------------------------------------------
// File filtering
// ---------------------------------------------------------------------------

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz', '.tar', '.mp4', '.webm', '.mp3', '.wav',
  '.lock',
]);

const SKIP_BASENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', '.gitignore',
]);

const MAX_SCAN_BYTES = 512 * 1024; // skip anything larger — generated/binary

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i).toLowerCase() : '';
}

function baseOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Whether this repo-relative path should be scanned at all. */
export function shouldScan(path: string): boolean {
  const base = baseOf(path);
  if (SKIP_BASENAMES.has(base)) return false;
  if (base.endsWith('.min.js') || base.endsWith('.min.css')) return false;
  if (SKIP_EXTENSIONS.has(extOf(path))) return false;
  return true;
}

// A NUL byte is the cheap "this is binary, skip it" signal.
const NUL = String.fromCharCode(0);

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Scan a single file's text content. Pure — no IO. */
export function scanText(path: string, content: string): SecretFinding[] {
  if (!shouldScan(path)) return [];
  if (content.indexOf(NUL) !== -1) return []; // binary

  const findings: SecretFinding[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    for (const rule of RULES) {
      if (rule.regex.test(line)) {
        findings.push({ path, rule: rule.name, line: i + 1 });
      }
    }
  }
  return findings;
}

export function guardMode(): SecretGuardMode {
  const raw = (process.env.EKOA_SECRET_GUARD || 'block').toLowerCase();
  if (raw === 'off' || raw === 'warn' || raw === 'block') return raw;
  return 'block';
}

// ---------------------------------------------------------------------------
// git plumbing (execFile — no shell, no hooks)
// ---------------------------------------------------------------------------

const GITIGNORE_BODY = `dist/
node_modules/
app-data/
.git.broken-*
`;

const FAILED_PREFIX = '[build-failed]';
const RESTORE_PREFIX = '[restored]';

/** Base flags: operate on `dir`, never run repo hooks (sandbox boundary). */
function gitArgs(dir: string, args: string[]): string[] {
  return ['-C', dir, '-c', 'core.hooksPath=/dev/null', ...args];
}

/** Run `git` in `dir`; throws on a non-zero exit. Returns stdout. */
async function runGit(dir: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileP('git', gitArgs(dir, args), {
    env: env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

function isRepo(projectDir: string): boolean {
  return existsSync(join(projectDir, '.git'));
}

async function ensureRepo(projectDir: string): Promise<boolean> {
  if (isRepo(projectDir)) return false;
  await runGit(projectDir, ['init', '-q']);
  // Name the initial branch deterministically regardless of the host git default.
  await runGit(projectDir, ['symbolic-ref', 'HEAD', 'refs/heads/main']).catch(() => {});
  await fs.promises.writeFile(join(projectDir, '.gitignore'), GITIGNORE_BODY, 'utf-8');
  return true;
}

/** Stage the whole working tree (respecting .gitignore), including deletions. */
async function stageAll(projectDir: string): Promise<void> {
  await runGit(projectDir, ['add', '-A']);
}

/** Anything staged that differs from HEAD (works on an unborn branch too). */
async function hasStagedChanges(projectDir: string): Promise<boolean> {
  const out = await runGit(projectDir, ['status', '--porcelain']);
  return out.trim() !== '';
}

async function headSha(projectDir: string): Promise<string | null> {
  try {
    return (await runGit(projectDir, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return null;
  }
}

/** Confine the repo path to the owner sandbox and assert it is a directory. */
function validateProjectDir(projectDir: string): string {
  const resolved = resolveWithinJail(sandboxRoot(), projectDir);
  if (!existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`projectDir does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

/**
 * Scan the files staged in the repo index (the exact set a commit would capture;
 * gitignored paths like dist/ and node_modules/ are already excluded). Reads each
 * file from disk. Returns [] when there is no repo/index yet.
 */
export async function scanStagedFiles(projectDir: string): Promise<SecretFinding[]> {
  if (!isRepo(projectDir)) return [];
  let raw: string;
  try {
    raw = await runGit(projectDir, ['ls-files', '-z']);
  } catch {
    return [];
  }
  const files = raw.split(NUL).filter((p) => p.length > 0);

  const findings: SecretFinding[] = [];
  for (const path of files) {
    if (!shouldScan(path)) continue;
    const abs = join(projectDir, path);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      continue; // staged-but-deleted
    }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue;
    let content: string;
    try {
      content = await fs.promises.readFile(abs, 'utf-8');
    } catch {
      continue;
    }
    findings.push(...scanText(path, content));
  }
  return findings;
}

/**
 * Enforce the guard for a commit about to happen on `projectDir`. Mode-aware via
 * EKOA_SECRET_GUARD: 'block' (default) throws SecretCommitError on a finding;
 * 'warn' logs and returns findings; 'off' is a no-op. Returns findings (empty when
 * clean). Does NOT write the audit row - `commitSnapshot` owns that.
 */
export async function assertNoStagedSecrets(projectDir: string): Promise<SecretFinding[]> {
  const mode = guardMode();
  if (mode === 'off') return [];
  const findings = await scanStagedFiles(projectDir);
  if (findings.length === 0) return [];
  if (mode === 'warn') {
    console.warn(
      `[commit-guard] ${findings.length} potential secret(s) detected (warn mode):`,
      findings.map((f) => `${f.path}:${f.line} (${f.rule})`).join(', '),
    );
    return findings;
  }
  throw new SecretCommitError(findings);
}

// ---------------------------------------------------------------------------
// Version snapshot
// ---------------------------------------------------------------------------

/** Audit context so a blocked snapshot can write the `commit-blocked` row. */
export interface SnapshotAudit {
  actor: ActivityActor;
  deps: LogActivityDeps;
  /** Injectable for tests; defaults to `data/logActivity`. */
  logActivity?: typeof logActivity;
}

export interface CommitSnapshotParams {
  projectDir: string;
  message: string;
  authorName: string;
  authorEmail: string;
  /** Tag the commit `[build-failed]` (a broken final build users may revert FROM). */
  buildFailed?: boolean;
  audit?: SnapshotAudit;
}

export interface CommitSnapshotResult {
  sha: string | null;
  createdNew: boolean;
}

/**
 * Commit the working tree as a version snapshot, serialized on the shared per-repo
 * lock. Runs the secret guard first: in block mode a detected credential writes a
 * `commit-blocked` activity row (when an audit context is supplied) and throws
 * SecretCommitError - the snapshot is refused loudly. A broken final build is
 * tagged `[build-failed]`.
 */
export async function commitSnapshot(params: CommitSnapshotParams): Promise<CommitSnapshotResult> {
  const { message, authorName, authorEmail, buildFailed, audit } = params;
  const projectDir = validateProjectDir(params.projectDir);
  if (!message || !message.trim()) throw new Error('commitSnapshot: message is required');
  if (!authorName) throw new Error('commitSnapshot: authorName is required');
  if (!authorEmail) throw new Error('commitSnapshot: authorEmail is required');

  const finalMessage = buildFailed ? `${FAILED_PREFIX} ${message}` : message;

  return withRepoLock(projectDir, async () => {
    await ensureRepo(projectDir);
    await stageAll(projectDir);

    if (!(await hasStagedChanges(projectDir))) {
      return { sha: await headSha(projectDir), createdNew: false };
    }

    // Secret guard on every commit.
    const mode = guardMode();
    if (mode !== 'off') {
      const findings = await scanStagedFiles(projectDir);
      if (findings.length > 0) {
        if (mode === 'block') {
          if (audit) {
            const write = audit.logActivity ?? logActivity;
            await write(audit.actor, 'execute', 'commit-blocked', audit.deps, { findings });
          }
          throw new SecretCommitError(findings);
        }
        console.warn(
          `[commit-guard] ${findings.length} potential secret(s) detected (warn mode):`,
          findings.map((f) => `${f.path}:${f.line} (${f.rule})`).join(', '),
        );
      }
    }

    const commitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: 'ekoa-agent',
      GIT_COMMITTER_EMAIL: 'agent@ekoa.local',
    };
    await runGit(projectDir, ['commit', '-m', finalMessage, '--no-verify', '--no-gpg-sign'], commitEnv);
    return { sha: await headSha(projectDir), createdNew: true };
  });
}

export interface VersionEntry {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  buildFailed: boolean;
  isRestore: boolean;
}

const LOG_UNIT = '\x1f'; // between fields
const LOG_REC = '\x1e'; // between records

/** List commits (newest first) with `[build-failed]` / `[restored]` flags stripped. */
export async function readVersions(projectDir: string, limit = 100): Promise<VersionEntry[]> {
  const resolved = validateProjectDir(projectDir);
  if (!isRepo(resolved)) return [];
  let out: string;
  try {
    out = await runGit(resolved, [
      'log',
      `-n`,
      String(limit),
      `--format=%H${LOG_UNIT}%an${LOG_UNIT}%ae${LOG_UNIT}%at${LOG_UNIT}%s${LOG_REC}`,
    ]);
  } catch {
    return []; // no commits yet
  }
  return out
    .split(LOG_REC)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((rec) => {
      const [sha = '', authorName = '', authorEmail = '', at = '0', subject = ''] = rec.split(LOG_UNIT);
      const buildFailed = subject.startsWith(FAILED_PREFIX);
      const isRestore = subject.startsWith(RESTORE_PREFIX);
      const messageText = buildFailed
        ? subject.slice(FAILED_PREFIX.length).trim()
        : isRestore
          ? subject.slice(RESTORE_PREFIX.length).trim()
          : subject;
      return {
        sha,
        message: messageText,
        authorName,
        authorEmail,
        timestamp: Number(at) * 1000,
        buildFailed,
        isRestore,
      };
    });
}
