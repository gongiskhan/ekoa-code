/**
 * version.ts — the daemon version advertised in the `hello` frame.
 *
 * Read from package.json at build time would need a JSON import assertion and a bundler-specific
 * resolution; a constant is checked against package.json by test/scaffold.test.ts instead, so the
 * two cannot drift silently.
 */
export const DAEMON_VERSION = '0.3.0';
