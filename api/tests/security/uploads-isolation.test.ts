import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { resolveUpload, stageRunAttachments } from '../../src/uploads/service.js';
import { ErrorEnvelope } from '@ekoa/shared';

/**
 * uploads ISOLATION suite (WS4a), the class Capability Contract Rule 5 requires of any module
 * holding per-user state ("a capability that holds state ships an isolation suite of the class of
 * api/tests/security/memvault-isolation.test.ts"). Scoped to what `api/src/uploads/` actually IS:
 * a flat per-user id -> single-blob store (no hierarchical permalink, no search index, no
 * list/delete surface), so the battery below targets its real attack surface rather than
 * mechanically importing memvault's - a wire `uploadId` is charset-guarded to ONE segment (there
 * is no legitimate multi-segment shape to fuzz), and this module's OWN write path never creates a
 * symlink, so the risk that remains is: (1) a hostile-shaped `uploadId` string reaching a path
 * op, and (2) a directory that TURNED OUT to be a symlink (planted by some means outside this
 * module) being trusted on read. `resolveUpload` closes both: a charset guard first, then a
 * `resolveWithinJail` (`services/safe-path.ts`, the same primitive `apps/`/`automation/` use)
 * realpath re-check on the resolved directory AND the resolved blob path.
 */
let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
let dataDir: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const uploadsRootDir = () => join(dataDir, 'uploads');

async function mkUser(id: string, orgId: string) {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const upload = (t: string, filename: string, body: string, extraHeaders: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/api/v1/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(filename), ...extraHeaders },
    body,
  });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_uploads_isolation');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  dataDir = mkdtempSync(join(tmpdir(), 'ekoa-uploads-isolation-'));
  process.env.EKOA_DATA_DIR = dataDir;
  await users.deleteMany({});
});

describe('uploads isolation (WS4a, Capability Contract Rule 5)', () => {
  it('cross-tenant: userB cannot resolveUpload a staged blob that belongs to userA (same org)', async () => {
    await mkUser('usrA', 'orgA');
    await mkUser('usrB', 'orgA'); // SAME org on purpose - isolation is per-USER, stricter than org scoping
    const tA = await tokenFor('usrA');
    const res = await upload(tA, 'privado.txt', 'SEGREDO_DE_A');
    expect(res.status).toBe(201);
    const { uploadId } = (await res.json()) as { uploadId: string };

    expect(await resolveUpload('usrB', uploadId)).toBeNull();
    const resolved = await resolveUpload('usrA', uploadId);
    expect(resolved?.displayName).toBe('privado.txt');
    expect(readFileSync(resolved!.path, 'utf8')).toBe('SEGREDO_DE_A');
  });

  it("a chat run's stageRunAttachments never copies another user's blob into the run dir", async () => {
    await mkUser('usrA', 'orgA');
    await mkUser('usrB', 'orgA');
    const tA = await tokenFor('usrA');
    const res = await upload(tA, 'segredo-de-a.txt', 'SEGREDO_DE_A');
    const { uploadId } = (await res.json()) as { uploadId: string };

    // userB's run references A's real uploadId - it must resolve to NOTHING for B.
    const staged = await stageRunAttachments('usrB', [{ uploadId }]);
    expect(staged).toBeNull();

    // The same ref, for its rightful owner, resolves and copies correctly.
    const stagedForA = await stageRunAttachments('usrA', [{ uploadId }]);
    expect(stagedForA?.files.map((f) => f.displayName)).toEqual(['segredo-de-a.txt']);
    rmSync(stagedForA!.dir, { recursive: true, force: true });
  });

  it('traversal-shaped X-Filename values are sanitized into harmlessness - nothing escapes the per-user root', async () => {
    await mkUser('usrA', 'orgA');
    const tA = await tokenFor('usrA');
    const payloads = ['../../etc/passwd', '..\\..\\windows', '/etc/passwd', 'a/../../b', '....//....//etc/passwd'];
    for (const p of payloads) {
      const res = await upload(tA, p, 'x');
      expect(res.status, p).toBe(201);
      const body = (await res.json()) as { uploadId: string; displayName: string };
      // The sanitizer neutralizes every '..'/'.' segment to '_' - never interpreted as traversal.
      expect(body.displayName).not.toContain('..');
      expect(body.displayName.startsWith('/')).toBe(false);
    }
    // Nothing landed outside the per-user tree: only usrA's own directory exists under uploads/.
    expect(existsSync(uploadsRootDir()) ? readdirSync(uploadsRootDir()) : []).toEqual(['usrA']);
  });

  it('a hostile uploadId reaching resolveUpload directly (bypassing the wire charset guard) is refused, not resolved', async () => {
    await mkUser('usrA', 'orgA');
    await mkUser('usrB', 'orgA');
    const tB = await tokenFor('usrB');
    expect((await upload(tB, 'segredo-b.txt', 'SEGREDO_B')).status).toBe(201);
    for (const hostile of ['..', '../usrB', '../usrB/x', '/etc/passwd', 'a/../../usrB', '']) {
      expect(await resolveUpload('usrA', hostile), hostile).toBeNull();
    }
  });

  it('a directory symlinked at another tenant\'s upload fails closed on read (realpath jail, not just charset)', async () => {
    await mkUser('usrA', 'orgA');
    await mkUser('usrB', 'orgA');
    const tB = await tokenFor('usrB');
    const res = await upload(tB, 'segredo.txt', 'SEGREDO_DE_B');
    const { uploadId: bId } = (await res.json()) as { uploadId: string };

    // Plant, inside A's tree, a directory symlink NAMED as a plausible uploadId, pointing at B's
    // real upload directory. This is NOT reachable through this module's own write path (it never
    // calls symlink()); it models a filesystem-level plant outside this module's control, which
    // the jail must still refuse rather than trust.
    mkdirSync(join(uploadsRootDir(), 'usrA'), { recursive: true });
    const plantedId = 'planted-upload-id';
    symlinkSync(join(uploadsRootDir(), 'usrB', bId), join(uploadsRootDir(), 'usrA', plantedId));

    const resolved = await resolveUpload('usrA', plantedId);
    expect(resolved).toBeNull();

    // ...and stageRunAttachments (the actual agent-facing seam) refuses it too - B's content never
    // reaches a run started under A's identity.
    const staged = await stageRunAttachments('usrA', [{ uploadId: plantedId }]);
    expect(staged).toBeNull();
  });

  it('a symlinked upload BLOB (not the directory) also fails closed', async () => {
    await mkUser('usrA', 'orgA');
    await mkUser('usrB', 'orgA');
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const resA = await upload(tA, 'nota.txt', 'conteudo de A');
    const { uploadId: aId } = (await resA.json()) as { uploadId: string };
    const resB = await upload(tB, 'segredo.txt', 'SEGREDO_DE_B');
    const { uploadId: bId } = (await resB.json()) as { uploadId: string };

    // Replace A's own blob file with a symlink pointing at B's blob - the directory (and its
    // uploadId) are legitimately A's; only the file inside was swapped.
    const aBlobPath = join(uploadsRootDir(), 'usrA', aId, 'nota.txt');
    rmSync(aBlobPath);
    symlinkSync(join(uploadsRootDir(), 'usrB', bId, 'segredo.txt'), aBlobPath);

    const resolved = await resolveUpload('usrA', aId);
    expect(resolved).toBeNull();
  });

  it('rejects an upload with no X-Filename (400 envelope, refused before any path touches disk)', async () => {
    await mkUser('usrA', 'orgA');
    const tA = await tokenFor('usrA');
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tA}`, 'content-type': 'application/octet-stream' },
      body: 'x',
    });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('admission: unauthenticated and unknown-bearer uploads are refused with envelopes', async () => {
    const anon = await fetch(`http://127.0.0.1:${port}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-filename': 'x.txt' },
      body: 'x',
    });
    expect(anon.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await anon.json()).success).toBe(true);

    const unknown = await fetch(`http://127.0.0.1:${port}/api/v1/uploads`, {
      method: 'POST',
      headers: { authorization: 'Bearer garbage-not-a-jwt', 'content-type': 'application/octet-stream', 'x-filename': 'x.txt' },
      body: 'x',
    });
    expect(unknown.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await unknown.json()).success).toBe(true);
  });

  it('writeFileSync-planted corrupt/foreign bytes at another tenant\'s path are never returned as this tenant\'s content', async () => {
    // Structural sanity: two tenants' upload trees are physically separate directories, not rows
    // in one shared table a missing WHERE clause could expose.
    await mkUser('usrA', 'orgA');
    await mkUser('usrB', 'orgA');
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const resA = await upload(tA, 'a.txt', 'A');
    const { uploadId: aId } = (await resA.json()) as { uploadId: string };
    const resB = await upload(tB, 'b.txt', 'B');
    const { uploadId: bId } = (await resB.json()) as { uploadId: string };
    expect(aId).not.toBe(bId);
    expect(join(uploadsRootDir(), 'usrA', aId)).not.toBe(join(uploadsRootDir(), 'usrB', bId));
    expect(readdirSync(uploadsRootDir()).sort()).toEqual(['usrA', 'usrB']);
    writeFileSync(join(uploadsRootDir(), 'usrB', bId, 'b.txt'), 'B-MODIFIED-BY-B'); // B mutates its own file
    const resolvedA = await resolveUpload('usrA', aId);
    expect(readFileSync(resolvedA!.path, 'utf8')).toBe('A'); // untouched by B's write
  });
});
