// No AsyncLocalStorage: Apps Script is single-threaded with no real event
// loop, so a module-level variable can't be corrupted by interleaving.
// runAs_() sets it and restores the previous value in a finally -- see
// PRD.md "Ambient context".
export interface Principal {
  email: string;
}

let current: Principal | null = null;

// Trailing underscore on both: GAS's own convention for "not a public
// endpoint" -- see README "GAS naming convention". Neither is a route.
export function runAs_<T>(principal: Principal, fn: () => T): T {
  const previous = current;
  current = principal;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

// Internal: handlers and shipped middleware read the principal this way.
// Throws rather than returning null, since reading it outside of runAs_() is
// a programmer error (a middleware ordering bug), not a runtime condition
// callers should be routed to handle.
export function getPrincipal_(): Principal {
  if (!current) {
    throw new Error('getPrincipal_() called outside runAs_() -- context() middleware must run first');
  }
  return current;
}
