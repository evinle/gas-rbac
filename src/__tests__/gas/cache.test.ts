import { describe, expect, it, vi } from 'vitest';
import { invalidateCachedRoles, withScriptCache } from '../../gas/cache.js';
import type { RoleStore } from '../../core/store.js';

function fakeCache(): GoogleAppsScript.Cache.Cache {
  const backing = new Map<string, string>();
  return {
    get: (key: string) => backing.get(key) ?? null,
    put: (key: string, value: string) => {
      backing.set(key, value);
    },
    remove: (key: string) => {
      backing.delete(key);
    },
  } as unknown as GoogleAppsScript.Cache.Cache;
}

const noopHash = (input: string) => `hash:${input}`;

describe('withScriptCache', () => {
  it('returns the underlying store result on a cache miss', () => {
    const store: RoleStore = { getRoles: () => ['admin'] };
    const cached = withScriptCache(store, fakeCache(), noopHash);
    expect(cached.getRoles('alice@org.com')).toEqual(['admin']);
  });

  it('does not call the underlying store again on a cache hit', () => {
    const getRoles = vi.fn().mockReturnValue(['admin']);
    const store: RoleStore = { getRoles };
    const cache = fakeCache();
    const cached = withScriptCache(store, cache, noopHash);

    cached.getRoles('alice@org.com');
    cached.getRoles('alice@org.com');

    expect(getRoles).toHaveBeenCalledTimes(1);
  });

  it('hashes the email into the cache key rather than using it directly', () => {
    const store: RoleStore = { getRoles: () => ['admin'] };
    const putSpy = vi.fn();
    const cache = { get: () => null, put: putSpy } as unknown as GoogleAppsScript.Cache.Cache;

    withScriptCache(store, cache, noopHash).getRoles('alice@org.com');

    expect(putSpy).toHaveBeenCalledWith(expect.stringContaining('hash:alice@org.com'), expect.any(String), expect.any(Number));
  });

  it('two different emails never collide on the same cache entry', () => {
    const cache = fakeCache();
    const store: RoleStore = {
      getRoles: (email) => (email === 'alice@org.com' ? ['admin'] : ['member']),
    };
    const cached = withScriptCache(store, cache, noopHash);

    expect(cached.getRoles('alice@org.com')).toEqual(['admin']);
    expect(cached.getRoles('bob@org.com')).toEqual(['member']);
  });
});

describe('invalidateCachedRoles', () => {
  it('forces the next getRoles call to go back to the underlying store', () => {
    const getRoles = vi.fn().mockReturnValue(['admin']);
    const store: RoleStore = { getRoles };
    const cache = fakeCache();
    const cached = withScriptCache(store, cache, noopHash);

    cached.getRoles('alice@org.com'); // cache miss, calls the store, caches the result
    cached.getRoles('alice@org.com'); // cache hit, does not call the store again
    expect(getRoles).toHaveBeenCalledTimes(1);

    invalidateCachedRoles('alice@org.com', cache, noopHash);

    cached.getRoles('alice@org.com'); // cache miss again after invalidation
    expect(getRoles).toHaveBeenCalledTimes(2);
  });

  it('uses the same key derivation as withScriptCache, so it invalidates the right entry', () => {
    const cache = fakeCache();
    const removeSpy = vi.spyOn(cache, 'remove');
    invalidateCachedRoles('alice@org.com', cache, noopHash);
    expect(removeSpy).toHaveBeenCalledWith(expect.stringContaining('hash:alice@org.com'));
  });
});
