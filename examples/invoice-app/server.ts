// Phase 4: the real invoice app, using the real library -- not a
// hand-transcribed spike, not fakes. This is the entry point esbuild
// bundles into dist/Code.js (see build.js for why cjs format + a stripped
// module.exports line is what makes the output survive as real Apps
// Script globals).
import { __rbacDispatch, init_, permissionsFor_, rbac as rbacUntyped, typedRbac_ } from '../../src/index.js';
import { createPropertiesStore_, createSessionResolver_, withScriptCache_ } from '../../src/gas/index.js';
import { policy, type Perm } from './policy.js';

init_({
  policy,
  store: withScriptCache_(createPropertiesStore_()),
  resolver: createSessionResolver_(),
  logger: (event) => console.log(JSON.stringify(event)),
});

// Re-types the ambient singleton against this app's own policy, so a
// typo'd permission string below (e.g. 'invoice:raed') fails the build --
// see PRD.md/README "threading Perm through requires and middleware".
const rbac = typedRbac_<Perm>(rbacUntyped);

// In-memory "repository" -- resets every cold start, same as every other
// piece of Apps Script state that isn't PropertiesService or a real
// spreadsheet/database. Fine for this example; a real app would read/write
// a Sheet or Drive-backed store here instead.
const invoices: Array<{ id: string; amount: number }> = [{ id: 'inv-1', amount: 500 }];

rbac.requires('listInvoices', 'invoice:read', () => invoices);

rbac.requires('submitInvoice', 'invoice:submit', (amount: number) => {
  const invoice = { id: `inv-${invoices.length + 1}`, amount };
  invoices.push(invoice);
  return invoice;
});

rbac.requires('approveInvoice', 'invoice:approve', (id: string) => {
  const invoice = invoices.find((i) => i.id === id);
  if (!invoice) throw new Error('no such invoice');
  return invoice;
});

// Cosmetic only -- see PRD.md "permissionsFor_ is the one people will use.
// It feeds the HTML template so members do not see an invoice table they
// cannot load." The route gate above is the real control.
rbac.anyone('whoAmI', () => ({ perms: [...permissionsFor_()] }));

// doGet is not registered through rbac.anyone -- Apps Script calls it
// directly by name (spike #5, issue #5: confirmed it resolves fine either
// way), it never goes through __rbacDispatch or google.script.run at all.
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutputFromFile('web');
}

// Exported so esbuild's tree shaker sees them as used API surface rather
// than dead code with no visible callers -- see build.js.
export { doGet, __rbacDispatch };
