import { describe, expect, it } from 'vitest';
import { extractRoutes_ } from '../../codegen/extract-routes.js';

describe('extractRoutes_', () => {
  it('extracts the route name from an anyone() registration call', () => {
    const source = `rbac.anyone('getSubmissionMeta', handler);`;
    expect(extractRoutes_(source)).toEqual(['getSubmissionMeta']);
  });

  it('extracts the route name from a requires() registration call, ignoring the permission argument', () => {
    const source = `rbac.requires('getBillingReport', 'billing:view', handler);`;
    expect(extractRoutes_(source)).toEqual(['getBillingReport']);
  });

  it('extracts every route name in source order across multiple registration calls', () => {
    const source = `
      rbac.anyone('getSubmissionMeta', a);
      rbac.requires('getBillingReport', 'billing:view', b);
      rbac.anyone('getExchangeRate', c);
    `;
    expect(extractRoutes_(source)).toEqual(['getSubmissionMeta', 'getBillingReport', 'getExchangeRate']);
  });
});
