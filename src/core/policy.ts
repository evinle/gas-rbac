export interface PolicySpec<
  Permission extends string = string,
  Roles extends Record<string, readonly Permission[]> = Record<string, readonly Permission[]>,
> {
  permissions: readonly Permission[];
  roles: Roles;
  defaultRoles: readonly string[];
}

// Identity function: the value passed in is returned unchanged. Its only job
// is to be a generic call site that TypeScript infers literal types through,
// so `PermissionOf` can derive a union from `permissions` instead of widening
// it to `string`. `Roles` is inferred from the `roles` object's own keys
// (rather than unifying a separate RoleName parameter against a `Record`),
// which is what lets more than one role key through the same call.
// Requires the caller to pass an `as const` literal.
// Trailing underscore: GAS's own convention for "not a public endpoint" --
// see README "GAS naming convention". Every top-level `function` in the
// dependency graph a bundler flattens into the deployed .gs file is
// otherwise reachable as `google.script.run.definePolicy_(...)`; this is
// a build-time helper, never something a browser should be able to call.
export function definePolicy_<
  Permission extends string,
  Roles extends Record<string, readonly Permission[]>,
>(spec: PolicySpec<Permission, Roles>): PolicySpec<Permission, Roles> {
  return spec;
}

export type PermissionOf<Policy extends PolicySpec<any, any>> =
  Policy extends PolicySpec<infer Permission, any> ? Permission : never;
