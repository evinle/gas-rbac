import { describe, expect, it, vi } from 'vitest';
import { typedRun, type RouteMap, type ScriptRun } from '../../client/typed-run.js';

interface Invoice {
  id: string;
}

interface RouteMapForTest extends RouteMap {
  listInvoices(): Invoice[];
  submitInvoice(amount: number): Invoice;
}

function fakeScriptRun(): ScriptRun & { dispatchCalls: unknown[][] } {
  const dispatchCalls: unknown[][] = [];
  const fake: any = {
    dispatchCalls,
    withSuccessHandler: vi.fn(() => fake),
    withFailureHandler: vi.fn(() => fake),
    withUserObject: vi.fn(() => fake),
    __rbacDispatch: (name: string, ...args: unknown[]) => {
      dispatchCalls.push([name, ...args]);
    },
  };
  return fake;
}

describe('typedRun', () => {
  it('forwards an arbitrary route name to __rbacDispatch with its arguments', () => {
    const scriptRun = fakeScriptRun();
    typedRun<RouteMapForTest>(scriptRun).submitInvoice(500);

    expect(scriptRun.dispatchCalls).toEqual([['submitInvoice', 500]]);
  });

  it('calls a route with no arguments the same way', () => {
    const scriptRun = fakeScriptRun();
    typedRun<RouteMapForTest>(scriptRun).listInvoices();

    expect(scriptRun.dispatchCalls).toEqual([['listInvoices']]);
  });

  it('passes withSuccessHandler straight through to the real chain method', () => {
    const scriptRun = fakeScriptRun();
    const onSuccess = () => {};
    typedRun<RouteMapForTest>(scriptRun).withSuccessHandler(onSuccess);

    expect(scriptRun.withSuccessHandler).toHaveBeenCalledWith(onSuccess);
  });

  it('keeps chaining through the proxy after a chain method call', () => {
    const scriptRun = fakeScriptRun();
    const onSuccess = () => {};
    const onFailure = () => {};

    typedRun<RouteMapForTest>(scriptRun).withSuccessHandler(onSuccess).withFailureHandler(onFailure).submitInvoice(10);

    expect(scriptRun.withSuccessHandler).toHaveBeenCalledWith(onSuccess);
    expect(scriptRun.withFailureHandler).toHaveBeenCalledWith(onFailure);
    expect(scriptRun.dispatchCalls).toEqual([['submitInvoice', 10]]);
  });

  it('returns the proxy itself from a chain method, not the underlying scriptRun', () => {
    const scriptRun = fakeScriptRun();
    const run = typedRun<RouteMapForTest>(scriptRun);

    const afterChain = run.withSuccessHandler(() => {});

    expect(afterChain).not.toBe(scriptRun);
  });

  it('a route registered under a reserved chain-method name never reaches __rbacDispatch', () => {
    const scriptRun = fakeScriptRun();
    // Cast needed only because RouteMapForTest doesn't declare this route --
    // this documents the exact failure mode audit()'s reserved-name check
    // exists to catch (registry.ts's RESERVED_NAMES), not an intended call.
    (typedRun<RouteMapForTest>(scriptRun) as any).withUserObject({ foo: 'bar' });

    expect(scriptRun.withUserObject).toHaveBeenCalledWith({ foo: 'bar' });
    expect(scriptRun.dispatchCalls).toEqual([]);
  });
});
