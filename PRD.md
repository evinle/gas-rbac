# Apps Script RBAC: product requirements

Status: draft for review
Owner: TBD
Last updated: 2026-08-27

## Summary

An npm package that adds role-based access control to Google Apps Script projects written in TypeScript. Consumers declare a policy in code, wrap each endpoint with a small per-route function, and get it gated before its handler runs.

The target is one afternoon of setup per project and no per-endpoint discipline afterward. If someone adds a route and forgets to think about permissions, that should be a compile error, not a security incident discovered later.

## Why this exists

Apps Script has no application-layer authorization. Google's web app deployment settings offer three coarse choices for who can open the app, and nothing below that. Every project that needs "admins see the ledger, everyone else can submit" ends up hand-rolling an email allowlist, and those allowlists rot.

The failure that motivates this: in a web app, **every global function is a public endpoint**. `google.script.run.anyFunctionName()` works from the browser console whether or not you put a button on it. There is no route table and no allowlist. Hiding UI does nothing. Most Apps Script authors do not know this, and it is the single most common way these apps leak.

So the package has one job. Make the set of reachable functions explicit, and make each one carry a permission.

## Goals

- One policy definition per project, in version control, reviewable in a pull request.
- Endpoint registration that cannot express "reachable but unguarded".
- Permission strings checked by the TypeScript compiler, so a typo fails the build instead of failing closed at runtime.
- An extension point for logging, error handling, auditing, and whatever else a team needs across all routes.
- Zero runtime dependencies, since everything gets inlined into the deployed `.gs` bundle.

## Non-goals

- **Per-object rules.** "Alice can read invoice 42 but not 43" is ReBAC, not RBAC. Supporting it means shipping a policy engine, and policy engines are how small authorization libraries become unusable. Out of scope, and the API deliberately has no resource argument so nobody starts down that road by accident.
- **Container-bound scripts.** No menus, no `onOpen`, no Sheets sidebar. This removes the only real justification for accumulating route names in the type system, which keeps each route wrapper's typing simple and self-contained.
- **Async anything.** Covered below.
- **A replacement for Google's identity layer.** The deployment's access setting is still the front door. This package handles everything past it.

## Key decisions

### Distributed as an npm package, not an Apps Script library

Apps Script has a native library mechanism: deploy a project, others reference it by script ID. It was the obvious candidate and it is the wrong one here.

Libraries run inside the caller's execution but resolve their own project for ambient state. `PropertiesService.getScriptProperties()` inside library code returns the **library's** properties, not the calling script's. Ten apps sharing an RBAC library would share one property bag. That is not an error anyone would catch quickly, which makes it worse than an error.

Library calls also add per-call latency, and consumers pin a version, so shipping an urgent fix means updating every consumer by hand.

Bundling into the consumer's project sidesteps all of it. Their `PropertiesService` call resolves correctly because it runs in their project. As a bonus, TypeScript gives us the compile-time guarantees that are the main reason to build this at all.

### Role definitions in code, assignments in a store

These two halves of a policy change at completely different rates and deserve different homes.

Role to permission mappings change a few times a year and are security critical. They belong in a `Policy.ts` file: git history, code review, atomic deployment with the code that depends on them, and no runtime read. Script Properties give none of that. Anyone with edit access to the project could rewrite the permission model from the editor with no trace.

Assignments of people to roles change weekly and are boring. Those go in an injected store, default Script Properties, shaped `{"alice@org.com": ["admin"]}`.

One Apps Script constraint worth recording: projects only accept `.gs`, `.html`, and `appsscript.json` files, so "JSON in code" means a frozen object literal in a `.ts` file that compiles into the bundle.

### Policy is `as const`, and permissions are a derived type

```ts
export const policy = definePolicy({
  permissions: ['invoice:read', 'invoice:submit'],
  roles: {
    member: ['invoice:submit'],
    admin:  ['invoice:submit', 'invoice:read'],
  },
  defaultRoles: ['member'],
} as const);

type Perm = PermissionOf<typeof policy>;
// 'invoice:read' | 'invoice:submit'
```

Misspelled permission strings are the most common RBAC bug and the hardest to notice, because a permission that does not exist just denies and looks like a config problem. Deriving the union from the policy object kills that class of bug outright. It is the strongest argument for definitions living in code and it exists only because we are in TypeScript.

`defaultRoles` covers the floor granted to any authenticated user, so we do not have to seed a store with every employee's email.

### Deployed execute-as-me, with `drive.file`

The deployment runs as the owner, not as the visiting user. This looks backwards for an access control package and it is the right call.

Under execute-as-user, `drive.file` does not work for shared data. Grants are recorded per user, per app, per file, so a file created during one person's session is invisible to the next person, even in the same script. Making a shared corpus work would mean requesting full `drive` scope from every employee. Every user consenting to full Drive access, forever, for an invoice form.

Under execute-as-me there is one Drive identity, so `drive.file` grants accumulate on the owner's account across all sessions. The script reads back its own files and stays walled off from everything else the owner owns. One consent instead of N, narrow scope instead of broad, and access mediated by reviewable code instead of a consent screen nobody reads.

The tradeoff is that authorization is now entirely our problem. Google is no longer distinguishing between users at all.

### Identity comes from `getActiveUser`, never `getEffectiveUser`

Under execute-as-me, `Session.getEffectiveUser()` returns the owner for every visitor. Gating on it means every check passes for everyone. The visitor is `Session.getActiveUser()`.

`getActiveUser()` returns an empty string when the running user is outside the owner's domain or consent was not granted. The resolver fails closed on empty. This is worth a comment in the source, because the two method names are one word apart and the failure is silent and total.

### `GroupsApp` is unusable and must stay out

Google Groups as the assignment plane is attractive. Admins manage membership in a console that already exists, membership is audited, service accounts can be members.

It does not work here. `GroupsApp.hasGroup()` checks the **effective** user's membership. Under execute-as-me that is the owner, so it will cheerfully report that the owner is in `rbac-invoice-admin@` for every visitor. It fails open, which is the worst possible failure mode for an authorization check.

The Admin SDK Directory API does take an arbitrary member (`AdminDirectory.Members.hasMember`) and would work, but it needs the deployment owner to be a Workspace admin or hold a delegated group-read role. Not assumed. Groups support ships as an optional store adapter, not the default, and its docs need to say plainly why the obvious API is the wrong one.

### Cache with `getScriptCache`, keyed on a hash of the active email

`CacheService.getUserCache()` partitions per user, but it is not clear whether "user" means active or effective. If effective, every visitor would share the owner's cache entry and receive the owner's role set. That is the fail-open scenario again.

`getScriptCache()` with the email hashed into the key is explicit and cannot resolve to the wrong person. Role resolution is the one piece of per-request I/O worth caching, since everything else is in-memory.

### Everything is synchronous

Apps Script's APIs all block. Promises parse under V8 but there is no dependable event loop, and microtasks may never flush before the execution ends. A `Promise<boolean>` from a permission check would be a trap that only fires under load or timing that nobody reproduces locally.

The whole surface is sync, including middleware. Node builtins are also unavailable, so no `crypto`, `Buffer`, or `fs`. Worth an ESLint rule so these cannot arrive through a transitive dependency.

### One enforcement point, at the route

An earlier draft had a `protect(repo, permMap)` wrapper that guarded repository methods, on the theory that a new repo method should not compile until someone assigned it a permission.

Cut, because it checks the same thing the route middleware already checks. The guarantee it appeared to offer was not real either. The risk is not an unguarded repo method, it is an unguarded **exposed** method, and a repo method nobody exposes is unreachable. The moment you expose it you go through `rbac.requires`, which is where the permission decision belongs.

Two enforcement points also raises the question of which one is load-bearing, and a future maintainer removing the wrong one is a real risk. One gate, one answer.

## API

### Setup

```ts
definePolicy(spec)  // returns a typed policy object
init({ policy, store, resolver, logger? })
```

No separate `cache` field, unlike the signature this section originally sketched. Caching turned out not to need its own slot in `init()` at all: `withScriptCache(store)` (Phase 3, `src/gas/cache.ts`) is a `RoleStore` decorator, not a distinct config concern, so it composes at the call site instead —

```ts
init({ policy, store: withScriptCache(createPropertiesStore()), resolver: createSessionResolver() });
```

— which keeps `init()` itself ignorant of caching entirely, consistent with `RoleStore` already being the one pluggable seam for role data.

### Registration

Registration is per route, not through a central builder. **Confirmed by spike** (issue #2, closed): `google.script.run` builds its list of callable methods by parsing source text for literal `function name() {}` declarations, not by inspecting runtime `globalThis` contents. A route whose only trace is a runtime `globalThis[name] = ...` assignment, with no matching declaration anywhere in source, is invisible to the client-side proxy entirely — the call fails in the browser with `... .name is not a function`, before any request reaches the server.

The first response to that finding was a codegen build step, emitting one generated declaration per registered route. **Superseded by a simpler design, prototyped and confirmed working** (issue #11, closed): rather than one declaration per route, ship a single hand-authored static declaration as part of the library's own source — written once, never regenerated, never touched per consumer project:

```js
function __rbacDispatch() {
  return __rbac.dispatch(arguments[0], Array.prototype.slice.call(arguments, 1));
}
```

Authoring looks like the wrapper form, unchanged:

```ts
export const listInvoices = rbac.requires('listInvoices', 'invoice:read',
  () => invoiceRepo.list()
);

export const doGet = rbac.anyone('doGet', () => renderApp());

rbac.use(mw)       // global middleware, applies to every route regardless of registration order
rbac.audit()       // call once at startup: flags duplicate route registrations and reserved names
```

The client calls through the one static entry point by name, rather than a per-route method:

```ts
rbac.call('listInvoices').then(render)   // -> google.script.run...__rbacDispatch('listInvoices')
```

Because `__rbacDispatch` is fixed and ships as ordinary library source, it bundles like any other import — no build step, no consumer configuration, nothing to wire into an arbitrary toolchain. Confirmed live against a deployed web app: variable-length arguments forward correctly through the extra indirection (an `echo(msg)` route round-tripped its argument), and a thrown error inside a dispatched handler reaches `withFailureHandler` intact rather than being swallowed. This closes every open question the codegen build step raised — which build hook runs it, how routes are discovered across a multi-file project, checked-in vs. generated output — because there is no longer a build step to have those questions about. Issue #10 is superseded and closed.

The one constraint carried over unchanged: whatever bundles the final `.gs` output must preserve `__rbacDispatch` and each `rbac.requires` call as real top-level, unmangled, non-tree-shaken code. That was already true for `doGet` before this design existed — not something this adds.

`anyone` is a deliberate keyword, not an omission. Public endpoints exist, `doGet` among them, and reachability should always be something someone typed.

Naming note: `requires` follows Spring Security's `hasPermission`, Django's `permission_required`, and NestJS's `@RequiresPermissions`. Familiar beats clever for a security primitive.

The route name appears twice, once as the binding and once as the string argument — there is no way around this, since a function expression passed as an argument is anonymous and `fn.name` is empty, so `requires` cannot infer the binding it will be assigned to. `audit()` exists to catch two mistakes at startup, not one: a duplicate, where two routes register under the same name and the second silently shadows the first; and a reserved name, where a route registers under one of the client chain's own method names (`withSuccessHandler`, `withFailureHandler`, `withUserObject`). The typed client wrapper (see below) is a `Proxy` that treats any property access other than those three as a route name — a route actually named `withSuccessHandler` would never dispatch, since the proxy would call the real chain method instead and silently never forward it. `audit()` catches this the same way it catches a duplicate: by checking the name at registration time against a small reserved set, shared with the client wrapper's own list rather than duplicated, so the two can't drift. `audit()` throws in development and logs in production.

### Checks inside a handler

```ts
permissionsFor()  // Set<Perm>, for hiding UI in a template
can(perm)         // boolean
require(perm)     // throws AuthorizationError
```

`permissionsFor` is the one people will use. It feeds the HTML template so members do not see an invoice table they cannot load. Cosmetic only. The route gate is the real control, and the README should say so next to a worked example of calling the endpoint from devtools.

`can` and `require` cover secondary checks, like an admin-only field on an otherwise open endpoint. If no consumer has that case after the first two apps, cut them.

`runAs(principal, fn)` stays internal. Middleware uses it to open ambient context. Export it later if time-driven triggers or tests need it, since unexporting something is much harder than the reverse.

### Ambient context

There is no `AsyncLocalStorage`, but there does not need to be. Apps Script is single threaded with no real event loop, so a module-level variable cannot be corrupted by interleaving. `runAs` sets it, restores the previous value in a `finally`, and handlers read the principal without passing it down through every call.

## Middleware

This is the extensibility story, and the reason logging and error handling are in scope rather than left to consumers.

### Contract

```ts
type Meta       = { name: string; perm: Perm | null; principalEmail?: string };
type Handler    = (...args: unknown[]) => unknown;
type Middleware = (next: Handler, meta: Meta) => Handler;
```

A middleware receives the next handler and the route's metadata, and returns a replacement. `meta` arrives once at composition time and the returned closure captures it, so per-request work stays in the inner function.

`principalEmail` is mutable and set by `context()`, not read-only route metadata like the other two fields — it exists because `logger()` needs to know who was denied, but sits outside `context()` in the composition order (below), so by the time `logger` handles a thrown error, `context`'s `runAs` has already restored the ambient principal in its `finally`. `meta` is the one object every middleware shares regardless of nesting depth, so it's the side channel that survives past that.

No `(req, res, next)`. There is no response object in Apps Script. Handlers return values and the platform serializes them. Copying the Express signature would be imitation without the mechanism behind it.

`use()` applies to every route regardless of where it appears in the chain. In Express, position matters, but registration order carries no meaning for a name-based dispatcher, so making it positional would add a footgun for nothing.

### Composition order

Outermost first: `errorMask` wraps `logger` wraps `context` wraps `auth` wraps the handler.

`context` must wrap `auth`, since `auth` reads the ambient principal. `errorMask` must be outermost, or an authorization failure escapes before it is sanitized.

Composition happens when the handler runs, not when `requires` registers it. If composition happened at registration, a `use()` call that executed after a route was registered would silently miss it, and with routes living in separate files, import order would decide your security posture. Late binding removes that class of bug for the cost of composing a few closures per request, which is nothing next to Apps Script's startup time.

### Shipped middleware

**`context()`** resolves the active user and opens ambient context. Fails closed on an empty email. If a trigger event object is present, it either installs a `system` principal or refuses, and that choice is explicit in one place rather than special-cased per handler.

**`auth()`** reads `meta.perm` and calls `require` when it is set. Around four lines. The value is entirely in it being applied by construction.

**`errorMask()`** converts thrown errors into generic client-facing messages. Apps Script serializes thrown errors straight to the browser, so an unmasked `AuthorizationError` saying "alice@org lacks invoice:read" hands an attacker the permission vocabulary and a working oracle. The masked message is deliberately useless. The real error goes to the logger.

**`logger()`** records route name, principal, allowed or denied, and duration. `console.log` in Apps Script routes to Cloud Logging when a standard GCP project is attached, so structured JSON is worth emitting rather than prose. Denials are the interesting events. A spike in them usually means a broken UI, occasionally something else.

### Writing your own

```ts
const rateLimit = (perMin: number): Middleware => (next, meta) => (...args) => {
  const key = `rl:${meta.name}:${principalId()}`;
  // read/increment in CacheService, throw when over
  return next(...args);
};
```

Attach globally with `use()`, or to one route by passing it before the handler. Composition order is root, then route, then handler, which is what people expect.

Two rules for authors. Middleware is synchronous, so no promises. And construction must be cheap, because the app is rebuilt on every request. A factory that reads properties or does a UrlFetch at construction time pays that cost on every request, including requests to routes that never touch it. Do I/O inside the returned handler, behind the cache.

### On per-request rebuild

Every `google.script.run` call is a cold start. Fresh globals, module top-level re-executed, app rebuilt, one handler runs, everything discarded. Nothing survives between calls.

The rebuild itself is close to free. Constructing an object and composing closures costs microseconds against an execution that already spends tens of milliseconds starting up. This is a non-issue as long as the "keep construction cheap" rule holds.

## Build map

**Phase 1, core — done.** `definePolicy`, `PermissionOf`, role resolution, the store interface, and explicit-argument `can`/`require`/`permissionsFor` (`src/policy.ts`, `src/roles.ts`, `src/authorization.ts`). Pure TypeScript, no Apps Script references, tested with vitest against a fake store. Walkthrough: `examples/invoice-app/demo.ts`.

Building it surfaced a real bug worth recording: `can`/`require` were originally generic over `Perm` inferred from *both* arguments, so TypeScript unioned a typo'd permission into the inferred type instead of rejecting it, silently defeating the "a typo fails the build" goal. Fixed with `NoInfer<Perm>` on the `perm` parameter, and locked in with a `@ts-expect-error`-based type-test file (`src/__tests__/core/authorization.type-test.ts`) since vitest doesn't type-check.

**Phase 2, the runner — done.** The `requires`/`anyone` wrapper, late-bound middleware composition, `audit`, ambient context (`runAs`/`getPrincipal`), the ambient `can`/`require`/`permissionsFor` a route handler actually calls, and the single static `__rbacDispatch` entry point (`src/runtime/registry.ts`, `context.ts`, `middleware.ts`, `shipped-middleware.ts`, `rbac.ts`). Ships `context`, `auth`, `errorMask`, `logger`. Walkthrough: `examples/invoice-app/phase2-demo.ts`.

(`src/core/` and `src/runtime/` is a later reorganization of Phase 1 and Phase 2's files respectively, with tests moved out to `src/__tests__/` mirroring both — no behavior change, just the split this section's own file paths now reflect.)

Three things the build surfaced that the spec above didn't fully account for:

- **Duplicate detection moved from `requires()` to `audit()`.** `requires()` now lets a second registration under the same name silently shadow the first — matching what the Registration section already said ("the second silently shadows the first") — rather than throwing immediately. `audit()` is the one place that reports it, which is also what makes throw-in-dev/log-in-prod a single decision instead of one made ad hoc at every call site.
- **`Meta` needed a mutable field, `principalEmail`, not in the original Contract type.** Composition order is `errorMask` wraps `logger` wraps `context` wraps `auth`. `context`'s `runAs` restores the ambient principal in a `finally` on the way out, which runs *before* an inner exception reaches `logger`'s own catch block — so by the time `logger` wants to record who was denied, ambient context is already gone. `context` now writes the resolved email onto the shared `meta` object as a side channel; `logger` reads it from there instead of the ambient store, since `meta` is the one object every middleware in the chain shares regardless of nesting depth.
- **`errorMask` must not log.** It sits outside `logger` in the chain, so by the time its catch runs, `logger`'s catch has already seen the real, unmasked error and logged it. An earlier draft had `errorMask` log too, which would have double-recorded every denial.

Not yet built: per-route middleware (attached before the handler at registration, per "Writing your own" above) — only global `use()` exists so far. Whether `__rbacDispatch` and each `requires()` call actually survive as true top-level globals in a real bundled consumer's output (vs. getting wrapped inside a bundler's module scope) is untested — Phase 3/4's job against a real build, not assumed solved by this existing.

**Phase 3, adapters — done.** `src/gas/` (package export `./gas`, kept separate from the root export so importing the core package never pulls in Apps Script globals): `createSessionResolver` (`Session.getActiveUser()`, fails closed to `null` on an empty email), `createPropertiesStore` (the real `RoleStore`, one JSON blob under a single Script Property, degrading to empty rather than throwing on malformed JSON), and `withScriptCache` (a `RoleStore` decorator, not a distinct `init()` field — see Setup, above — keyed on a SHA-256 hash of the email via `Utilities.computeDigest`, never the raw email or `getUserCache()`'s ambiguous per-user partitioning). All three take their real Apps Script dependency (`Session`, `PropertiesService.getScriptProperties()`, `CacheService.getScriptCache()`) as an optional parameter defaulting to the live global, so tests pass a small fake object instead of stubbing the global itself — 11 tests, no Apps Script deployment needed.

**Confirmed live** (issue #12, closed): all three run correctly against a real deployed web app, not just fakes. `Session.getActiveUser().getEmail()` returns the real caller's email. A Script Property edited through the editor UI takes effect on the very next call with no redeploy — confirmed by reading `RBAC_ROLE_ASSIGNMENTS` as empty, adding it live, then reading `["admin"]` back on the same running deployment. `CacheService.getScriptCache()` persists a value written by one `google.script.run` call and read by a separate one, confirming it survives across cold starts rather than just within one execution. Branch: `spike/phase3-adapters-issue-12`.

**Phase 4, first consumer.** Port the invoice app. Two routes and a template is enough to find the ergonomic problems that a design doc cannot.

**Phase 5, docs.** The threat model paragraph matters more than the API reference. Four facts a maintainer needs: deployed execute-as-me, identity from `getActiveUser`, every global is a public endpoint, the route gate is the only gate.

Later, if asked for: Admin SDK group store, typed client wrapper, exported `runAs`.

## Open questions

**~~Does dynamic global assignment dispatch?~~ Resolved: no.** Confirmed by spike (issue #2, closed): a route whose only trace is a runtime `globalThis[name] = ...` assignment, with no matching literal `function name() {}` declaration in source, is invisible to `google.script.run`'s client-side proxy. `google.script.run` builds its callable-methods list from static analysis of source text, not from runtime `globalThis` contents. See the Registration section above: the resulting design is a single hand-authored `__rbacDispatch` entry point, not a codegen build step — the codegen path (issue #10) was explored, prototyped working, and then superseded once the single-dispatch alternative (issue #11) proved simpler and required no build step at all. Both are closed.

The four remaining platform assumptions from the same spike plan are now all resolved. `doGet` resolves a runtime-assigned global (issue #5, PASS — the opposite result from `google.script.run`, since `doGet` is invoked directly by the platform with no client-side proxy involved, so it needs no special-casing). The bundler preserves `__rbacDispatch` and each `requires()` call's registration side effect under tree shaking by default, but silently drops it if the consumer's `package.json` sets `"sideEffects": false` (issue #6, confirmed risk — keep that field out of the manifest and document that the entry file must import every route module). `globalThis` is present in the runtime (issue #7, PASS, though the shipped design doesn't end up depending on it). The registry throws on a duplicate name and still applies a `use()` call registered after the route it wraps (issue #9, both PASS, validating the late-binding decision above). Error propagation through `withFailureHandler` was confirmed live during the issue #11 spike, through the dispatcher's extra indirection. Full write-up in `spike-findings.md`.

**Should we generate a typed client?** `rbac.call('submitInvoice', data)` is an untyped runtime lookup by string name unless something connects it to the handler's signature. The answer isn't code generation — a hand-written `RouteMap` interface, the same role `v-reimburse`'s `ServerAPI` interface plays for its own `google.script.run` typings, is enough. The thin version wraps `google.script.run` in a `Proxy`: `withSuccessHandler`/`withFailureHandler`/`withUserObject` pass straight through to the real methods unmodified, and any other property access is treated as a route name and forwarded to `__rbacDispatch(name, ...args)`. No Promise conversion, no reimplementation of handler-chain semantics, the native chain keeps working exactly as before. This is why `audit()` also checks route names against that same reserved set (see Registration, above) — a route registered under one of those three names would silently never dispatch, since the proxy would call the real chain method instead of forwarding it. Still additive and non-load-bearing either way: skip the `RouteMap` interface entirely and `rbac.call`/raw `__rbacDispatch` calls still work, just untyped. Can wait, but it is the largest remaining DX gap.

**Do `can` and `require` earn their place?** Depends on whether any real consumer needs a secondary check inside a handler. Revisit after phase 4.

## Risks

**Owner account is a single point of failure.** Execute-as-me pins the deployment to one person's credentials. When they leave and the account is suspended, the app stops. Mitigation is to own the script from a Shared Drive or run it under a dedicated low-privilege account. Decide before the app has users, because moving a deployment later means a new URL.

**Grant durability is unverified.** Whether `drive.file` grants survive the owner revoking and re-authorizing the app, or a change of script ownership, has not been tested. A lost corpus would be unrecoverable. The dedicated-account setup addresses both and costs nothing now.

**Scope creep toward per-object rules.** Someone will ask for "managers see only their department's invoices" within six months. That is a legitimate need and it is not RBAC. The answer is scoped roles over containers, the way Kubernetes RoleBindings are namespaced, not a resource argument on `can`. Worth deciding as a design change, not absorbing as a patch.
