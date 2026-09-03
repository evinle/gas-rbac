import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gasRbacCodegen } from '../../vite-plugin/index.js';

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');

let dir: string;

beforeEach(() => {
  mkdirSync(fixturesRoot, { recursive: true });
  dir = mkdtempSync(path.join(fixturesRoot, 'case-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('gasRbacCodegen', () => {
  it('writes generated dispatch shims for every route found in the entry source, without executing it', () => {
    // Deliberately references a GAS global (PropertiesService) at module
    // scope with no stand-in provided anywhere -- if this plugin executed
    // the entry the way an earlier design did, this would throw. It
    // doesn't, because route discovery is static: reading source text, not
    // running it.
    const entry = path.join(dir, 'entry.ts');
    const out = path.join(dir, 'dispatch-shims.generated.ts');
    writeFileSync(
      entry,
      [
        `import { rbac } from '@evinle/gas-rbac';`,
        `const env = PropertiesService.getScriptProperties().getProperty('ENVIRONMENT');`,
        `rbac.anyone('getSubmissionMeta', () => env);`,
        `rbac.requires('getBillingReport', 'billing:view', () => 'report');`,
      ].join('\n'),
    );

    const plugin = gasRbacCodegen({ entry, out, packageName: '@evinle/gas-rbac' });
    (plugin.buildStart as () => void)();

    const generated = readFileSync(out, 'utf8');
    expect(generated).toContain(
      'export function getSubmissionMeta(...args: unknown[]) { return __rbacDispatch("getSubmissionMeta", ...args); }',
    );
    expect(generated).toContain(
      'export function getBillingReport(...args: unknown[]) { return __rbacDispatch("getBillingReport", ...args); }',
    );
  });
});
