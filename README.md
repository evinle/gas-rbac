# gas-rbac

Role-based access control for Google Apps Script web apps, written in TypeScript, bundled into the consumer's own project — not distributed as an Apps Script library. See `PRD.md` for the full rationale behind every decision below; this file is the how, not the why.

## The threat model, before anything else

This matters more than the API reference, so it goes first.

1. **Deployments run execute-as-me.** The app runs as the owner's identity for every visitor, not the visitor's own. This is deliberate (see `PRD.md`, "Deployed execute-as-me") — but it means Google is no longer distinguishing between users at all. Authorization is now entirely this package's job, not Google's.
2. **Identity comes from `Session.getActiveUser()`, never `getEffectiveUser()`.** Under execute-as-me, `getEffectiveUser()` returns the *owner* for every visitor — gating on it means every check passes for everyone, silently. `getActiveUser()` is the actual visitor, and it fails closed (empty string) when they're outside the owner's domain or haven't consented.
3. **Every global function is a public endpoint.** `google.script.run.anyFunctionName()` works from the browser console whether or not there's a button for it anywhere in the UI. There is no route table and no allowlist beneath Apps Script's deployment settings. Hiding UI does nothing. This applies to *this library's own internal functions too*, once a bundler flattens them into your deployed `.gs` file — see "GAS naming convention" below for how this package avoids handing out its own internals as accidental endpoints.
4. **The route gate is the only real gate.** `permissionsFor_()` in a template hides UI a user can't use — that's cosmetic. The actual control is the permission check `rbac.requires` attaches to a route. If you register a route with `rbac.anyone` when it should have required a permission, nothing else in the system will catch that for you.

If you take one thing from this file: every function you register is reachable by anyone who can open the deployment, regardless of what the UI shows them. Register with `rbac.requires(name, perm, handler)` by default, and reach for `rbac.anyone` only when you mean it.

## Install

Published to the public npm registry: `npm install @evinle/gas-rbac`. No registry config or auth token needed to install — it's a public scoped package.

It bundles into the deployed `.gs` file the same way any other dependency in your Apps Script project would (see Deploying, below).

**Publishing** (maintainers only): `npm publish`, logged in as a user with publish rights on the `@evinle` npm scope (`npm login` first if needed). `publishConfig.access: "public"` is required on first publish — npm defaults a scoped package to private otherwise, which fails outright on a free account and silently gatekeeps on a paid one.

## GAS naming convention: the trailing underscore

Apps Script treats a top-level function whose name ends with `_` as private — `google.script.run` won't expose it to the client. That matters more here than in typical Apps Script code, because point 3 above is a real, non-hypothetical finding from building this library: a bundler like esbuild, run with the settings this package needs (see Deploying), flattens the *entire* transitive dependency graph into one shared top-level scope. Every function this library declares — not just the ones re-exported from its package entry points, literally every named `function` anywhere in `src/core`, `src/runtime`, or `src/gas` that a bundled `server.ts` transitively imports — ends up a real top-level declaration in your deployed `Code.js`, whether or not you ever reference it. Confirmed by inspecting `examples/invoice-app/dist/Code.js` directly: before this fix, functions like `getConfig`, `runAs`, `compose`, and even `sha256Hex` (never intended to be called by anything but this library's own internals) showed up as callable from the browser console.

So every function this package exports — `definePolicy_`, `init_`, `runAs_`, `can_`, `require_`, `permissionsFor_`, `createSessionResolver_`, `createPropertiesStore_`, `withScriptCache_`, `invalidateCachedRoles_`, `typedRbac_`, and more besides — carries a trailing underscore. Exactly two functions in the whole library are exempt, because they must remain real `google.script.run`/Apps Script targets: **`__rbacDispatch`** (the single dispatch entry point every route call goes through) and **`doGet`** (the platform's own required entry point, which you write yourself). `__rbacDispatch` keeps its leading `__` as a different signal — "route-dispatch machinery, not something you call directly except through the typed client or by route name" — that's unrelated to GAS's own privacy convention.

This is also why arrow-function values like `rbac`, `context`, `auth`, `errorMask`, and `logger` don't need suffixing at all: `google.script.run` builds its callable list from literal `function name() {}` *declarations* found by parsing source text, not from `const`/`var` bindings assigned an arrow function or object literal, so those were never exposed regardless of name (confirmed by an earlier spike — see `spike-findings.md`).

## Quickstart

**1. Define the policy** — role-to-permission mappings, in code, reviewed like any other change:

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

`as const` is required — it's what lets `PermissionOf` derive a real string-literal union instead of widening everything to `string`, which is the whole point: a typo'd permission string fails the build instead of silently denying at runtime.

**2. Wire up the real Apps Script adapters, initialize, and type the singleton against your policy:**

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
// typo'd permission string in step 3 below fails the build instead of
// type-checking against a bare `string`.
const rbac = typedRbac_<Perm>(rbacUntyped);
```

Role *definitions* live in `policy.ts`, in version control. Role *assignments* — who has which role — live behind `RoleStore`, a one-method interface (`getRoles(email): readonly string[]`). `createPropertiesStore_` is the reference adapter this package ships (one JSON blob in a Script Property), but it's just one implementation of that interface — a Google Sheet, BigQuery, or an internal role service are equally valid `RoleStore`s, and the library never knows or cares which one you're using. `withScriptCache_` wraps any `RoleStore` to cache lookups; see the caching note below before reaching for it.

**3. Register routes:**

```ts
rbac.requires('listInvoices', 'invoice:read', () => invoiceRepo.list());
rbac.requires('submitInvoice', 'invoice:submit', (amount: number) => invoiceRepo.submit(amount));
rbac.anyone('whoAmI', () => ({ perms: [...permissionsFor_()] }));

rbac.audit(); // call once at startup: flags duplicate registrations and reserved-name collisions

function doGet() {
  return HtmlService.createHtmlOutputFromFile('web');
}

// Export so a bundler's tree-shaker sees these as used, not dead code —
// see "Deploying" below.
export { doGet, __rbacDispatch };
```

The route name is written twice on purpose — once as the binding, once as the string `requires` takes — because a function expression is anonymous and `requires` has no way to infer what you're about to assign it to. Passing a permission string not in your policy (a typo like `'invoice:raed'`) fails to compile, thanks to step 2's `typedRbac_<Perm>` cast. `rbac.audit()` is what catches a duplicate name (the second registration silently shadows the first otherwise) and a name that collides with the typed client's three reserved chain methods (below).

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

See `examples/invoice-app/` for all four pieces wired together as a real, deployable app, including the esbuild setup that makes step 4 possible from a plain `.html` template.

## API

### `definePolicy_(spec)` / `PermissionOf<typeof policy>`

Returns the policy object unchanged — its only job is to be a generic call site TypeScript can infer literal types through. `defaultRoles` is the floor every authenticated user gets, so you don't need to seed a store with everyone's email just to grant the baseline.

### `init_({ policy, store, resolver, logger? })`

One-time setup. `store` is a `RoleStore`; `resolver` is a `() => string | null` that resolves the current principal's email (`createSessionResolver_()` for the real Apps Script one). No separate `cache` option — caching composes at the `store` call site via `withScriptCache_`, not through `init_` itself.

### `typedRbac_<Perm>(rbac?)`

Re-types the ambient `rbac` singleton against one app's own `Perm` union, so `rbac.requires`'s permission argument and `rbac.use`'s middleware are checked against your real policy instead of a bare `string`. An identity function at runtime — same idiom as `definePolicy_` — call it once, right after `init_`, and use the object it returns everywhere else. Skippable: the untyped `rbac` singleton works exactly as before, just without that one compile-time check.

### `rbac.requires(name, perm, handler)` / `rbac.anyone(name, handler)`

Register a route. `requires` gates on a permission from your policy; `anyone` registers a route with no gate at all — reach for it deliberately, not as a default. Both return the handler unchanged, so you can still export/test it directly.

### `rbac.use(middleware)`

Registers global middleware, applied to every route regardless of where `use()` is called relative to `requires()` — composition happens per-request, not at registration time, so import order never decides your security posture. See "Middleware", below.

### `rbac.audit(options?)`

Call once at startup. Reports two problems: a route name registered more than once, and a route name that collides with one of the typed client's three reserved names (`withSuccessHandler`, `withFailureHandler`, `withUserObject`) — a route with one of those names would silently never dispatch, since the client proxy would invoke the real chain method instead of forwarding it. Throws in `development`, `console.error`s in `production` (`options.environment`).

### `__rbacDispatch(name, ...args)`

The single static entry point every route call actually goes through — `google.script.run` builds its callable-method list from literal source-text declarations, not runtime `globalThis` contents, so this is one hand-written function rather than one generated per route. You call it indirectly, through `typedRun` (below) or raw `google.script.run.__rbacDispatch(name, ...args)`. The one function in this library that deliberately keeps no trailing underscore — see "GAS naming convention" above.

### Inside a handler: `permissionsFor_()`, `can_(perm)`, `require_(perm)`

Ambient, no arguments — they read the principal that `rbac`'s own `context` middleware already resolved for the current dispatch. `permissionsFor_()` is the one to reach for, typically to drive what a template renders — it's cosmetic, the route gate above is the real control. `can_`/`require_` cover a secondary check inside an otherwise-open handler (an admin-only field on a route everyone can call).

### `runAs_(principal, fn)`

Exported for testing or time-driven triggers that need to set an ambient principal outside of a real dispatch. Every real request already gets this from `context()` middleware; you shouldn't need to call it directly in route code.

## Middleware

Shipped, applied in this fixed order — outermost first: `errorMask` → `logger` → `context` → `auth` → your handler.

- **`context`** resolves the active user via the configured resolver and opens ambient context for the rest of the chain.
- **`auth`** reads the route's required permission and calls `require_`, throwing `AuthorizationError` on denial.
- **`errorMask`** converts any thrown error into a generic client-facing message before it reaches the browser. Apps Script serializes thrown errors straight to the caller, so an unmasked `AuthorizationError` ("alice@org lacks invoice:read") hands an attacker your permission vocabulary and a working oracle to probe it with.
- **`logger`** records route name, principal, allowed/denied, and duration as structured JSON (Cloud Logging picks this up when a GCP project is attached to the script). Denials are the interesting signal — a spike usually means a broken UI, occasionally something worse.

Write your own as `(next, meta) => (...args) => ...` and attach it with `rbac.use()`. Two rules: stay synchronous (Apps Script has no dependable event loop — a `Promise` here is a trap that only misbehaves under load), and keep construction cheap, since the whole app rebuilds from scratch on every single `google.script.run` call. Do I/O inside the returned handler, not at middleware-factory time.

`Middleware<Perm>` and `Meta<Perm>` are both generic over your policy's permission union (`Meta.perm: Perm | null`) — the same `typedRbac_<Perm>(rbac)` cast from Quickstart step 2 is what makes `rbac.use()` check a custom middleware's `meta.perm` handling against your real `Perm` type instead of a bare `string`.

## The typed client (`@evinle/gas-rbac/client`)

`typedRun<RouteMap>()` wraps `google.script.run` in a `Proxy`: `withSuccessHandler`, `withFailureHandler`, and `withUserObject` pass straight through to the real chain methods and hand back the proxy itself, so chaining keeps working exactly like plain `google.script.run`. Any other property access is treated as a route name and forwarded to `__rbacDispatch(name, ...args)`.

`RouteMap` is a plain interface you hand-write, listing the routes you registered server-side — the same role `ServerAPI`-style interfaces play for other Apps Script projects' `google.script.run` typings. Nothing checks it against your actual registrations; keeping the two in sync is on you, the same tradeoff every hand-written client type carries. It's also entirely optional — skip it and call `__rbacDispatch` directly through raw `google.script.run`, untyped.

This is client-side browser code and lives in its own `@evinle/gas-rbac/client` entry point specifically so importing it never pulls in anything from the server-side `.` or `./gas` entry points, and vice versa. It's also the one part of this library exempt from the trailing-underscore convention above: `typedRun` runs in the browser via a `<script>` tag in your HTML template, never bundled into the Apps Script server project, so `google.script.run`'s exposure rules don't apply to it at all.

## Package layout

Three separate entry points, deliberately not one:

- `@evinle/gas-rbac` — the core policy/runtime API (`definePolicy_`, `init_`, `rbac`, `typedRbac_`, middleware). No Apps Script globals referenced anywhere in this path; testable in plain Node.
- `@evinle/gas-rbac/gas` — the real Apps Script adapters (`createSessionResolver_`, `createPropertiesStore_`, `withScriptCache_`, `invalidateCachedRoles_`). The only entry point that touches `Session`, `PropertiesService`, `CacheService`, or `Utilities`.
- `@evinle/gas-rbac/client` — the browser-side typed client (`typedRun`). Runs inside the HTML service page, never on the server.

Importing the core package should never drag in Apps Script server globals or browser globals you don't need for a given file.

## Caching role lookups

`withScriptCache_(store)` wraps any `RoleStore` and caches `getRoles` results in `CacheService.getScriptCache()`, keyed on a SHA-256 hash of the email (never the raw email, and never `getUserCache()` — its ambiguous per-user partitioning can resolve to the deployment owner under execute-as-me and hand every visitor the owner's roles).

This reintroduces staleness the raw store doesn't have: a role granted through your store won't take effect until the cache entry expires (`ttlSeconds`, default 300) or you call `invalidateCachedRoles_(email)` yourself. Wire that into whatever tool changes someone's role — don't make people wait five minutes or clear the cache by hand.

## Deploying

Apps Script only accepts flat `.gs`/`.html`/`appsscript.json` files, and this library is TypeScript across several ES modules, so a real project needs a bundler. `examples/invoice-app/build.js` has a working esbuild recipe:

- The server bundle (`server.ts` → `dist/Code.js`) must use `format: 'cjs'`, not esbuild's default or `iife` — those wrap the whole bundle in `(() => { ... })()`, which hides `__rbacDispatch` and `doGet` from Apps Script's global scope entirely. `cjs` leaves top-level declarations flat, at the cost of a trailing `module.exports = ...` line referencing a `module` global Apps Script doesn't have — strip that one line as a post-build step.
- Keep the `export` keyword on `doGet`/`__rbacDispatch` in your entry file, or esbuild's tree-shaker drops them as apparently-unused.
- Watch out for a `"sideEffects": false` in your `package.json` — it makes a bundler drop each `rbac.requires` call's registration side effect along with the "unused" module it lives in. Don't set it, and make sure your entry file actually imports every route module.
- The client bundle (`client.ts` → inlined into `web.html`) is different: it's browser code, so it uses `format: 'iife'`/`platform: 'browser'` instead, and there's no `module.exports` line to strip.
- With `format: 'cjs'`/`platform: 'neutral'`, esbuild inlines the *entire* dependency graph flat into one shared top-level scope, not one wrapped module per file — every named `function` declaration anywhere in `src/core`/`src/runtime`/`src/gas` ends up a real top-level global in your `Code.js`, referenced or not. This library's own trailing-underscore naming (above) exists specifically because of this; if you write your own server-side helper functions, apply the same convention to them, or keep them as `const` arrow functions, which `google.script.run`'s source-text parser never picks up regardless of name.

## Non-goals

- **Per-object rules** ("Alice can read invoice 42 but not 43") — that's ReBAC, not RBAC, and out of scope. There's deliberately no resource argument anywhere in this API.
- **Async anything.** Apps Script has no dependable event loop; the whole surface, including middleware, is synchronous by design.
- **A replacement for Google's identity layer.** The deployment's access setting is still the front door. This package handles everything past it.

See `PRD.md` for the full design rationale, and `spike-findings.md` for the platform-behavior spikes (`google.script.run`'s static dispatch, bundler tree-shaking, cache/store live-verification) that this design is built on.
