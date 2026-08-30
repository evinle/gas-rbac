// Runs in the browser inside the Apps Script HTML template, never on the
// server -- there is no `google` global anywhere in src/core, src/runtime,
// or src/gas, and this file must never import from any of them. See
// PRD.md "Should we generate a typed client?": the answer isn't code
// generation, it's a hand-written RouteMap interface plus a thin Proxy
// over google.script.run.
//
// @types/google-apps-script only types the server-side runtime, not the
// client-side google.script.run object the HTML service injects into the
// page -- so ScriptRun below is this module's own minimal shape for it,
// not borrowed from that package.
type ChainMethod = 'withSuccessHandler' | 'withFailureHandler' | 'withUserObject';

const CHAIN_METHODS: ReadonlySet<ChainMethod> = new Set([
  'withSuccessHandler',
  'withFailureHandler',
  'withUserObject',
]);

// The HTML service injects `google` as a real global into the page; there's
// no @types package for it (see above), so this is the one ambient
// declaration this module needs to default the parameter below to the real
// thing, the same way src/gas/cache.ts defaults `cache` to
// `CacheService.getScriptCache()`. A test still passes its own fake
// explicitly and never touches this declaration.
declare const google: { script: { run: ScriptRun } };

export interface ScriptRun {
  // `any` rather than `unknown` on the callback params: the handler runs
  // against whichever route gets dispatched next, so it can't be pinned
  // to one route's return type here -- callers narrow it themselves the
  // way `dispatch<K>` does in examples/invoice-app/client.ts. Matches how
  // google.script.run's own (untyped) chain methods work.
  withSuccessHandler(callback: (value: any) => void): ScriptRun;
  withFailureHandler(callback: (error: Error) => void): ScriptRun;
  withUserObject(userObject: object): ScriptRun;
  __rbacDispatch(name: string, ...args: unknown[]): void;
  [route: string]: unknown;
}

// RouteMap is the piece each app hand-writes -- one interface listing every
// route it registered with rbac.requires/rbac.anyone, e.g.
// `{ listInvoices(): Invoice[]; submitInvoice(amount: number): Invoice }`.
// Nothing here generates or checks that against the real registrations;
// it's a typed promise the app makes to itself, the same role
// v-reimburse's ServerAPI interface plays for its own google.script.run
// typings.
export type RouteMap = Record<string, (...args: any[]) => any>;

export type TypedRun<T extends RouteMap> = {
  [K in ChainMethod]: (...args: Parameters<ScriptRun[K]>) => TypedRun<T>;
} & {
  [K in keyof T]: (...args: Parameters<T[K]>) => void;
};

// No Promise conversion, no reimplementation of handler-chain semantics --
// the three chain methods pass straight through to the real scriptRun
// object and hand back the proxy (not scriptRun's own return value) so
// chained calls keep going through this same forwarding logic. Anything
// else is treated as a route name and forwarded to __rbacDispatch, which
// is exactly why audit() rejects a route registered under one of these
// three names: it would silently never dispatch, since the proxy would
// invoke the real chain method instead of forwarding it.
export function typedRun<T extends RouteMap>(scriptRun: ScriptRun = google.script.run): TypedRun<T> {
  return new Proxy(scriptRun, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }
      if (CHAIN_METHODS.has(prop as ChainMethod)) {
        return (...args: unknown[]) => {
          (target[prop] as (...a: unknown[]) => unknown)(...args);
          return receiver;
        };
      }
      return (...args: unknown[]) => target.__rbacDispatch(prop, ...args);
    },
  }) as unknown as TypedRun<T>;
}
