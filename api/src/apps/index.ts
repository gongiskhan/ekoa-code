// apps/ module — see spec/02-module-map.md §2.6. Implementation lands in its build phase (chapter 14).
export {};

// App pipeline core (ch07 §7.1.1 — port-as-is, carryover-audit A3).
export * from './manifest.js';
export * from './builder.js';
export * from './scaffold.js';
