import { describe, expect, it } from 'vitest';
import { compose, type Meta, type Middleware } from '../../runtime/middleware.js';

function recorder(name: string, log: string[]): Middleware {
  return (next) => (...args) => {
    log.push(`${name}:enter`);
    const result = next(...args);
    log.push(`${name}:exit`);
    return result;
  };
}

describe('compose', () => {
  it('runs middlewares outermost-first, innermost-last, then the handler', () => {
    const log: string[] = [];
    const meta: Meta = { name: 'test', perm: null };
    const handler = () => {
      log.push('handler');
      return 'result';
    };

    const composed = compose([recorder('a', log), recorder('b', log)], handler, meta);
    const result = composed();

    expect(result).toBe('result');
    expect(log).toEqual(['a:enter', 'b:enter', 'handler', 'b:exit', 'a:exit']);
  });

  it('forwards arguments through to the handler', () => {
    const meta: Meta = { name: 'echo', perm: null };
    const handler = (msg: string) => `echo:${msg}`;
    const composed = compose([], handler, meta);
    expect(composed('hi')).toBe('echo:hi');
  });

  it('gives every middleware the same meta object, so one can leave a note for another', () => {
    const meta: Meta = { name: 'test', perm: null };
    const setter: Middleware = (next, m) => (...args) => {
      m.principalEmail = 'alice@org.com';
      return next(...args);
    };
    const reader: Middleware = (next, m) => (...args) => {
      const result = next(...args);
      return `${result}:${m.principalEmail}`;
    };

    const composed = compose([reader, setter], () => 'handler', meta);
    expect(composed()).toBe('handler:alice@org.com');
  });
});
