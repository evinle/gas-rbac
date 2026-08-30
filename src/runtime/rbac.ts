import { getConfig_ } from './config.js';
import { getPrincipal_ } from './context.js';
import { can_ as canGiven, permissionsFor_ as permissionsForGiven, require_ as requireGiven } from '../core/authorization.js';
import { resolvePermissions_ } from '../core/roles.js';
import { createRegistry_ } from './registry.js';
import { auth, context, errorMask, logger } from './shipped-middleware.js';
import type { Handler, Middleware } from './middleware.js';

// Outermost first -- see PRD.md "Composition order". Fixed: this is not
// something init_() or use() can reorder, only extend.
const registry = createRegistry_([errorMask, logger, context, auth]);

// The typed surface for rbac.requires/anyone/use/audit -- see PRD.md/README
// "threading Perm through requires and middleware". Perm defaults to
// `string` because the singleton below is constructed before any app's
// policy exists to derive a real Perm union from; typedRbac_ re-types this
// same runtime object against a specific app's Perm once it does.
//
// No NoInfer needed on `perm` here, unlike core/authorization.ts's
// can_/require_: those infer Perm from two arguments in the same call and
// need NoInfer to stop the second one widening it. Here Perm is already
// fixed by the interface instantiation itself (typedRbac_<Perm>(...)),
// before `requires` is ever called, so there's nothing left to infer.
export interface Rbac<Perm extends string = string> {
  requires<H extends Handler>(name: string, perm: Perm | null, handler: H): H;
  anyone<H extends Handler>(name: string, handler: H): H;
  use(mw: Middleware<Perm>): void;
  audit(options?: { environment?: 'development' | 'production' }): void;
}

export const rbac: Rbac = {
  requires: registry.requires,
  anyone: registry.anyone,
  use: registry.use,
  audit: registry.audit,
};

// Identity function, same idiom as definePolicy_: the runtime object it's
// given back unchanged, its only job is being a generic call site so a
// typo'd permission in a `requires()` call fails the build instead of
// type-checking against `string`. Call once per app, right after `init_`:
//
//   export const rbac = typedRbac_<Perm>(rbacUntyped);
//
// Trailing underscore: GAS's own convention for "not a public endpoint" --
// this is a developer-time helper, not a route, and would otherwise become
// a real google.script.run target once a bundler flattens it into the
// deployed .gs file alongside everything it's imported from.
export function typedRbac_<Perm extends string>(untyped: Rbac = rbac): Rbac<Perm> {
  return untyped as unknown as Rbac<Perm>;
}

// The one static declaration this design ever needs -- see PRD.md
// "Registration". Ships as ordinary library source; whether it survives as
// a true global in a real bundled consumer output (vs. getting wrapped in a
// bundler's module scope) is untested here and is Phase 3/4's job to spike
// against the real build, not assumed solved by this existing.
//
// No trailing underscore, unlike everything else in this file: this is the
// one function that must remain a real google.script.run target, since the
// client calls through it by name for every route. Keeps its leading "__"
// as a different signal -- "route dispatch machinery, don't call directly
// except through the typed client or by route name" -- not GAS privacy.
export function __rbacDispatch(...args: unknown[]): unknown {
  const [name, ...rest] = args as [string, ...unknown[]];
  return registry.dispatch(name, rest);
}

// Trailing underscore: GAS's own convention for "not a public endpoint" --
// see README "GAS naming convention". Not a route.
function currentPermissions_() {
  const { policy, store } = getConfig_();
  const { email } = getPrincipal_();
  return resolvePermissions_(policy, store, email);
}

// Ambient versions of authorization.ts's explicit-argument functions --
// see PRD.md "Checks inside a handler". These read the current principal
// via context() having already run, so they only work from inside a
// dispatched handler (or anything called from one), never at module
// top-level.
export function can_(perm: string): boolean {
  return canGiven(currentPermissions_(), perm);
}

export function require_(perm: string): void {
  requireGiven(currentPermissions_(), perm);
}

export function permissionsFor_(): ReadonlySet<string> {
  return permissionsForGiven(currentPermissions_());
}
