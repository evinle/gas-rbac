import { describe, expect, it } from 'vitest';
import { can_, permissionsFor_, require_ } from '../../core/authorization.js';
import { AuthorizationError } from '../../core/errors.js';

describe('can_', () => {
  it('is true when the permission is in the set', () => {
    expect(can_(new Set(['invoice:read']), 'invoice:read')).toBe(true);
  });

  it('is false when it is not', () => {
    expect(can_(new Set(['invoice:read']), 'invoice:submit')).toBe(false);
  });
});

describe('require_', () => {
  it('does not throw when the permission is present', () => {
    expect(() => require_(new Set(['invoice:read']), 'invoice:read')).not.toThrow();
  });

  it('throws AuthorizationError naming the missing permission', () => {
    expect(() => require_(new Set(['invoice:read']), 'invoice:submit')).toThrow(AuthorizationError);
    try {
      require_(new Set(['invoice:read']), 'invoice:submit');
    } catch (e) {
      expect((e as AuthorizationError).perm).toBe('invoice:submit');
    }
  });
});

describe('permissionsFor_', () => {
  it('returns the set unchanged, for feeding a template', () => {
    const perms = new Set(['invoice:read']);
    expect(permissionsFor_(perms)).toBe(perms);
  });
});
