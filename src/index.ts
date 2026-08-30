// Every function export here carries a trailing underscore, except
// __rbacDispatch -- GAS's own convention for "not a public endpoint", since
// any top-level `function` a bundler flattens into the deployed .gs file
// is otherwise a real google.script.run target. None of these are routes;
// __rbacDispatch is the one dispatch entry point that must stay callable.
// See README "GAS naming convention".
export { definePolicy_ } from './core/policy.js';
export type { PolicySpec, PermissionOf } from './core/policy.js';
export type { RoleStore } from './core/store.js';
export { AuthorizationError } from './core/errors.js';

export { init_ } from './runtime/config.js';
export type { Config, LogEvent } from './runtime/config.js';

export { runAs_ } from './runtime/context.js';
export type { Principal } from './runtime/context.js';

export type { Handler, Meta, Middleware } from './runtime/middleware.js';
export { context, auth, errorMask, logger } from './runtime/shipped-middleware.js';

// The public, ambient-context API a route handler calls -- matches
// PRD.md's "Checks inside a handler". Built on the explicit, Set-based
// primitives in core/authorization.ts (permissionsForRoles_, resolvePermissions_,
// and Phase 1's own can_/require_/permissionsFor_), which stay useful for
// testing a handler's authorization logic in isolation without wiring up
// dispatch or ambient context -- see examples/invoice-app/demo.ts.
export { can_, require_, permissionsFor_, rbac, typedRbac_, __rbacDispatch } from './runtime/rbac.js';
export type { Rbac } from './runtime/rbac.js';

// Phase 1 primitives, for anyone building against them directly rather than
// through the ambient rbac.* surface above.
export { permissionsForRoles_, resolvePermissions_ } from './core/roles.js';
