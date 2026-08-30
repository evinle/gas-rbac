import { describe, expect, it } from 'vitest';
import { getPrincipal, runAs } from '../../runtime/context.js';

describe('runAs / getPrincipal', () => {
  it('makes the principal available to code called inside runAs', () => {
    const result = runAs({ email: 'alice@org.com' }, () => getPrincipal().email);
    expect(result).toBe('alice@org.com');
  });

  it('restores the previous principal after the callback returns', () => {
    runAs({ email: 'outer@org.com' }, () => {
      runAs({ email: 'inner@org.com' }, () => {
        expect(getPrincipal().email).toBe('inner@org.com');
      });
      expect(getPrincipal().email).toBe('outer@org.com');
    });
  });

  it('restores the previous principal even if the callback throws', () => {
    expect(() =>
      runAs({ email: 'alice@org.com' }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(() => getPrincipal()).toThrow(/outside runAs/);
  });

  it('throws when read outside any runAs call', () => {
    expect(() => getPrincipal()).toThrow(/outside runAs/);
  });
});
