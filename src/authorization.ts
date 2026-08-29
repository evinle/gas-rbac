import { AuthorizationError } from './errors.js';

// These take an explicit permission set rather than reading ambient context,
// which is what makes them pure-TypeScript-testable in Phase 1. The
// no-argument `can`/`require`/`permissionsFor` a route handler actually calls
// are a thin Phase 2 wrapper that resolves the current principal's set via
// `runAs`'s ambient context and closes over it -- see PRD.md "Ambient context".

export function can<Perm extends string>(perms: ReadonlySet<Perm>, perm: Perm): boolean {
  return perms.has(perm);
}

export function require<Perm extends string>(perms: ReadonlySet<Perm>, perm: Perm): void {
  if (!perms.has(perm)) throw new AuthorizationError(perm);
}

export function permissionsFor<Perm extends string>(perms: ReadonlySet<Perm>): ReadonlySet<Perm> {
  return perms;
}
