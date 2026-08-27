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
init({ policy, store, resolver, cache, logger? })
```

### Registration

Registration is per route, not through a central builder — but dispatch requires a build step, not a bare runtime assignment. **Confirmed by spike** (issue #2, closed): `google.script.run` builds its list of callable methods by parsing source text for literal `function name() {}` declarations. A route whose only trace is a runtime `globalThis[name] = ...` assignment, with no matching declaration anywhere in source, is invisible to the client-side proxy entirely — the call fails in the browser with `... .name is not a function`, before any request reaches the server. Assigning to `globalThis` at runtime, by itself, does not make a route callable.

Authoring still looks like the wrapper form:

```ts
export const listInvoices = rbac.requires('listInvoices', 'invoice:read',
  () => invoiceRepo.list()
);

export const doGet = rbac.anyone('doGet', () => renderApp());

rbac.use(mw)       // global middleware, applies to every route regardless of registration order
rbac.audit()       // call once at startup: flags any globalThis function not in the registry
```

but a build step must additionally emit a literal top-level declaration per registered route, delegating to the wrapped handler:

```js
function listInvoices() { return __rbac.dispatch('listInvoices', arguments); }
```

`rbac.requires` still populates the runtime registry — used for middleware composition, `audit()`, and permission metadata — but the registry can no longer double as the dispatch mechanism on its own. The codegen pass is now mandatory, not the documented contingency it was before the spike ran. Exact shape (which build hook emits the stubs, how route modules are discovered, whether the output is checked in or build-only) is an open design question — see the follow-up ticket for the redesign this spike forces. Authoring experience is otherwise unaffected: the build step is invisible to consumers, and adoption stays per route — convert one, ship it, convert the next.

`anyone` is a deliberate keyword, not an omission. Public endpoints exist, `doGet` among them, and reachability should always be something someone typed.

Naming note: `requires` follows Spring Security's `hasPermission`, Django's `permission_required`, and NestJS's `@RequiresPermissions`. Familiar beats clever for a security primitive.

The route name appears twice, once as the binding and once as the string argument — there is no way around this, since a function expression passed as an argument is anonymous and `fn.name` is empty, so `requires` cannot infer the binding it will be assigned to. This is what `audit()` exists to catch: if a `function listInvoices()` declaration gets converted to a `const` with a typo in the name string, the old declaration is left behind as a live, unguarded global while the new registration answers to a name nobody calls. `audit()` throws in development and logs in production, downgrading the guarantee from "reachable-but-unguarded is unrepresentable" to "caught on first run" — accepted deliberately, since the alternative is requiring a rewrite of every entry point before a single route benefits.

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
type Meta       = { name: string; perm: Perm | null };
type Handler    = (...args: unknown[]) => unknown;
type Middleware = (next: Handler, meta: Meta) => Handler;
```

A middleware receives the next handler and the route's metadata, and returns a replacement. `meta` arrives once at composition time and the returned closure captures it, so per-request work stays in the inner function.

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

**Phase 1, core.** `definePolicy`, `PermissionOf`, role resolution, the store interface, `can`, `require`, `permissionsFor`. Pure TypeScript, no Apps Script references, tested with vitest against a fake store. This is the half that should have real test coverage.

**Phase 2, the runner.** The `requires`/`anyone` wrapper, late-bound middleware composition, `audit`, and the codegen build step that emits real declarations for `google.script.run` to see (see Registration, above — confirmed mandatory by spike, not optional). Ship `context`, `auth`, `errorMask`, `logger`. Codegen's exact shape needs deciding before this phase starts.

**Phase 3, adapters.** `@you/rbac/gas` with the session resolver, properties store, and script cache wrapper. Split entry points so the core stays importable in Node and testable without stubbing globals.

**Phase 4, first consumer.** Port the invoice app. Two routes and a template is enough to find the ergonomic problems that a design doc cannot.

**Phase 5, docs.** The threat model paragraph matters more than the API reference. Four facts a maintainer needs: deployed execute-as-me, identity from `getActiveUser`, every global is a public endpoint, the route gate is the only gate.

Later, if asked for: Admin SDK group store, typed client wrapper, exported `runAs`.

## Open questions

**~~Does dynamic global assignment dispatch?~~ Resolved: no.** Confirmed by spike (issue #2, closed): a route whose only trace is a runtime `globalThis[name] = ...` assignment, with no matching literal `function name() {}` declaration in source, is invisible to `google.script.run`'s client-side proxy. The call fails in the browser — `TypeError: ...name is not a function` — before any request reaches the server. `google.script.run` builds its callable-methods list from static analysis of source text, not from runtime `globalThis` contents, settling the assumption the PRD carried into this spike. See the Registration section above for the resulting design change: a codegen build step emitting real declarations is now mandatory. **Open follow-up:** the exact codegen shape (build hook, route-module discovery, checked-in vs. build-only output) is undecided — tracked as a new ticket rather than left implicit here.

Five more platform assumptions from the same spike plan are still open, and one is sharper now that codegen is mandatory rather than a contingency: whether `doGet` resolves a runtime-assigned global the same way (survivable if not — `doGet` is one function per app and can stay a static declaration); whether the bundler preserves a *generated* stub declaration's registration side effect under tree shaking, now that every route depends on codegen output surviving the build rather than just a fallback path (mitigate regardless by keeping `sideEffects: false` out of the manifest and documenting that the entry file must import every route module); whether `globalThis` is actually present in the runtime (fall back to top-level `this` if not); whether a thrown error reaches `withFailureHandler` intact several closures deep, and without leaking the unmasked message (`errorMask` depends on this); and whether the registry detects duplicate route names and still applies a `use()` call that appears after a `requires()` call in import order (validates the late-binding decision above). None of these five gate the architecture — they gate documentation and error-handling correctness — but they should run before Phase 2.

**Should we generate a typed client?** `google.script.run.submitInvoice(data)` is an untyped runtime lookup. Nothing connects it to the handler's signature, so that boundary is genuinely unchecked. Generating an `api` object from the route map would restore type safety and hand back promises instead of `withSuccessHandler` callbacks. Additive, so it can wait, but it is the largest remaining gap.

**Do `can` and `require` earn their place?** Depends on whether any real consumer needs a secondary check inside a handler. Revisit after phase 4.

## Risks

**Owner account is a single point of failure.** Execute-as-me pins the deployment to one person's credentials. When they leave and the account is suspended, the app stops. Mitigation is to own the script from a Shared Drive or run it under a dedicated low-privilege account. Decide before the app has users, because moving a deployment later means a new URL.

**Grant durability is unverified.** Whether `drive.file` grants survive the owner revoking and re-authorizing the app, or a change of script ownership, has not been tested. A lost corpus would be unrecoverable. The dedicated-account setup addresses both and costs nothing now.

**Scope creep toward per-object rules.** Someone will ask for "managers see only their department's invoices" within six months. That is a legitimate need and it is not RBAC. The answer is scoped roles over containers, the way Kubernetes RoleBindings are namespaced, not a resource argument on `can`. Worth deciding as a design change, not absorbing as a patch.
