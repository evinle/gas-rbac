import { describe, expect, it } from 'vitest';
import { definePolicy } from './policy.js';

describe('definePolicy', () => {
  it('returns the spec unchanged', () => {
    const spec = {
      permissions: ['invoice:read'],
      roles: { admin: ['invoice:read'] },
      defaultRoles: [],
    } as const;

    expect(definePolicy(spec)).toBe(spec);
  });
});
