// Runnable walkthrough of Phase 1's explicit-argument primitives -- testing
// a handler's authorization logic without wiring up dispatch or ambient
// context. Imported from authorization.ts directly rather than the top-level
// package export, since `can`/`require`/`permissionsFor` at that barrel are
// now the ambient, no-argument versions Phase 2 adds (see rbac.ts) -- those
// only work from inside a dispatched route, which this example doesn't set
// up. For that walkthrough, see phase2-demo.ts alongside this file. Run with:
//   npx tsx examples/invoice-app/demo.ts
import { can, permissionsFor, require } from '../../src/authorization.js';
import { AuthorizationError } from '../../src/errors.js';
import { resolvePermissions } from '../../src/roles.js';
import { policy } from './policy.js';
import { roleStore } from './store.js';

function section(title: string) {
  console.log(`\n-- ${title} --`);
}

section('resolvePermissions: store role + defaultRoles -> permission set');
// Alice is assigned 'admin' in store.ts. resolvePermissions unions that
// role's permissions with defaultRoles ('member'), though admin already
// covers member's one permission here so the union isn't visible in the set.
const alicePerms = resolvePermissions(policy, roleStore, 'alice@org.com');
console.log('alice@org.com ->', [...alicePerms]);

// Carol has no entry in the store at all. She still resolves to something,
// because defaultRoles is the floor every authenticated user gets -- the
// store never needs to be seeded with every employee's email.
const carolPerms = resolvePermissions(policy, roleStore, 'carol@org.com');
console.log('carol@org.com (unassigned) ->', [...carolPerms]);

section('can: boolean check, safe to use in a template');
console.log('can alice approve invoices?', can(alicePerms, 'invoice:approve'));
console.log('can carol approve invoices?', can(carolPerms, 'invoice:approve'));

// Would fail at compile time, not just return false -- 'invoice:aprove' is
// not in PermissionOf<typeof policy>, so tsc rejects the typo before it ever
// reaches a route. This is the whole point of deriving Perm from the policy
// object instead of hand-writing a union:
//   can(carolPerms, 'invoice:aprove')  // <- uncomment to see it fail

section('require: throws AuthorizationError instead of returning a boolean');
try {
  require(carolPerms, 'invoice:approve');
} catch (e) {
  if (e instanceof AuthorizationError) {
    console.log(`carol denied -- caught AuthorizationError for "${e.perm}"`);
  }
}
require(alicePerms, 'invoice:approve'); // does not throw
console.log('alice require-checked for invoice:approve -- no throw');

section('permissionsFor: feeds a template, cosmetic only');
// This is the PRD's stated use: hide the approve button for someone who
// cannot approve, purely so the UI does not offer a dead end. It changes
// nothing about whether the route itself is reachable -- require() at the
// route is still the only real gate, this is not a second one.
function renderApproveButton(perms: ReadonlySet<string>): string {
  return can(permissionsFor(perms), 'invoice:approve')
    ? '[Approve]'
    : '(approve hidden -- no invoice:approve)';
}
console.log('alice UI:', renderApproveButton(alicePerms));
console.log('carol UI:', renderApproveButton(carolPerms));
