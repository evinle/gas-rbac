import type { PermissionOf, PolicySpec } from './policy.js';
import type { RoleStore } from './store.js';

// An email always carries `defaultRoles` in addition to whatever the store
// assigns, so a store with no entry for someone still resolves to the floor
// grant rather than nothing -- see PRD.md's note on `defaultRoles`.
export function permissionsForRoles<Policy extends PolicySpec<any, any>>(
  policy: Policy,
  roleNames: readonly string[],
): Set<PermissionOf<Policy>> {
  const result = new Set<PermissionOf<Policy>>();
  const roleTable = policy.roles as Record<string, readonly PermissionOf<Policy>[]>;
  for (const role of new Set([...policy.defaultRoles, ...roleNames])) {
    // A role name from the store that isn't in the policy is untrusted data,
    // not a code bug -- ignore it rather than throw, so a stale or malformed
    // store entry denies extra permissions instead of taking the app down.
    const perms = roleTable[role];
    if (!perms) continue;
    for (const perm of perms) result.add(perm);
  }
  return result;
}

export function resolvePermissions<Policy extends PolicySpec<any, any>>(
  policy: Policy,
  store: RoleStore,
  email: string,
): Set<PermissionOf<Policy>> {
  return permissionsForRoles(policy, store.getRoles(email));
}
