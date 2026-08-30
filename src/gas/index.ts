// Separate entry point from the package root on purpose -- see PRD.md
// Phase 3, "split entry points so the core stays importable in Node and
// testable without stubbing globals". Everything under src/core and
// src/runtime works with fakes; this is the only place that touches real
// Apps Script globals (Session, PropertiesService, CacheService, Utilities).
export { createSessionResolver } from './session-resolver.js';
export { createPropertiesStore, ROLE_ASSIGNMENTS_PROPERTY_KEY } from './properties-store.js';
export { withScriptCache } from './cache.js';
