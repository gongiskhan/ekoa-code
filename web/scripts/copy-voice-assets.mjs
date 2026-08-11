#!/usr/bin/env node
/**
 * Copy the self-hosted voice VAD assets into public/voice/vendor/ (mega-run C4).
 *
 * WHY: the browser-side Silero VAD (@ricky0123/vad-web) loads three kinds of runtime
 * assets by URL at MicVAD.new time - its audio-worklet bundle, the Silero ONNX models,
 * and the onnxruntime-web WASM runtime. Its defaults fetch them from a CDN, which the
 * dashboard CSP (script-src 'self', next.config.ts) blocks - so they are served
 * same-origin from public/voice/vendor/ and the client points baseAssetPath /
 * onnxWASMBasePath there. Same recipe as the jarvis-os fitting's build
 * (garrison feat/local-voice-jarvis ui/build.mjs, read-only reference; see
 * docs/autothing/runs/20260717-190134-9d4c1cbf/analysis/07-voice-reuse.md).
 *
 * PROVENANCE (all resolved from this workspace's node_modules, never downloaded here):
 *  - vad.worklet.bundle.min.js, silero_vad_v5.onnx, silero_vad_legacy.onnx
 *      from @ricky0123/vad-web (ISC license); the Silero models ship inside its dist.
 *  - ort-wasm*.{wasm,mjs}  from onnxruntime-web (MIT license); every variant is copied
 *      and ort picks the right one at load time (single-threaded config in the client
 *      avoids the cross-origin-isolation requirement).
 *
 * public/voice/vendor/ is gitignored (vendored binaries); public/voice/*.js (our own
 * pcm-downsample worklet) IS committed and is not touched here.
 *
 * INVOKED TWO WAYS - same reasoning as copy-monaco.mjs's `ensureMonacoAssets()`, ported
 * here after that fix landed: npm's predev/prebuild hooks only fire for `npm run dev`/
 * `npm run build`, so a dev server started any other way skips them and the voice capture
 * button 404s its worklet/model/wasm assets the first time a user reaches for the mic - a
 * failure mode that is silent until someone actually clicks it, unlike Monaco's (which
 * throws from an unhandled promise the instant the editor mounts). Calling
 * `ensureVoiceAssets()` from next.config.ts closes the same gap unconditionally.
 *  1. CLI (predev/prebuild in package.json).
 *  2. `ensureVoiceAssets()` imported into next.config.ts, run on every `next dev`/`next build`.
 */
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Idempotently mirror @ricky0123/vad-web's + onnxruntime-web's runtime assets into
 * public/voice/vendor/. Never throws - a missing package is reported back rather than
 * crashing the caller, since next.config.ts calls this synchronously on every Next boot.
 * @returns {{ ok: boolean, copied: boolean, version?: string, reason?: string }}
 */
export function ensureVoiceAssets() {
  const require = createRequire(import.meta.url);
  let vadDist, ortDist;
  try {
    vadDist = dirname(require.resolve('@ricky0123/vad-web/dist/index.js'));
    // onnxruntime-web restricts its exports (no ./package.json subpath); reach its dist dir
    // via a per-file wasm subpath it DOES export, and its package.json via the filesystem
    // from there.
    ortDist = dirname(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
  } catch {
    return { ok: false, copied: false, reason: '@ricky0123/vad-web or onnxruntime-web is not installed (run npm install)' };
  }
  const vadPkg = JSON.parse(readFileSync(join(vadDist, '..', 'package.json'), 'utf8'));
  const ortPkg = JSON.parse(readFileSync(join(ortDist, '..', 'package.json'), 'utf8'));
  const version = `vad-web@${vadPkg.version} onnxruntime-web@${ortPkg.version}`;

  const dest = join(here, '..', 'public', 'voice', 'vendor');
  const stamp = join(dest, '.version');

  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === version) {
    return { ok: true, copied: false, version };
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  for (const f of ['vad.worklet.bundle.min.js', 'silero_vad_v5.onnx', 'silero_vad_legacy.onnx']) {
    copyFileSync(join(vadDist, f), join(dest, f));
  }
  // Every ort-wasm* runtime asset (.mjs glue + .wasm binaries; ort picks the variant at load).
  for (const f of readdirSync(ortDist)) {
    if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) copyFileSync(join(ortDist, f), join(dest, f));
  }

  writeFileSync(stamp, `${version}\n`);
  return { ok: true, copied: true, version };
}

// CLI entry point (predev/prebuild): `node scripts/copy-voice-assets.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = ensureVoiceAssets();
  if (!result.ok) {
    console.error(`[copy-voice-assets] ${result.reason}`);
    process.exit(1);
  }
  if (result.copied) {
    console.log(`[copy-voice-assets] ${result.version} -> public/voice/vendor`);
  }
}
