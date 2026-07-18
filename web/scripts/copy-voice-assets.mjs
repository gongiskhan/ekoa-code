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
 * Runs as predev/prebuild beside copy-monaco.mjs; a version stamp makes re-runs a no-op.
 * public/voice/vendor/ is gitignored (vendored binaries); public/voice/*.js (our own
 * pcm-downsample worklet) IS committed and is not touched here.
 */
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const vadDist = dirname(require.resolve('@ricky0123/vad-web/dist/index.js'));
// onnxruntime-web restricts its exports (no ./package.json subpath); reach its dist dir via
// a per-file wasm subpath it DOES export, and its package.json via the filesystem from there.
const ortDist = dirname(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
const vadPkg = JSON.parse(readFileSync(join(vadDist, '..', 'package.json'), 'utf8'));
const ortPkg = JSON.parse(readFileSync(join(ortDist, '..', 'package.json'), 'utf8'));
const version = `vad-web@${vadPkg.version} onnxruntime-web@${ortPkg.version}`;

const dest = join(here, '..', 'public', 'voice', 'vendor');
const stamp = join(dest, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === version) {
  process.exit(0); // already current
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
console.log(`[copy-voice-assets] ${version} -> public/voice/vendor`);
