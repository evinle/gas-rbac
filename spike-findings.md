# gas-rbac: spike findings

Consolidated results of every spike run against the wrapper-API direction change (see PRD.md). Each spike's throwaway code lives on its own branch; nothing here is merged to `main` except this findings file and the PRD updates the results caused.

## Spike 1 — does dynamic global assignment dispatch via `google.script.run`? (issue #2, closed)

**FAIL.** `google.script.run` builds its callable-methods list by parsing source text for literal `function name() {}` declarations, not by inspecting `globalThis` at runtime. A route whose only trace is `globalThis[name] = ...`, with no matching declaration in source, is invisible to the client proxy — the call fails in the browser (`TypeError: ...name is not a function`) before any request reaches the server.

**Consequence:** every route needs a real, literal top-level declaration in the deployed `.gs` output. This was the founding constraint for every spike and design decision that followed.

Branch: `spike/dispatch-spike-issue-2`.

## Spike 2 — does `doGet` resolve a runtime-assigned global the same way? (issue #5, closed)

**PASS — opposite result from Spike 1.** Deployed a web app with `globalThis.doGet = function(){...}` and no static declaration anywhere. Loading the deployment URL directly resolved it correctly: `PASS: dynamic doGet resolved`.

**Why it differs:** `doGet` is invoked directly by the platform when the web app URL loads. There is no client-side proxy involved at all, so it never goes through the static-source-text-parsing mechanism Spike 1 found. It reads whatever is in global scope at request time.

**Consequence:** `doGet` needs no special-casing. It can be registered through `rbac.anyone('doGet', handler)` like any other route — Apps Script finds it whether it's static or dynamic.

Branch: `spike/doget-issue-5`.

## Spike 3 — does the bundler keep the registration side effect under tree shaking? (issue #6, closed)

**CONFIRMED risk, mitigation validated.** Built the same source two ways with esbuild:

- Default manifest (no `sideEffects` field): the route module's registration call survives in the bundle.
- `"sideEffects": false` in `package.json`: esbuild silently drops the entire route module. Only a build **warning** is emitted, not an error — the registration call is gone from the output, which looks like a routing bug in production, not a build bug.

**Consequence:** the mitigation already documented in the PRD is both necessary and sufficient — keep `sideEffects: false` out of the package manifest, and document that the entry file must import every route module. This is now a documented gotcha, not a hopeful assumption.

Branch: `spike/treeshake-issue-6`.

## Spike 4 — is `globalThis` actually available in the Apps Script V8 runtime? (issue #7, closed)

**PASS.** One-line check run directly in the script editor: `globalThis` is present, readable, and writable at module-evaluation time.

```
globalThis available: true
read back: set-via-globalThis
```

**Consequence:** none, in practice — the design that shipped (Spike 6 below) doesn't reference `globalThis` anywhere in the library's own code. Recorded for completeness rather than because anything depends on it.

Branch: `spike/globalthis-issue-7`.

## Spike 5 — does a thrown error reach `withFailureHandler` intact? (issue #8, closed as duplicate)

**PASS**, confirmed as a side effect of the single-dispatch spike (#11) rather than a standalone run — a `boom` route that deliberately throws was dispatched through `__rbacDispatch`, and the client's failure handler received the message intact: `PASS boom (error propagated): Error: deliberate failure for spike #11`.

**Consequence:** `errorMask()` can rely on the unmasked error reaching the server-side wrapper before being sanitized — nothing about the dispatch indirection swallows or mangles it.

Branch: `spike/single-dispatch-issue-11` (same code, no separate branch).

## Spike 6 — duplicate registration and late `use()` (issue #9, closed)

**Both PASS**, pure registry logic, no Apps Script deploy needed:

```
PASS duplicate registration: threw loudly -- "duplicate route registration: ping"
PASS late use(): middleware registered after requires() still applied -- "[wrapped]echo:hi"
```

1. Registering two routes under the same name throws immediately, rather than silently overwriting.
2. A `use()` call appearing after the route's `requires()` call in import order still wraps that route's dispatch.

**Consequence:** both the `audit()` duplicate-detection design and the late-binding middleware decision (composed at call time, not registration time) deliver the guarantee the PRD's Middleware section claims — import order does not decide security posture.

Branch: `spike/registry-issue-9`.

## Architecture spikes: codegen (issue #10, superseded) → single dispatch entrypoint (issue #11, adopted)

Spike 1's failure forced a design response. Two were tried:

- **Codegen (issue #10):** a build step generating one static declaration per registered route, delegating into the runtime registry. Prototyped and confirmed working — but left three open questions (which build hook runs it, how routes are discovered across a multi-file project, checked-in vs. generated output) with no toolchain-agnostic answer, since gas-rbac ships as an npm package consumed by projects with arbitrary build setups.
- **Single dispatch entrypoint (issue #11):** instead of one declaration per route, ship a *single* hand-authored static declaration as part of the library's own source, never regenerated:
  ```js
  function __rbacDispatch() {
    return __rbac.dispatch(arguments[0], Array.prototype.slice.call(arguments, 1));
  }
  ```
  Routes still register into the runtime registry via `rbac.requires`/`anyone`, unchanged. The client calls through the one static entry point by name. Confirmed live: variable-length arguments forward correctly, and thrown errors propagate intact (Spike 5, above).

**Adopted.** No build step, no consumer configuration, nothing toolchain-specific — it bundles like any other library import. #10 is superseded and closed.

Branch: `spike/single-dispatch-issue-11`.

## What's left

- **Issue #3 (grant durability — does `drive.file` survive re-auth or ownership transfer)** is still open. Different in kind from the spikes above: it's a long-horizon observational question, not something a quick prototype settles.
- **Issue #4 (typed client: generate now or defer)** is still open, `wayfinder:grilling`. Now explicitly non-load-bearing per the PRD update — if a typed client generator is skipped or never runs, the cost is weaker autocomplete, not a broken app, since `__rbacDispatch` is what actually has to work at runtime.
- The scratch Apps Script projects created for these spikes (dispatch, codegen, single-dispatch, doGet, globalThis) are all still live in Google Drive/Apps Script and have not been deleted — `clasp` lacks the Drive scope to delete them programmatically, so they need manual cleanup.
