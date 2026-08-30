import { AuthorizationError } from '../core/errors.js';
import { require_ as requirePerm } from '../core/authorization.js';
import { runAs_ } from './context.js';
import { getConfig_ } from './config.js';
import type { Middleware } from './middleware.js';
import { resolvePermissions_ } from '../core/roles.js';

// Composition order (outermost first): errorMask wraps logger wraps context
// wraps auth wraps the handler -- see PRD.md "Composition order". context
// must wrap auth, since auth reads the ambient principal. errorMask must be
// outermost, or an authorization failure escapes before it's sanitized.

// Fails closed on an empty/unresolvable email -- see PRD.md "Identity comes
// from getActiveUser, never getEffectiveUser". Real trigger-event handling
// (installing a `system` principal, or refusing) is Phase 3: the resolver
// injected via init() only models an interactive web app request for now.
export const context: Middleware = (next, meta) => (...args) => {
  const email = getConfig_().resolver();
  if (!email) {
    throw new Error('context: no active user (failing closed)');
  }
  meta.principalEmail = email;
  return runAs_({ email }, () => next(...args));
};

export const auth: Middleware = (next, meta) => (...args) => {
  if (meta.perm !== null) {
    const { policy, store } = getConfig_();
    // context() has already run and set the ambient principal by the time
    // auth() runs, since auth is innermost of the two.
    const email = meta.principalEmail!;
    const perms = resolvePermissions_(policy, store, email);
    requirePerm(perms, meta.perm);
  }
  return next(...args);
};

// Apps Script serializes a thrown error straight to the browser, so an
// unmasked AuthorizationError ("alice@org lacks invoice:read") hands an
// attacker the permission vocabulary and a working oracle. The masked
// message is deliberately useless.
//
// Does not log here: errorMask sits outside logger in the chain, so by the
// time this catch runs, logger's own catch has already seen the real,
// unmasked error and logged it -- logging again here would double-record
// every denial. errorMask's only job is making sure the *outgoing* message
// is sanitized before it reaches the browser.
export const errorMask: Middleware = (next) => (...args) => {
  try {
    return next(...args);
  } catch (e) {
    throw new Error(e instanceof AuthorizationError ? 'request denied' : 'internal error');
  }
};

// Denials are the interesting events -- a spike in them usually means a
// broken UI, occasionally something else.
export const logger: Middleware = (next, meta) => (...args) => {
  const start = Date.now();
  const log = getConfig_().logger ?? defaultLog_;
  try {
    const result = next(...args);
    log({ route: meta.name, principal: meta.principalEmail ?? null, allowed: true, durationMs: Date.now() - start });
    return result;
  } catch (e) {
    log({ route: meta.name, principal: meta.principalEmail ?? null, allowed: false, durationMs: Date.now() - start });
    throw e;
  }
};

// Trailing underscore: GAS's own convention for "not a public endpoint" --
// see README "GAS naming convention". Not a route.
function defaultLog_(event: import('./config.js').LogEvent): void {
  console.log(JSON.stringify(event));
}
