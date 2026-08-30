import { describe, expect, it } from 'vitest';
import { definePolicy } from '../../core/policy.js';
import { permissionsForRoles, resolvePermissions } from '../../core/roles.js';
import type { RoleStore } from '../../core/store.js';

const policy = definePolicy({
  permissions: ['invoice:read', 'invoice:submit'],
  roles: {
    member: ['invoice:submit'],
    admin: ['invoice:submit', 'invoice:read'],
  },
  defaultRoles: ['member'],
} as const);

class FakeStore implements RoleStore {
  constructor(private readonly assignments: Record<string, readonly string[]>) {}
  getRoles(email: string): readonly string[] {
    return this.assignments[email] ?? [];
  }
}

describe('permissionsForRoles', () => {
  it('grants defaultRoles even with no explicit roles', () => {
    const perms = permissionsForRoles(policy, []);
    expect(perms).toEqual(new Set(['invoice:submit']));
  });

  it('unions defaultRoles with explicit roles', () => {
    const perms = permissionsForRoles(policy, ['admin']);
    expect(perms).toEqual(new Set(['invoice:submit', 'invoice:read']));
  });

  it('ignores a role name the policy does not recognize', () => {
    const perms = permissionsForRoles(policy, ['made-up-role']);
    expect(perms).toEqual(new Set(['invoice:submit']));
  });
});

describe('resolvePermissions', () => {
  it('resolves through the store, falling back to defaultRoles when unassigned', () => {
    const store = new FakeStore({ 'admin@org.com': ['admin'] });

    expect(resolvePermissions(policy, store, 'admin@org.com')).toEqual(
      new Set(['invoice:submit', 'invoice:read']),
    );
    expect(resolvePermissions(policy, store, 'nobody@org.com')).toEqual(
      new Set(['invoice:submit']),
    );
  });
});
