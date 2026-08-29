import { describe, expect, it } from 'vitest';
import { can, permissionsFor, require } from './authorization.js';
import { AuthorizationError } from './errors.js';

describe('can', () => {
  it('is true when the permission is in the set', () => {
    expect(can(new Set(['invoice:read']), 'invoice:read')).toBe(true);
  });

  it('is false when it is not', () => {
    expect(can(new Set(['invoice:read']), 'invoice:submit')).toBe(false);
  });
});

describe('require', () => {
  it('does not throw when the permission is present', () => {
    expect(() => require(new Set(['invoice:read']), 'invoice:read')).not.toThrow();
  });

  it('throws AuthorizationError naming the missing permission', () => {
    expect(() => require(new Set(['invoice:read']), 'invoice:submit')).toThrow(AuthorizationError);
    try {
      require(new Set(['invoice:read']), 'invoice:submit');
    } catch (e) {
      expect((e as AuthorizationError).perm).toBe('invoice:submit');
    }
  });
});

describe('permissionsFor', () => {
  it('returns the set unchanged, for feeding a template', () => {
    const perms = new Set(['invoice:read']);
    expect(permissionsFor(perms)).toBe(perms);
  });
});
