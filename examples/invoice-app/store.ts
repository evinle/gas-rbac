import type { RoleStore } from '../../src/index.js';

// Stands in for the Phase 3 Script Properties adapter. Shape is exactly what
// PRD.md specifies for assignments: `{"alice@org.com": ["admin"]}`. This one
// is a plain object because the example has no PropertiesService to call --
// swap this file for the real adapter and nothing else in the app changes,
// since everything else only depends on the `RoleStore` interface.
const assignments: Record<string, readonly string[]> = {
  'alice@org.com': ['admin'],
  'bob@org.com': ['approver'],
  // 'carol@org.com' is deliberately absent -- she gets `defaultRoles` only.
};

export const roleStore: RoleStore = {
  getRoles(email) {
    return assignments[email] ?? [];
  },
};
