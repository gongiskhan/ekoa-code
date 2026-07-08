/**
 * G10 tooling env bootstrap. The pure billing-math tools (billing-replay, parity-workload) need
 * loadConfig() to succeed so they read the SAME billing tier weights + cache-read factor production
 * uses (config.ts), but they do NOT use JWT_SECRET or ENCRYPTION_KEY. Provide inert placeholders
 * when those are unset so the tools run standalone against the committed fixtures. An operator
 * running against real data sets the real values, which take precedence (||= only fills a gap).
 *
 * Imported for its side effect FIRST, before any module that reads the config. NOT used by the
 * import tool, which legitimately requires the carried ENCRYPTION_KEY for its decrypt-samples.
 */
process.env.JWT_SECRET ||= 'g10-tool-inert-jwt-secret-not-used-for-billing-math';
process.env.ENCRYPTION_KEY ||= 'g10-tool-inert-encryption-key-not-used-for-billing-math';

export {};
