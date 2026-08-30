// Separate entry point from the package root on purpose -- see PRD.md
// Phase 3, "split entry points so the core stays importable in Node and
// testable without stubbing globals". Everything under src/core and
// src/runtime works with fakes; this is the only place that touches real
// Apps Script globals (Session, PropertiesService, CacheService, Utilities).
//
// Every export here carries a trailing underscore -- GAS's own convention
// for "not a public endpoint", since any of these would otherwise become a
// real google.script.run target once a bundler flattens them into the
// deployed .gs file alongside the app's own routes. See README "GAS naming
// convention".
export { createSessionResolver_ } from './session-resolver.js';
export { createPropertiesStore_, ROLE_ASSIGNMENTS_PROPERTY_KEY } from './properties-store.js';
export { withScriptCache_, invalidateCachedRoles_ } from './cache.js';
