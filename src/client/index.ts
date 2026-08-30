// Separate entry point from the package root on purpose -- see src/gas/index.ts
// for the same reasoning in the other direction. This one runs in the
// browser, not on the Apps Script server, so it must never import from
// src/core, src/runtime, or src/gas.
export { typedRun } from './typed-run.js';
export type { RouteMap, ScriptRun, TypedRun } from './typed-run.js';
