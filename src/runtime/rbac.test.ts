// Integration test against the real singleton (rbac, __rbacDispatch) rather
// than a fresh createRegistry() -- this is what a consumer's own code
// actually touches. Route names are unique per test since the registry is
// a module-level singleton, same as it will be in the real deployed script.
import { afterEach, describe, expect, it } from 'vitest';
import { __rbacDispatch, can, permissionsFor, rbac, require } from './rbac.js';
import { __resetConfigForTests, init } from './config.js';
import { definePolicy } from '../core/policy.js';
import type { RoleStore } from '../core/store.js';

const policy = definePolicy({
  permissions: ['invoice:read', 'invoice:submit'],
  roles: {
    member: ['invoice:submit'],
    admin: ['invoice:read', 'invoice:submit'],
  },
  defaultRoles: ['member'],
} as const);

const store: RoleStore = {
  getRoles: (email) => (email === 'admin@org.com' ? ['admin'] : []),
};

let activeUser: string | null = null;

afterEach(() => {
  __resetConfigForTests();
  activeUser = null;
});

describe('rbac singleton: registration through dispatch', () => {
  it('dispatches an unguarded route with no config needed beyond the resolver', () => {
    init({ policy, store, resolver: () => 'anyone@org.com' });
    rbac.anyone('rbacTestPing', () => 'pong');
    expect(__rbacDispatch('rbacTestPing')).toBe('pong');
  });

  it('forwards arguments through the single dispatch entrypoint', () => {
    init({ policy, store, resolver: () => 'anyone@org.com' });
    rbac.anyone('rbacTestEcho', (msg: string) => `echo:${msg}`);
    expect(__rbacDispatch('rbacTestEcho', 'hi')).toBe('echo:hi');
  });

  it('gates a route on permission and masks the error for a denied caller', () => {
    init({ policy, store, resolver: () => activeUser });
    rbac.requires('rbacTestListInvoices', 'invoice:read', () => ['invoice-1']);

    activeUser = 'nobody@org.com';
    expect(() => __rbacDispatch('rbacTestListInvoices')).toThrow('request denied');

    activeUser = 'admin@org.com';
    expect(__rbacDispatch('rbacTestListInvoices')).toEqual(['invoice-1']);
  });

  it('lets the ambient can/require/permissionsFor read the dispatching principal', () => {
    init({ policy, store, resolver: () => activeUser });
    rbac.anyone('rbacTestWhoAmI', () => ({
      canRead: can('invoice:read'),
      perms: [...permissionsFor()],
    }));

    activeUser = 'admin@org.com';
    expect(__rbacDispatch('rbacTestWhoAmI')).toEqual({
      canRead: true,
      perms: ['invoice:submit', 'invoice:read'],
    });

    activeUser = 'member@org.com';
    expect(__rbacDispatch('rbacTestWhoAmI')).toEqual({
      canRead: false,
      perms: ['invoice:submit'],
    });
  });

  it('ambient require() inside a handler throws AuthorizationError, masked by errorMask on the way out', () => {
    init({ policy, store, resolver: () => activeUser });
    rbac.anyone('rbacTestSecondaryCheck', () => {
      require('invoice:read'); // secondary check inside an otherwise-open route
      return 'ok';
    });

    activeUser = 'member@org.com';
    expect(() => __rbacDispatch('rbacTestSecondaryCheck')).toThrow('request denied');
  });

  it('audit() reports a route registered under a reserved client method name', () => {
    init({ policy, store, resolver: () => 'x@org.com' });
    rbac.anyone('withUserObject', () => 'oops');
    expect(() => rbac.audit()).toThrow(/reserved client method name/);
  });
});
