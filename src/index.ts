export { definePolicy } from './policy.js';
export type { PolicySpec, PermissionOf } from './policy.js';
export type { RoleStore } from './store.js';
export { AuthorizationError } from './errors.js';

export { init } from './config.js';
export type { Config, LogEvent } from './config.js';

export { runAs } from './context.js';
export type { Principal } from './context.js';

export type { Handler, Meta, Middleware } from './middleware.js';
export { context, auth, errorMask, logger } from './shipped-middleware.js';

// The public, ambient-context API a route handler calls -- matches
// PRD.md's "Checks inside a handler". Built on the explicit, Set-based
// primitives in authorization.ts (permissionsForRoles, resolvePermissions,
// and Phase 1's own can/require/permissionsFor), which stay useful for
// testing a handler's authorization logic in isolation without wiring up
// dispatch or ambient context -- see examples/invoice-app/demo.ts.
export { can, require, permissionsFor, rbac, __rbacDispatch } from './rbac.js';

// Phase 1 primitives, for anyone building against them directly rather than
// through the ambient rbac.* surface above.
export { permissionsForRoles, resolvePermissions } from './roles.js';
