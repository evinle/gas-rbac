import { describe, expect, it } from 'vitest';
import { definePolicy_ } from '../../core/policy.js';

describe('definePolicy_', () => {
  it('returns the spec unchanged', () => {
    const spec = {
      permissions: ['invoice:read'],
      roles: { admin: ['invoice:read'] },
      defaultRoles: [],
    } as const;

    expect(definePolicy_(spec)).toBe(spec);
  });
});
