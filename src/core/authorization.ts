import { AuthorizationError } from './errors.js';

// These take an explicit permission set rather than reading ambient context,
// which is what makes them pure-TypeScript-testable in Phase 1. The
// no-argument `can`/`require`/`permissionsFor` a route handler actually calls
// are a thin Phase 2 wrapper that resolves the current principal's set via
// `runAs`'s ambient context and closes over it -- see PRD.md "Ambient context".
//
// Trailing underscore on all three: GAS's own convention for "not a public
// endpoint" -- see README "GAS naming convention". Every top-level
// `function` a bundler flattens into the deployed .gs file is otherwise a
// real google.script.run target; these are internal primitives, not routes.

// `NoInfer` on `perm` matters: without it, TypeScript infers `Perm` from
// *both* arguments and unions the two literal types together rather than
// checking one against the other, so a typo'd permission would silently
// widen the type instead of failing the build -- the exact bug this
// package exists to prevent. `NoInfer` pins `Perm` to whatever `perms`
// already is and makes `perm` a real check against it.
export function can_<Perm extends string>(perms: ReadonlySet<Perm>, perm: NoInfer<Perm>): boolean {
  return perms.has(perm);
}

export function require_<Perm extends string>(perms: ReadonlySet<Perm>, perm: NoInfer<Perm>): void {
  if (!perms.has(perm)) throw new AuthorizationError(perm);
}

export function permissionsFor_<Perm extends string>(perms: ReadonlySet<Perm>): ReadonlySet<Perm> {
  return perms;
}
