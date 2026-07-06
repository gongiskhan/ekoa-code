// services/ module — see spec/02-module-map.md §2.6. Implementation lands in its build phase (chapter 14).
export {};

// G6 S2 — app-pipeline carryover services (spec/07 §7.9/§7.11, ch09 invariant 10).
export * from './safe-path.js';
export * from './repo-lock.js';
export * from './browser-pool.js';
export * from './artifact-screenshot.js';
export * from './commit-guard.js';
export * from './app-archive.js';
export * from './demo-registry.js';
export * from './github/provider.js';
export * from './github/repos.js';
export * from './github/git-remote.js';
export * from './github/backup.js';
export * from './github/fork.js';
