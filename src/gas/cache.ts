import type { RoleStore } from '../core/store.js';

// The one piece of per-request I/O worth caching -- see PRD.md "Cache with
// getScriptCache, keyed on a hash of the active email". CacheService.getUserCache()
// partitions by an ambiguous notion of "user" that could resolve to the
// deployment owner under execute-as-me (the same fail-open trap as
// GroupsApp); the script cache with an explicit, hashed email in the key
// can't land on the wrong person's entry.
//
// Wraps any RoleStore rather than being specific to createPropertiesStore_,
// so caching is a decorator you opt into, not a property of the store
// itself. `cache` and `hash` default to the real globals but are parameters
// so a test can pass fakes without stubbing `CacheService`/`Utilities`.
//
// Trailing underscore throughout this file: GAS's own convention for "not
// a public endpoint" -- see README "GAS naming convention". None of these
// are routes.
const DEFAULT_TTL_SECONDS = 300;

function cacheKeyFor_(email: string, hash: (input: string) => string): string {
  return `rbac:roles:${hash(email)}`;
}

export function withScriptCache_(
  store: RoleStore,
  cache: GoogleAppsScript.Cache.Cache = CacheService.getScriptCache(),
  hash: (input: string) => string = sha256Hex_,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): RoleStore {
  return {
    getRoles(email: string): readonly string[] {
      const key = cacheKeyFor_(email, hash);
      const cached = cache.get(key);
      if (cached !== null) {
        return JSON.parse(cached);
      }
      const roles = store.getRoles(email);
      cache.put(key, JSON.stringify(roles), ttlSeconds);
      return roles;
    },
  };
}

// Found the hard way (Phase 4, porting the invoice app): granting someone a
// role through createPropertiesStore_ takes effect on the very next request
// with no redeploy needed -- but only if nothing is caching the old result.
// withScriptCache_'s whole point is caching that result for up to ttlSeconds,
// which silently reintroduces the staleness the properties store alone
// doesn't have. Without this, the only way to force a change through is to
// hand-compute the same SHA-256 key and call CacheService directly -- worth
// having as a real function instead of a one-off console snippet.
export function invalidateCachedRoles_(
  email: string,
  cache: GoogleAppsScript.Cache.Cache = CacheService.getScriptCache(),
  hash: (input: string) => string = sha256Hex_,
): void {
  cache.remove(cacheKeyFor_(email, hash));
}

function sha256Hex_(input: string): string {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return bytes.map((byte) => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
}
