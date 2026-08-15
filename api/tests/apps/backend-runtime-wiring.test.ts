import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp, disposeArtifactBackendRuntime } from '../../src/server.js';
import { __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { getArtifactBackendRuntime, WorkerThreadRuntime } from '../../src/apps/backend-runtime/index.js';

/**
 * S1 composition proof (findings.md `artifact-backend-runtime-never-wired`): the app factory
 * registers the REAL WorkerThreadRuntime on the process-wide singleton - before this wiring no
 * setArtifactBackendRuntime caller existed in api/src, so every onEmail invoke on the delivery
 * pipeline answered "artifact backend runtime is not initialised" (the Null default). Also
 * proves the teardown half: disposal retires the instance and resets the singleton to the Null
 * runtime (fail-closed), and a re-composed factory retires the previously registered instance
 * instead of orphaning it. Runtime SEMANTICS (lifecycle invariants, capability execution) stay
 * pinned by tests/apps/backend-runtime.test.ts - this file only proves the composition.
 */

const testConfig: Config = {
  port: 0,
  jwtSecret: 'test-secret-not-real',
  encryptionKey: 'test-key-not-real',
  nodeEnv: 'test',
  llmChokepointBaseUrl: 'http://127.0.0.1:0/api/v1/llm',
  llm: defaultLlmConfig(),
};

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-key-not-real';
  process.env.JWT_SECRET = 'test-secret-not-real';
  __resetConfigForTests();
});

afterAll(async () => {
  await disposeArtifactBackendRuntime();
  __resetConfigForTests();
});

describe('artifact-backend runtime composition (S1)', () => {
  it('building the app factory registers a WorkerThreadRuntime, not the Null default', () => {
    buildApp(testConfig);
    expect(getArtifactBackendRuntime()).toBeInstanceOf(WorkerThreadRuntime);
  });

  it('teardown disposes the registered runtime and resets the singleton to the Null runtime', async () => {
    buildApp(testConfig);
    const rt = getArtifactBackendRuntime();
    expect(rt).toBeInstanceOf(WorkerThreadRuntime);
    const dispose = vi.spyOn(rt, 'dispose');

    await disposeArtifactBackendRuntime();

    expect(dispose).toHaveBeenCalledTimes(1);
    const after = getArtifactBackendRuntime();
    expect(after).not.toBe(rt);
    // Fail-closed after teardown: an invoke answers the Null runtime's honest refusal rather
    // than dispatching to a disposed worker pool.
    const res = await after.invoke('any-artifact', 'onEmail', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not initialised/);
  });

  it('re-composing the factory retires the previously registered instance', async () => {
    buildApp(testConfig);
    const first = getArtifactBackendRuntime();
    const dispose = vi.spyOn(first, 'dispose');

    buildApp(testConfig);
    const second = getArtifactBackendRuntime();

    expect(second).toBeInstanceOf(WorkerThreadRuntime);
    expect(second).not.toBe(first);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
