// Runnable walkthrough of Phase 2: registration, dispatch, ambient checks,
// and middleware -- everything demo.ts doesn't cover, since that one only
// exercises Phase 1's explicit-argument primitives. Run with:
//   npx tsx examples/invoice-app/phase2-demo.ts
import { __rbacDispatch, can, init, permissionsFor, rbac, require } from '../../src/index.js';
import type { Middleware } from '../../src/index.js';
import { createRegistry } from '../../src/runtime/registry.js';
import { policy } from './policy.js';
import { roleStore } from './store.js';

function section(title: string) {
  console.log(`\n-- ${title} --`);
}

// Stands in for Session.getActiveUser().getEmail() -- a real Apps Script
// adapter (Phase 3) reads the actual visitor; here we just flip a variable
// to simulate different people opening the same deployed web app.
let activeUser: string | null = null;

const invoices = [{ id: 'inv-1', amount: 500 }];

section('registration: rbac.requires / rbac.anyone, same shape as authoring a real app');
rbac.anyone('ping', () => 'pong');
rbac.requires('listInvoices', 'invoice:read', () => invoices);
rbac.requires('approveInvoice', 'invoice:approve', (id: string) => `approved ${id}`);
// Secondary in-handler checks, not the route gate itself -- see PRD.md
// "can and require cover secondary checks, like an admin-only field on an
// otherwise open endpoint."
rbac.anyone('invoiceSummary', () => {
  const base = `${invoices.length} invoice(s) on file`;
  return can('invoice:approve') ? `${base} (approver view)` : base;
});
rbac.anyone('whoAmI', () => {
  require('invoice:read'); // throws AuthorizationError if the caller lacks it, masked on the way out
  return { perms: [...permissionsFor()] };
});

section('use(): a custom middleware, applied even though it is registered after every route above');
const callCounts = new Map<string, number>();
const countCalls: Middleware = (next, meta) => (...args) => {
  callCounts.set(meta.name, (callCounts.get(meta.name) ?? 0) + 1);
  return next(...args);
};
rbac.use(countCalls);

init({
  policy,
  store: roleStore,
  resolver: () => activeUser,
  logger: (event) => console.log('  [logger]', JSON.stringify(event)),
});

section('dispatch: __rbacDispatch is the one static entry point every call goes through');
activeUser = 'alice@org.com'; // admin, per store.ts
console.log('ping ->', __rbacDispatch('ping'));
console.log('listInvoices (alice, admin) ->', __rbacDispatch('listInvoices'));

section('auth middleware gates the route -- carol (unassigned, defaultRoles only) gets masked, not the real error');
activeUser = 'carol@org.com';
try {
  __rbacDispatch('approveInvoice', 'inv-1');
} catch (e) {
  console.log('carol denied ->', (e as Error).message); // "request denied", not "carol lacks invoice:approve"
}

section('ambient can()/require()/permissionsFor() read whichever principal is dispatching right now');
activeUser = 'carol@org.com';
console.log('carol summary ->', __rbacDispatch('invoiceSummary'));
try {
  __rbacDispatch('whoAmI'); // carol has no invoice:read -- require() throws, errorMask masks it
} catch (e) {
  console.log('carol whoAmI ->', (e as Error).message);
}

activeUser = 'alice@org.com';
console.log('alice summary ->', __rbacDispatch('invoiceSummary'));
console.log('alice whoAmI ->', __rbacDispatch('whoAmI'));

section('use() middleware applied to every dispatch above, including ones registered before it existed');
console.log('call counts ->', Object.fromEntries(callCounts));

section('audit(): a route colliding with a reserved client method name');
const scratchRegistry = createRegistry([]);
scratchRegistry.anyone('withSuccessHandler', () => 'this would silently never dispatch from the browser');
try {
  scratchRegistry.audit();
} catch (e) {
  console.log('audit caught it ->', (e as Error).message);
}
