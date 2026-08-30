import { definePolicy, type PermissionOf } from '../../src/index.js';

// This is the file PRD.md means by "Role definitions in code": committed,
// reviewed in a pull request, no runtime read. Compare policy.ts's shape here
// with roles.ts's shape below -- assignments live somewhere else entirely.
export const policy = definePolicy({
  permissions: ['invoice:read', 'invoice:submit', 'invoice:approve'],
  roles: {
    member: ['invoice:submit'],
    approver: ['invoice:submit', 'invoice:read', 'invoice:approve'],
    admin: ['invoice:submit', 'invoice:read', 'invoice:approve'],
  },
  defaultRoles: ['member'],
} as const);

// Derived, not hand-written -- rename a permission in `policy` above and this
// type updates on its own. Exported so route handlers elsewhere can type
// against it without importing `policy` itself.
export type Perm = PermissionOf<typeof policy>;
