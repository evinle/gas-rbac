import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../runtime/registry.js';
import type { Middleware } from '../../runtime/middleware.js';

describe('createRegistry', () => {
  it('dispatches to the registered handler and forwards arguments', () => {
    const registry = createRegistry([]);
    registry.anyone('echo', (msg: string) => `echo:${msg}`);
    expect(registry.dispatch('echo', ['hi'])).toBe('echo:hi');
  });

  it('throws on dispatch to an unregistered name', () => {
    const registry = createRegistry([]);
    expect(() => registry.dispatch('nope', [])).toThrow(/no such route: nope/);
  });

  it('lets a duplicate registration silently shadow the first, not throw immediately', () => {
    const registry = createRegistry([]);
    registry.anyone('ping', () => 'first');
    expect(() => registry.anyone('ping', () => 'second')).not.toThrow();
    expect(registry.dispatch('ping', [])).toBe('second');
  });

  it('audit() throws in development when a duplicate was registered', () => {
    const registry = createRegistry([]);
    registry.anyone('ping', () => 'first');
    registry.anyone('ping', () => 'second');
    expect(() => registry.audit({ environment: 'development' })).toThrow(/duplicate route registration: "ping"/);
  });

  it('audit() logs instead of throwing in production', () => {
    const registry = createRegistry([]);
    registry.anyone('ping', () => 'first');
    registry.anyone('ping', () => 'second');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => registry.audit({ environment: 'production' })).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('duplicate route registration: "ping"'));
    errorSpy.mockRestore();
  });

  it('audit() throws on a route name that collides with a reserved client method', () => {
    const registry = createRegistry([]);
    registry.anyone('withSuccessHandler', () => 'oops');
    expect(() => registry.audit()).toThrow(/reserved client method name/);
  });

  it('audit() passes clean when there is nothing to report', () => {
    const registry = createRegistry([]);
    registry.anyone('ping', () => 'pong');
    expect(() => registry.audit()).not.toThrow();
  });

  it('applies a use() call registered after the route it wraps, since composition is late-bound', () => {
    const registry = createRegistry([]);
    registry.anyone('echo', (msg: string) => `echo:${msg}`);

    const upper: Middleware = (next) => (...args) => String(next(...args)).toUpperCase();
    registry.use(upper);

    expect(registry.dispatch('echo', ['hi'])).toBe('ECHO:HI');
  });

  it('composes shipped middleware outside custom use() middleware', () => {
    const log: string[] = [];
    const shipped: Middleware = (next) => (...args) => {
      log.push('shipped:enter');
      const r = next(...args);
      log.push('shipped:exit');
      return r;
    };
    const custom: Middleware = (next) => (...args) => {
      log.push('custom:enter');
      const r = next(...args);
      log.push('custom:exit');
      return r;
    };

    const registry = createRegistry([shipped]);
    registry.anyone('ping', () => {
      log.push('handler');
      return 'pong';
    });
    registry.use(custom);
    registry.dispatch('ping', []);

    expect(log).toEqual(['shipped:enter', 'custom:enter', 'handler', 'custom:exit', 'shipped:exit']);
  });
});
