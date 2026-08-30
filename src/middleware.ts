export interface Meta {
  name: string;
  perm: string | null;
  // Set by the shipped `context` middleware once it resolves the active
  // user, read by `logger`. Not ambient: composition order puts `context`
  // inside `logger` (logger wraps context wraps auth), so by the time an
  // inner throw reaches logger's catch, context's own `runAs` has already
  // restored the ambient principal in its `finally` -- ambient context is
  // gone by then. `meta` is the one object every middleware in the chain
  // shares regardless of nesting, so it's the side channel that survives.
  principalEmail?: string;
}

export type Handler = (...args: any[]) => unknown;
export type Middleware = (next: Handler, meta: Meta) => Handler;

// Composes outermost-first: middlewares[0] is the outermost wrapper. Called
// fresh on every dispatch (see PRD.md "On per-request rebuild") rather than
// once at registration, which is what makes a use() call registered after a
// route still apply to it.
export function compose(middlewares: readonly Middleware[], handler: Handler, meta: Meta): Handler {
  let composed = handler;
  for (let i = middlewares.length - 1; i >= 0; i--) {
    composed = middlewares[i]!(composed, meta);
  }
  return composed;
}
