/**
 * Ambient type shim for `js-yaml` (used by manifest-parser.ts). The package is present in the
 * workspace's node_modules but ships without bundled `.d.ts` and `@types/js-yaml` is not a
 * direct dependency of api/. This minimal declaration keeps the automation module type-checking
 * without adding an install step here.
 *
 * G8 report action: add `js-yaml` + `@types/js-yaml` as direct api/ dependencies and delete this
 * shim (only the `load` entry is used by the manifest parser).
 */
declare module 'js-yaml' {
  export function load(input: string): unknown;
  export function dump(input: unknown): string;
  const _default: { load(input: string): unknown; dump(input: unknown): string };
  export default _default;
}
