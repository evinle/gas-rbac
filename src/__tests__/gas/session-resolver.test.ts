import { describe, expect, it } from 'vitest';
import { createSessionResolver } from '../../gas/session-resolver.js';

function fakeSession(email: string): GoogleAppsScript.Base.Session {
  return {
    getActiveUser: () => ({ getEmail: () => email }) as GoogleAppsScript.Base.User,
  } as GoogleAppsScript.Base.Session;
}

describe('createSessionResolver', () => {
  it('returns the active user email', () => {
    const resolver = createSessionResolver(fakeSession('alice@org.com'));
    expect(resolver()).toBe('alice@org.com');
  });

  it('fails closed to null on an empty email, rather than throwing or guessing', () => {
    const resolver = createSessionResolver(fakeSession(''));
    expect(resolver()).toBeNull();
  });
});
