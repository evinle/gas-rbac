// No AsyncLocalStorage: Apps Script is single-threaded with no real event
// loop, so a module-level variable can't be corrupted by interleaving.
// runAs() sets it and restores the previous value in a finally -- see
// PRD.md "Ambient context".
export interface Principal {
  email: string;
}

let current: Principal | null = null;

export function runAs<T>(principal: Principal, fn: () => T): T {
  const previous = current;
  current = principal;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

// Internal: handlers and shipped middleware read the principal this way.
// Throws rather than returning null, since reading it outside of runAs() is
// a programmer error (a middleware ordering bug), not a runtime condition
// callers should be routed to handle.
export function getPrincipal(): Principal {
  if (!current) {
    throw new Error('getPrincipal() called outside runAs() -- context() middleware must run first');
  }
  return current;
}
