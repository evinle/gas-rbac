import { readFileSync, writeFileSync } from 'node:fs';
import { extractRoutes_ } from '../codegen/extract-routes.js';
import { generateDispatchShims_ } from '../codegen/generate-shims.js';

export interface GasRbacCodegenOptions {
  // Absolute path to the server entry module that calls rbac.requires/anyone.
  entry: string;
  // Absolute path the generated dispatch-shim source is written to.
  out: string;
  // The name consumers import gas-rbac's __rbacDispatch under -- see the
  // amendment on #14: not hardcoded, since it depends on where this package
  // ends up hosted for a given consumer.
  packageName: string;
}

// Minimal shape of what this plugin needs from Vite's Plugin type, hand-rolled
// instead of importing `vite` -- this package doesn't otherwise depend on it,
// and the only hook used is buildStart.
export interface GasRbacCodegenPlugin {
  name: string;
  buildStart: () => void;
}

export function gasRbacCodegen(options: GasRbacCodegenOptions): GasRbacCodegenPlugin {
  return {
    name: 'gas-rbac-codegen',
    buildStart: () => runCodegen_(options),
  };
}

// Route discovery is static source parsing (extractRoutes_), not module
// execution -- see the correction to #14: a route name has to be a literal
// string for a static per-route function to be generated for it at all, so
// parsing the same literal registration arguments a runtime registry would
// see catches exactly the same routes execution-based discovery ever could,
// without needing to run the entry's own module-scope side effects (which
// would otherwise require stubbing whatever GAS globals it happens to touch).
function runCodegen_({ entry, out, packageName }: GasRbacCodegenOptions): void {
  const source = readFileSync(entry, 'utf8');
  const routes = extractRoutes_(source);
  const shimSource = generateDispatchShims_(routes, { packageName });
  writeFileSync(out, shimSource, 'utf8');
}
