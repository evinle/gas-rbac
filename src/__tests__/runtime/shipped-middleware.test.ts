import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetConfigForTests, init } from '../../runtime/config.js';
import { auth, context, errorMask, logger } from '../../runtime/shipped-middleware.js';
import { compose, type Meta } from '../../runtime/middleware.js';
import { definePolicy } from '../../core/policy.js';
import type { RoleStore } from '../../core/store.js';
import { AuthorizationError } from '../../core/errors.js';

const policy = definePolicy({
  permissions: ['invoice:read'],
  roles: { admin: ['invoice:read'] },
  defaultRoles: [],
} as const);

const store: RoleStore = {
  getRoles: (email) => (email === 'admin@org.com' ? ['admin'] : []),
};

afterEach(() => {
  __resetConfigForTests();
});

describe('context', () => {
  it('fails closed when the resolver returns no email', () => {
    init({ policy, store, resolver: () => null });
    const meta: Meta = { name: 'ping', perm: null };
    const composed = compose([context], () => 'ok', meta);
    expect(() => composed()).toThrow(/failing closed/);
  });

  it('opens ambient context and records the resolved email on meta', () => {
    init({ policy, store, resolver: () => 'admin@org.com' });
    const meta: Meta = { name: 'ping', perm: null };
    let sawEmail: string | undefined;
    const composed = compose([context], () => {
      sawEmail = meta.principalEmail;
      return 'ok';
    }, meta);
    composed();
    expect(sawEmail).toBe('admin@org.com');
  });
});

describe('auth', () => {
  it('lets an unguarded route (perm: null) through without checking anything', () => {
    init({ policy, store, resolver: () => null });
    const meta: Meta = { name: 'ping', perm: null };
    const composed = compose([auth], () => 'ok', meta);
    expect(composed()).toBe('ok');
  });

  it('allows a route when the principal has the required permission', () => {
    init({ policy, store, resolver: () => 'admin@org.com' });
    const meta: Meta = { name: 'listInvoices', perm: 'invoice:read' };
    const composed = compose([context, auth], () => 'ok', meta);
    expect(composed()).toBe('ok');
  });

  it('throws AuthorizationError when the principal lacks the required permission', () => {
    init({ policy, store, resolver: () => 'nobody@org.com' });
    const meta: Meta = { name: 'listInvoices', perm: 'invoice:read' };
    const composed = compose([context, auth], () => 'ok', meta);
    expect(() => composed()).toThrow(AuthorizationError);
  });
});

describe('errorMask', () => {
  it('replaces an AuthorizationError message with a generic one', () => {
    const meta: Meta = { name: 'listInvoices', perm: 'invoice:read' };
    const composed = compose([errorMask], () => {
      throw new AuthorizationError('invoice:read');
    }, meta);
    expect(() => composed()).toThrow('request denied');
  });

  it('replaces any other thrown error with a generic internal-error message', () => {
    const meta: Meta = { name: 'listInvoices', perm: null };
    const composed = compose([errorMask], () => {
      throw new Error('db connection string leaked here');
    }, meta);
    try {
      composed();
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe('internal error');
      expect((e as Error).message).not.toContain('db connection string');
    }
  });

  it('does not itself log -- that is logger()\'s job, and it sits inside errorMask', () => {
    const logSpy = vi.fn();
    init({ policy, store, resolver: () => null, logger: logSpy });
    const meta: Meta = { name: 'ping', perm: null };
    const composed = compose([errorMask], () => {
      throw new Error('boom');
    }, meta);
    expect(() => composed()).toThrow();
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('logger', () => {
  it('logs allowed:true on success, with the principal from meta', () => {
    const events: unknown[] = [];
    init({ policy, store, resolver: () => 'admin@org.com', logger: (e) => events.push(e) });
    const meta: Meta = { name: 'ping', perm: null, principalEmail: 'admin@org.com' };
    const composed = compose([logger], () => 'ok', meta);
    composed();
    expect(events).toEqual([
      expect.objectContaining({ route: 'ping', principal: 'admin@org.com', allowed: true }),
    ]);
  });

  it('logs allowed:false and rethrows on denial', () => {
    const events: unknown[] = [];
    init({ policy, store, resolver: () => null, logger: (e) => events.push(e) });
    const meta: Meta = { name: 'listInvoices', perm: 'invoice:read', principalEmail: 'nobody@org.com' };
    const composed = compose([logger], () => {
      throw new AuthorizationError('invoice:read');
    }, meta);
    expect(() => composed()).toThrow(AuthorizationError);
    expect(events).toEqual([
      expect.objectContaining({ route: 'listInvoices', principal: 'nobody@org.com', allowed: false }),
    ]);
  });

  it('logs exactly once per dispatch when errorMask wraps it, matching the shipped composition order', () => {
    const events: unknown[] = [];
    init({ policy, store, resolver: () => 'nobody@org.com', logger: (e) => events.push(e) });
    const meta: Meta = { name: 'listInvoices', perm: 'invoice:read' };
    // Real shipped order: errorMask wraps logger wraps context wraps auth.
    const composed = compose([errorMask, logger, context, auth], () => 'ok', meta);
    expect(() => composed()).toThrow('request denied'); // masked, not the raw AuthorizationError
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({ route: 'listInvoices', principal: 'nobody@org.com', allowed: false }),
    );
  });
});
