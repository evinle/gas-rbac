import { getConfig } from './config.js';
import { getPrincipal } from './context.js';
import { can as canGiven, permissionsFor as permissionsForGiven, require as requireGiven } from '../core/authorization.js';
import { resolvePermissions } from '../core/roles.js';
import { createRegistry } from './registry.js';
import { auth, context, errorMask, logger } from './shipped-middleware.js';

// Outermost first -- see PRD.md "Composition order". Fixed: this is not
// something init() or use() can reorder, only extend.
const registry = createRegistry([errorMask, logger, context, auth]);

export const rbac = {
  requires: registry.requires,
  anyone: registry.anyone,
  use: registry.use,
  audit: registry.audit,
};

// The one static declaration this design ever needs -- see PRD.md
// "Registration". Ships as ordinary library source; whether it survives as
// a true global in a real bundled consumer output (vs. getting wrapped in a
// bundler's module scope) is untested here and is Phase 3/4's job to spike
// against the real build, not assumed solved by this existing.
export function __rbacDispatch(...args: unknown[]): unknown {
  const [name, ...rest] = args as [string, ...unknown[]];
  return registry.dispatch(name, rest);
}

function currentPermissions() {
  const { policy, store } = getConfig();
  const { email } = getPrincipal();
  return resolvePermissions(policy, store, email);
}

// Ambient versions of authorization.ts's explicit-argument functions --
// see PRD.md "Checks inside a handler". These read the current principal
// via context() having already run, so they only work from inside a
// dispatched handler (or anything called from one), never at module
// top-level.
export function can(perm: string): boolean {
  return canGiven(currentPermissions(), perm);
}

export function require(perm: string): void {
  requireGiven(currentPermissions(), perm);
}

export function permissionsFor(): ReadonlySet<string> {
  return permissionsForGiven(currentPermissions());
}
