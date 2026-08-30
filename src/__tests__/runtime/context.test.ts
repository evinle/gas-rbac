import { describe, expect, it } from 'vitest';
import { getPrincipal_, runAs_ } from '../../runtime/context.js';

describe('runAs_ / getPrincipal_', () => {
  it('makes the principal available to code called inside runAs_', () => {
    const result = runAs_({ email: 'alice@org.com' }, () => getPrincipal_().email);
    expect(result).toBe('alice@org.com');
  });

  it('restores the previous principal after the callback returns', () => {
    runAs_({ email: 'outer@org.com' }, () => {
      runAs_({ email: 'inner@org.com' }, () => {
        expect(getPrincipal_().email).toBe('inner@org.com');
      });
      expect(getPrincipal_().email).toBe('outer@org.com');
    });
  });

  it('restores the previous principal even if the callback throws', () => {
    expect(() =>
      runAs_({ email: 'alice@org.com' }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(() => getPrincipal_()).toThrow(/outside runAs_/);
  });

  it('throws when read outside any runAs_ call', () => {
    expect(() => getPrincipal_()).toThrow(/outside runAs_/);
  });
});
