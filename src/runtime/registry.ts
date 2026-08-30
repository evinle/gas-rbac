import { compose_, type Handler, type Meta, type Middleware } from './middleware.js';

// A route registered under one of these would silently never dispatch: the
// typed client's Proxy (PRD.md, Registration) treats any property access
// other than these three as a route name and forwards it to __rbacDispatch,
// so a route actually named e.g. "withSuccessHandler" would just invoke the
// real chain method instead of ever reaching the registry.
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'withSuccessHandler',
  'withFailureHandler',
  'withUserObject',
]);

interface Route<Perm extends string> {
  perm: Perm | null;
  handler: Handler;
}

// Trailing underscore: GAS's own convention for "not a public endpoint" --
// see README "GAS naming convention". Not a route; the factory itself must
// never be reachable as a google.script.run target once bundled.
//
// Generic over Perm so `requires`'s second argument is checked against a
// specific app's real permission union instead of a bare `string` that
// lets a typo through -- see PRD.md/README "threading Perm through requires
// and middleware". rbac.ts's own singleton still defaults Perm to `string`
// since it's created before any app's policy is known; typedRbac_ re-types
// it against a real Perm once the app has one. No NoInfer needed on
// `requires`'s `perm` parameter (unlike core/authorization.ts's
// can_/require_): Perm is fixed by createRegistry_'s own type parameter
// before requires is ever called, not inferred per-call from two arguments,
// so there's nothing for NoInfer to guard against here.
export function createRegistry_<Perm extends string = string>(shippedMiddleware: readonly Middleware<Perm>[]) {
  const routes = new Map<string, Route<Perm>>();
  // Names registered more than once. Recorded, not thrown on immediately --
  // requires() lets the second registration silently shadow the first, the
  // same way a real duplicate would in production. audit() is the one
  // place this surfaces, so its throw-in-dev/log-in-prod behavior is a
  // single decision, not one made ad hoc at every registration call site.
  const duplicates = new Set<string>();
  const custom: Middleware<Perm>[] = [];

  function requires<H extends Handler>(name: string, perm: Perm | null, handler: H): H {
    if (routes.has(name)) {
      duplicates.add(name);
    }
    routes.set(name, { perm, handler });
    return handler;
  }

  function anyone<H extends Handler>(name: string, handler: H): H {
    return requires(name, null, handler);
  }

  // Applies to every route regardless of where it's called relative to
  // requires() -- middleware composes at dispatch time, not registration
  // time, so import order never decides security posture.
  function use(mw: Middleware<Perm>): void {
    custom.push(mw);
  }

  function audit(options: { environment?: 'development' | 'production' } = {}): void {
    const problems: string[] = [];
    for (const name of duplicates) {
      problems.push(`duplicate route registration: "${name}"`);
    }
    for (const name of routes.keys()) {
      if (RESERVED_NAMES.has(name)) {
        problems.push(`route "${name}" collides with a reserved client method name and will never dispatch`);
      }
    }
    if (problems.length === 0) return;
    const message = `rbac.audit found ${problems.length} problem(s):\n  ${problems.join('\n  ')}`;
    if (options.environment === 'production') {
      console.error(message);
    } else {
      throw new Error(message);
    }
  }

  function dispatch(name: string, args: unknown[]): unknown {
    const route = routes.get(name);
    if (!route) {
      throw new Error(`no such route: ${name}`);
    }
    const meta: Meta<Perm> = { name, perm: route.perm };
    const chain = compose_([...shippedMiddleware, ...custom], route.handler, meta);
    return chain(...args);
  }

  return { requires, anyone, use, audit, dispatch };
}

export type Registry<Perm extends string = string> = ReturnType<typeof createRegistry_<Perm>>;
