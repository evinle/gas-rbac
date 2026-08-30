// Bundled separately from server.ts (see build.js) into dist/Client.js,
// then inlined into web.html -- this runs in the browser via the Apps
// Script HTML service, not on the server, so it must not import anything
// from server.ts or src/core|runtime|gas.
import { typedRun, type RouteMap } from '../../src/client/index.js';

interface Invoice {
  id: string;
  amount: number;
}

// Hand-written to match server.ts's rbac.requires/rbac.anyone calls --
// nothing checks the two stay in sync, the same tradeoff PRD.md accepts
// for v-reimburse's ServerAPI pattern: no codegen, so a route renamed on
// one side without the other is a type error here, not a caught mismatch.
interface RouteMap_ extends RouteMap {
  listInvoices(): Invoice[];
  submitInvoice(amount: number): Invoice;
  approveInvoice(id: string): Invoice;
  whoAmI(): { perms: string[] };
}

function dispatch<K extends keyof RouteMap_>(name: K, ...args: Parameters<RouteMap_[K]>): Promise<ReturnType<RouteMap_[K]>> {
  return new Promise((resolve, reject) => {
    (typedRun<RouteMap_>().withSuccessHandler(resolve).withFailureHandler(reject)[name] as (...a: unknown[]) => void)(
      ...args,
    );
  });
}

function renderInvoices(invoices: Invoice[]): void {
  document.getElementById('invoiceRows')!.innerHTML = invoices
    .map((inv) => `<tr><td>${inv.id}</td><td>${inv.amount}</td></tr>`)
    .join('');
}

dispatch('whoAmI').then((r) => {
  if (r.perms.includes('invoice:approve')) {
    document.getElementById('approveSection')!.style.display = 'block';
  }
});

dispatch('listInvoices')
  .then(renderInvoices)
  .catch((e) => (document.getElementById('invoiceRows')!.innerHTML = `<tr><td colspan="2">${e.message}</td></tr>`));

(globalThis as any).submitInvoice = () => {
  const amount = Number((document.getElementById('amount') as HTMLInputElement).value);
  dispatch('submitInvoice', amount)
    .then((inv) => {
      document.getElementById('submitResult')!.textContent = `submitted ${inv.id}`;
      return dispatch('listInvoices');
    })
    .then(renderInvoices)
    .catch((e) => (document.getElementById('submitResult')!.textContent = e.message));
};

(globalThis as any).approveInvoice = () => {
  const id = (document.getElementById('approveId') as HTMLInputElement).value;
  dispatch('approveInvoice', id)
    .then((inv) => (document.getElementById('approveResult')!.textContent = `approved ${inv.id}`))
    .catch((e) => (document.getElementById('approveResult')!.textContent = e.message));
};
