// Runnable walkthrough of Phase 1's explicit-argument primitives -- testing
// a handler's authorization logic without wiring up dispatch or ambient
// context. Imported from authorization.ts directly rather than the top-level
// package export, since `can_`/`require_`/`permissionsFor_` at that barrel are
// now the ambient, no-argument versions Phase 2 adds (see rbac.ts) -- those
// only work from inside a dispatched route, which this example doesn't set
// up. For that walkthrough, see phase2-demo.ts alongside this file. Run with:
//   npx tsx examples/invoice-app/demo.ts
import { can_, permissionsFor_, require_ } from '../../src/core/authorization.js';
import { AuthorizationError } from '../../src/core/errors.js';
import { resolvePermissions_ } from '../../src/core/roles.js';
import { policy } from './policy.js';
import { roleStore } from './store.js';

function section(title: string) {
  console.log(`\n-- ${title} --`);
}

section('resolvePermissions_: store role + defaultRoles -> permission set');
// Alice is assigned 'admin' in store.ts. resolvePermissions_ unions that
// role's permissions with defaultRoles ('member'), though admin already
// covers member's one permission here so the union isn't visible in the set.
const alicePerms = resolvePermissions_(policy, roleStore, 'alice@org.com');
console.log('alice@org.com ->', [...alicePerms]);

// Carol has no entry in the store at all. She still resolves to something,
// because defaultRoles is the floor every authenticated user gets -- the
// store never needs to be seeded with every employee's email.
const carolPerms = resolvePermissions_(policy, roleStore, 'carol@org.com');
console.log('carol@org.com (unassigned) ->', [...carolPerms]);

section('can_: boolean check, safe to use in a template');
console.log('can_ alice approve invoices?', can_(alicePerms, 'invoice:approve'));
console.log('can_ carol approve invoices?', can_(carolPerms, 'invoice:approve'));

// Would fail at compile time, not just return false -- 'invoice:aprove' is
// not in PermissionOf<typeof policy>, so tsc rejects the typo before it ever
// reaches a route. This is the whole point of deriving Perm from the policy
// object instead of hand-writing a union:
//   can_(carolPerms, 'invoice:aprove')  // <- uncomment to see it fail

section('require_: throws AuthorizationError instead of returning a boolean');
try {
  require_(carolPerms, 'invoice:approve');
} catch (e) {
  if (e instanceof AuthorizationError) {
    console.log(`carol denied -- caught AuthorizationError for "${e.perm}"`);
  }
}
require_(alicePerms, 'invoice:approve'); // does not throw
console.log('alice require_-checked for invoice:approve -- no throw');

section('permissionsFor_: feeds a template, cosmetic only');
// This is the PRD's stated use: hide the approve button for someone who
// cannot approve, purely so the UI does not offer a dead end. It changes
// nothing about whether the route itself is reachable -- require_() at the
// route is still the only real gate, this is not a second one.
function renderApproveButton(perms: ReadonlySet<string>): string {
  return can_(permissionsFor_(perms), 'invoice:approve')
    ? '[Approve]'
    : '(approve hidden -- no invoice:approve)';
}
console.log('alice UI:', renderApproveButton(alicePerms));
console.log('carol UI:', renderApproveButton(carolPerms));
