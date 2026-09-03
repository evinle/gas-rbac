# gas-rbac

[![npm version](https://img.shields.io/npm/v/@evinle/gas-rbac.svg)](https://www.npmjs.com/package/@evinle/gas-rbac)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Role-based access control for Google Apps Script web apps, written in TypeScript. It bundles into your own project instead of running as a separate Apps Script library, so `PropertiesService`, `CacheService`, and every other ambient call resolves against your project, not this package's.

```bash
npm install @evinle/gas-rbac
```

No registry config or auth token needed. It's a public, unscoped-access package under the `@evinle` scope.

## Why this exists

Apps Script has no application-layer authorization. A web app's deployment settings give you three choices for who can open it and nothing finer than that. Every project that needs "admins see the ledger, everyone else can submit" ends up hand-rolling an email allowlist, and those allowlists rot.

The failure that motivates this package: **every global function in an Apps Script web app is a public endpoint.** `google.script.run.anyFunctionName()` works from the browser console whether or not a button calls it. There's no route table, no allowlist, beneath the deployment's access setting. Hiding UI does nothing. Most Apps Script authors don't know this, and it's the most common way these apps leak.

So gas-rbac has one job: make the set of reachable functions explicit, and make each one carry a permission.

## The threat model

Read this before the API reference.

1. **Deployments run execute-as-me.** The app runs as the owner's identity for every visitor, not the visitor's own. Google stops distinguishing between users the moment you deploy this way. Authorization becomes entirely this package's job.
2. **Identity comes from `Session.getActiveUser()`, never `getEffectiveUser()`.** Under execute-as-me, `getEffectiveUser()` returns the owner for every visitor, so gating on it passes every check for everyone, silently. `getActiveUser()` returns the actual visitor and fails closed (empty string) when they're outside the owner's domain or haven't consented.
3. **The route gate is the only real gate.** `permissionsFor_()` in a template hides UI a user can't use; that's cosmetic. The permission check `rbac.requires` attaches to a route is the actual control. Register a route with `rbac.anyone` when it should have required a permission, and nothing else catches that for you.

Register with `rbac.requires(name, perm, handler)` by default. Reach for `rbac.anyone` only when you mean it.

See `PRD.md` for the full design rationale behind each of these, including why Google Groups and execute-as-user don't work here.

## Quickstart

**1. Define the policy.** Role-to-permission mappings, in code, reviewed like any other change:

```ts
// policy.ts
import { definePolicy_ } from '@evinle/gas-rbac';

export const policy = definePolicy_({
  permissions: ['invoice:read', 'invoice:submit', 'invoice:approve'],
  roles: {
    member:   ['invoice:submit'],
    approver: ['invoice:submit', 'invoice:approve'],
    admin:    ['invoice:submit', 'invoice:read', 'invoice:approve'],
  },
  defaultRoles: ['member'],
} as const);

export type Perm = import('@evinle/gas-rbac').PermissionOf<typeof policy>;
```

`as const` is required. It's what lets `PermissionOf` derive a real string-literal union instead of widening to `string`. That union is the whole point: a typo'd permission string fails the build instead of silently denying at runtime.

**2. Wire up the Apps Script adapters and initialize:**

```ts
// server.ts
import { init_, rbac as rbacUntyped, typedRbac_, __rbacDispatch, permissionsFor_ } from '@evinle/gas-rbac';
import { createPropertiesStore_, createSessionResolver_, withScriptCache_ } from '@evinle/gas-rbac/gas';
import { policy, type Perm } from './policy.js';

init_({
  policy,
  store: withScriptCache_(createPropertiesStore_()),
  resolver: createSessionResolver_(),
  logger: (event) => console.log(JSON.stringify(event)),
});

// Re-types the ambient rbac singleton against this app's Perm union, so a
// typo'd permission string in step 3 fails the build instead of
// type-checking against a bare string.
const rbac = typedRbac_<Perm>(rbacUntyped);
```

Role definitions live in `policy.ts`, in version control. Role assignments, who has which role, live behind `RoleStore`, a one-method interface: `getRoles(email): readonly string[]`. `createPropertiesStore_` is the reference adapter this package ships (one JSON blob in a Script Property), but it's just one implementation. A Google Sheet, BigQuery, or an internal role service work equally well, and the library never knows which one you're using. `withScriptCache_` wraps any `RoleStore` to cache lookups; see [Caching role lookups](#caching-role-lookups) before reaching for it.

**3. Register routes:**

```ts
rbac.requires('listInvoices', 'invoice:read', () => invoiceRepo.list());
rbac.requires('submitInvoice', 'invoice:submit', (amount: number) => invoiceRepo.submit(amount));
rbac.anyone('whoAmI', () => ({ perms: [...permissionsFor_()] }));

rbac.audit(); // call once at startup: flags duplicate registrations and reserved-name collisions

function doGet() {
  return HtmlService.createHtmlOutputFromFile('web');
}

// Export so a bundler's tree-shaker sees these as used, not dead code.
// See "Deploying" below.
export { doGet, __rbacDispatch };
```

The route name is written twice on purpose, once as the binding and once as the string `requires` takes, because a function expression is anonymous and `requires` has no way to infer what you're about to assign it to. A typo'd permission string, like `'invoice:raed'`, fails to compile thanks to step 2's `typedRbac_<Perm>` cast. `rbac.audit()` catches a duplicate name (the second registration otherwise silently shadows the first) and a name that collides with the typed client's three reserved chain methods, covered below.

**4. Call routes from the browser**, through the typed client:

```ts
// client.ts, bundled separately and loaded in your HTML template
import { typedRun, type RouteMap } from '@evinle/gas-rbac/client';

interface Routes extends RouteMap {
  listInvoices(): Invoice[];
  submitInvoice(amount: number): Invoice;
  whoAmI(): { perms: string[] };
}

typedRun<Routes>()
  .withSuccessHandler((invoices) => render(invoices))
  .withFailureHandler((err) => showError(err))
  .listInvoices();
```

`examples/invoice-app/` wires all four pieces together as a real, deployable app, including the esbuild setup that makes step 4 possible from a plain `.html` template.

## API

### `definePolicy_(spec)` / `PermissionOf<typeof policy>`

Returns the policy object unchanged. Its only job is to be a generic call site TypeScript can infer literal types through. `defaultRoles` is the floor every authenticated user gets, so you don't have to seed a store with everyone's email just to grant the baseline.

### `init_({ policy, store, resolver, logger? })`

One-time setup. `store` is a `RoleStore`. `resolver` is a `() => string | null` that resolves the current principal's email; use `createSessionResolver_()` for the real Apps Script one. There's no separate `cache` option: caching composes at the `store` call site through `withScriptCache_`, not through `init_` itself.

### `typedRbac_<Perm>(rbac?)`

Re-types the ambient `rbac` singleton against one app's `Perm` union, so `rbac.requires`'s permission argument and `rbac.use`'s middleware get checked against your real policy instead of a bare `string`. An identity function at runtime, the same idiom as `definePolicy_`. Call it once, right after `init_`, and use the object it returns everywhere else. Skippable: the untyped `rbac` singleton works exactly as before, just without that one compile-time check.

### `rbac.requires(name, perm, handler)` / `rbac.anyone(name, handler)`

Register a route. `requires` gates on a permission from your policy. `anyone` registers a route with no gate at all, so reach for it deliberately, not as a default. Both return the handler unchanged, so you can still export or test it directly.

### `rbac.use(middleware)`

Registers global middleware, applied to every route regardless of where `use()` is called relative to `requires()`. Composition happens per request, not at registration time, so import order never decides your security posture. See [Middleware](#middleware).

### `rbac.audit(options?)`

Call once at startup. It reports two problems: a route name registered more than once, and a route name that collides with one of the typed client's three reserved names (`withSuccessHandler`, `withFailureHandler`, `withUserObject`). A route with one of those names would silently never dispatch, since the client proxy would invoke the real chain method instead of forwarding it. Throws in `development`, calls `console.error` in `production` (`options.environment`).

### `__rbacDispatch(name, ...args)`

The single static entry point every route call goes through by default. `google.script.run` builds its callable-method list from literal source-text declarations, not runtime `globalThis` contents, so this is one hand-written function rather than one generated per route. Call it indirectly, through `typedRun` or raw `google.script.run.__rbacDispatch(name, ...args)`. It's the one function in this library that deliberately keeps no trailing underscore; see [GAS naming convention](#gas-naming-convention-the-trailing-underscore).

### Inside a handler: `permissionsFor_()`, `can_(perm)`, `require_(perm)`

Ambient, no arguments. They read the principal that `rbac`'s own `context` middleware already resolved for the current dispatch. `permissionsFor_()` is the one you'll reach for most, typically to drive what a template renders; it's cosmetic, and the route gate above is the real control. `can_`/`require_` cover a secondary check inside an otherwise-open handler, like an admin-only field on a route everyone can call.

### `runAs_(principal, fn)`

Exported for testing or time-driven triggers that need to set an ambient principal outside a real dispatch. Every real request already gets this from `context()` middleware; you shouldn't need to call it directly in route code.

## Middleware

Shipped, applied in this fixed order, outermost first: `errorMask` wraps `logger` wraps `context` wraps `auth` wraps your handler.

- **`context`** resolves the active user through the configured resolver and opens ambient context for the rest of the chain.
- **`auth`** reads the route's required permission and calls `require_`, throwing `AuthorizationError` on denial.
- **`errorMask`** converts any thrown error into a generic client-facing message before it reaches the browser. Apps Script serializes thrown errors straight to the caller, so an unmasked `AuthorizationError` ("alice@org lacks invoice:read") hands an attacker your permission vocabulary and a working oracle to probe it with.
- **`logger`** records route name, principal, allowed or denied, and duration as structured JSON. Cloud Logging picks this up automatically when a GCP project is attached to the script. Denials are the interesting signal; a spike usually means a broken UI, occasionally something worse.

Write your own as `(next, meta) => (...args) => ...` and attach it with `rbac.use()`. Two rules. Stay synchronous, since Apps Script has no dependable event loop and a `Promise` here is a trap that only misbehaves under load. And keep construction cheap, since the whole app rebuilds from scratch on every single `google.script.run` call; do I/O inside the returned handler, not at middleware-factory time.

`Middleware<Perm>` and `Meta<Perm>` are both generic over your policy's permission union (`Meta.perm: Perm | null`). The same `typedRbac_<Perm>(rbac)` cast from Quickstart step 2 is what makes `rbac.use()` check a custom middleware's `meta.perm` handling against your real `Perm` type instead of a bare `string`.

## The typed client (`@evinle/gas-rbac/client`)

`typedRun<RouteMap>()` wraps `google.script.run` in a `Proxy`. `withSuccessHandler`, `withFailureHandler`, and `withUserObject` pass straight through to the real chain methods and hand back the proxy itself, so chaining keeps working exactly like plain `google.script.run`. Any other property access is treated as a route name and forwarded to `__rbacDispatch(name, ...args)`.

`RouteMap` is a plain interface you hand-write, listing the routes you registered server-side, the same role `ServerAPI`-style interfaces play for other Apps Script projects' `google.script.run` typings. Nothing checks it against your actual registrations; keeping the two in sync is on you, the same tradeoff every hand-written client type carries. It's also entirely optional: skip it and call `__rbacDispatch` directly through raw `google.script.run`, untyped.

This is client-side browser code and lives in its own `@evinle/gas-rbac/client` entry point so importing it never pulls in anything from the server-side `.` or `./gas` entry points, and vice versa. It's also the one part of this library exempt from the trailing-underscore convention below: `typedRun` runs in the browser through a `<script>` tag in your HTML template, never bundled into the Apps Script server project, so `google.script.run`'s exposure rules don't apply to it at all.

## Codegen (opt-in): named routes instead of one dispatcher

By default every route call goes through `__rbacDispatch`, so Apps Script's Executions log and your browser's Network tab show `__rbacDispatch` for every request, not which route ran. `@evinle/gas-rbac/vite-plugin` fixes that for projects that already build with Vite, by generating one real, separately named top-level function per route.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { gasRbacCodegen } from '@evinle/gas-rbac/vite-plugin';

export default defineConfig({
  plugins: [
    gasRbacCodegen({
      entry: './src/server.ts',
      out: './src/dispatch-shims.generated.ts',
      packageName: '@evinle/gas-rbac',
    }),
  ],
});
```

On `buildStart`, the plugin reads `entry` as plain text, finds every literal `rbac.requires(...)`/`rbac.anyone(...)` call by parsing the TypeScript AST, and writes one generated shim per route name to `out`:

```ts
// dispatch-shims.generated.ts, AUTO-GENERATED, do not edit by hand
import { __rbacDispatch } from '@evinle/gas-rbac';
export function listInvoices(...args: unknown[]) { return __rbacDispatch("listInvoices", ...args); }
export function submitInvoice(...args: unknown[]) { return __rbacDispatch("submitInvoice", ...args); }
```

Route discovery is static source parsing, not execution: the plugin never imports or runs `entry`, so a module-scope call like `PropertiesService.getScriptProperties()` in your server file never fires during a build, and there's nothing to stub. The tradeoff is that a route name has to be a string literal for the plugin to see it; a dynamically constructed name won't get a shim.

Two things to wire up alongside the plugin:

- **Import the generated file from your server entry** (the same way you already export `doGet`/`__rbacDispatch`, see [Deploying](#deploying)), so each generated function ends up a real top-level declaration in your bundled `Code.js` and Apps Script sees it as a callable target.
- **Tell the typed client to skip `__rbacDispatch`.** Pass `dispatch: 'named'` to `typedRun`, and it calls each route directly instead of proxying through `__rbacDispatch`:

  ```ts
  typedRun<Routes>(google.script.run, { dispatch: 'named' })
    .withSuccessHandler((invoices) => render(invoices))
    .listInvoices(); // -> google.script.run.listInvoices(...), not __rbacDispatch
  ```

  In `'named'` mode there's no `Proxy` and nothing to intercept: `google.script.run` already exposes each generated function by name, so `typedRun` returns a type-only view over the real object.

This is additive. Skip the plugin entirely and `__rbacDispatch`-based dispatch, `typedRun`'s default mode, keeps working exactly as described above.

## Package layout

Four separate entry points, deliberately not one:

- `@evinle/gas-rbac`, the core policy and runtime API (`definePolicy_`, `init_`, `rbac`, `typedRbac_`, middleware). No Apps Script globals referenced anywhere in this path; testable in plain Node.
- `@evinle/gas-rbac/gas`, the real Apps Script adapters (`createSessionResolver_`, `createPropertiesStore_`, `withScriptCache_`, `invalidateCachedRoles_`). The only entry point that touches `Session`, `PropertiesService`, `CacheService`, or `Utilities`.
- `@evinle/gas-rbac/client`, the browser-side typed client (`typedRun`). Runs inside the HTML service page, never on the server.
- `@evinle/gas-rbac/vite-plugin`, the opt-in codegen plugin (`gasRbacCodegen`). Runs in your build tool, never bundled into either the server or client output.

Importing the core package should never drag in Apps Script server globals or browser globals you don't need for a given file.

## Caching role lookups

`withScriptCache_(store)` wraps any `RoleStore` and caches `getRoles` results in `CacheService.getScriptCache()`, keyed on a SHA-256 hash of the email. Never the raw email, and never `getUserCache()`, whose ambiguous per-user partitioning can resolve to the deployment owner under execute-as-me and hand every visitor the owner's roles.

This reintroduces staleness the raw store doesn't have. A role granted through your store won't take effect until the cache entry expires (`ttlSeconds`, default 300) or you call `invalidateCachedRoles_(email)` yourself. Wire that into whatever tool changes someone's role. Don't make people wait five minutes or clear the cache by hand.

## GAS naming convention: the trailing underscore

Apps Script treats a top-level function whose name ends with `_` as private; `google.script.run` won't expose it to the client. That matters more here than in typical Apps Script code, because it's a real finding from building this library: a bundler like esbuild, run with the settings this package needs (see [Deploying](#deploying)), flattens the entire transitive dependency graph into one shared top-level scope. Every function this library declares, not just the ones re-exported from its package entry points but literally every named `function` anywhere in `src/core`, `src/runtime`, or `src/gas` that a bundled `server.ts` transitively imports, ends up a real top-level declaration in your deployed `Code.js`, whether or not you ever reference it. Confirmed by inspecting a bundled output directly: functions like `getConfig`, `runAs`, `compose`, and `sha256Hex`, never intended to be called by anything but this library's own internals, showed up as callable from the browser console before this fix.

So every function this package exports carries a trailing underscore: `definePolicy_`, `init_`, `runAs_`, `can_`, `require_`, `permissionsFor_`, `createSessionResolver_`, `createPropertiesStore_`, `withScriptCache_`, `invalidateCachedRoles_`, `typedRbac_`, and more besides. Exactly two functions in the whole library are exempt, because they must remain real `google.script.run`/Apps Script targets: `__rbacDispatch` (the single dispatch entry point every default-mode route call goes through) and `doGet` (the platform's own required entry point, which you write yourself). `__rbacDispatch` keeps its leading `__` as a different signal, meaning "route-dispatch machinery, not something you call directly except through the typed client or by route name," unrelated to GAS's own privacy convention.

This is also why arrow-function values like `rbac`, `context`, `auth`, `errorMask`, and `logger` don't need suffixing at all: `google.script.run` builds its callable list from literal `function name() {}` declarations found by parsing source text, not from `const`/`var` bindings assigned an arrow function or object literal, so those were never exposed regardless of name.

## Deploying

Apps Script only accepts flat `.gs`/`.html`/`appsscript.json` files, and this library is TypeScript across several ES modules, so a real project needs a bundler. `examples/invoice-app/build.js` has a working esbuild recipe.

- The server bundle (`server.ts` → `dist/Code.js`) must use `format: 'cjs'`, not esbuild's default or `iife`. Those wrap the whole bundle in `(() => { ... })()`, which hides `__rbacDispatch` and `doGet` from Apps Script's global scope entirely. `cjs` leaves top-level declarations flat, at the cost of a trailing `module.exports = ...` line referencing a `module` global Apps Script doesn't have; strip that one line as a post-build step.
- Keep the `export` keyword on `doGet`/`__rbacDispatch` in your entry file, or esbuild's tree-shaker drops them as apparently unused.
- Watch out for `"sideEffects": false` in your `package.json`. It makes a bundler drop each `rbac.requires` call's registration side effect along with the "unused" module it lives in. Don't set it, and make sure your entry file actually imports every route module.
- The client bundle (`client.ts` → inlined into `web.html`) is different: it's browser code, so it uses `format: 'iife'`/`platform: 'browser'` instead, and there's no `module.exports` line to strip.
- With `format: 'cjs'`/`platform: 'neutral'`, esbuild inlines the entire dependency graph flat into one shared top-level scope, not one wrapped module per file, so every named `function` declaration anywhere in `src/core`/`src/runtime`/`src/gas` ends up a real top-level global in your `Code.js`, referenced or not. This library's own trailing-underscore naming exists specifically because of this. If you write your own server-side helper functions, apply the same convention to them, or keep them as `const` arrow functions, which `google.script.run`'s source-text parser never picks up regardless of name.

## Non-goals

- **Per-object rules**, like "Alice can read invoice 42 but not 43." That's ReBAC, not RBAC, and it's out of scope. There's deliberately no resource argument anywhere in this API.
- **Async anything.** Apps Script has no dependable event loop. The whole surface, including middleware, is synchronous by design.
- **A replacement for Google's identity layer.** The deployment's access setting is still the front door. This package handles everything past it.

## Publishing (maintainers only)

`npm publish`, logged in as a user with publish rights on the `@evinle` npm scope (`npm login` first if needed). `publishConfig.access: "public"` is required on first publish; npm defaults a scoped package to private otherwise, which fails outright on a free account and silently gatekeeps on a paid one.

## License

MIT, see [LICENSE](./LICENSE).

See `PRD.md` for the full design rationale, and `spike-findings.md` for the platform-behavior spikes this design is built on: `google.script.run`'s static dispatch, bundler tree-shaking, and live cache/store verification.
