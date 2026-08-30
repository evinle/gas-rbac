import type { RoleStore } from '../core/store.js';

// Role assignments live as one JSON blob under a single Script Property --
// see PRD.md "Role definitions in code, assignments in a store": this is
// the store half, shaped exactly like the PRD's example,
// {"alice@org.com": ["admin"]}. An admin edits it via a small bound script
// or the Script Properties editor; there's no UI for it in this package.
export const ROLE_ASSIGNMENTS_PROPERTY_KEY = 'RBAC_ROLE_ASSIGNMENTS';

// `properties` defaults to the real global but is a parameter so a test can
// pass a fake without stubbing `PropertiesService` itself.
export function createPropertiesStore(
  properties: GoogleAppsScript.Properties.Properties = PropertiesService.getScriptProperties(),
): RoleStore {
  return {
    getRoles(email: string): readonly string[] {
      const raw = properties.getProperty(ROLE_ASSIGNMENTS_PROPERTY_KEY);
      if (!raw) return [];

      let assignments: unknown;
      try {
        assignments = JSON.parse(raw);
      } catch {
        // A malformed property degrades everyone to defaultRoles rather than
        // throwing for every request -- fail closed (less access), not
        // fail total (the whole app down), and still visible in Cloud
        // Logging for whoever broke it.
        console.error(
          `rbac: Script Property "${ROLE_ASSIGNMENTS_PROPERTY_KEY}" is not valid JSON -- treating all role assignments as empty`,
        );
        return [];
      }

      const roles = (assignments as Record<string, unknown>)[email];
      return Array.isArray(roles) ? roles : [];
    },
  };
}
