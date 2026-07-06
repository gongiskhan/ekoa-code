// integrations/ module — see spec/02-module-map.md §2.6.
// Served-app AUTH + CLOUD planes (ch03 §3.9, slice S5). The app-files router lives in
// apps/ (app-files.ts); these are the integrations/-homed planes plus their injected seams.
export * from './app-scope.js';
export * from './app-sso-sessions.js';
export * from './app-sso.js';
export * from './m365-proxy.js';
export * from './app-cloud-files.js';
