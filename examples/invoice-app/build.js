// Bundles server.ts into dist/Code.js for real deployment. cjs format is
// deliberate, not a default left in place: esbuild's default/iife formats
// wrap the whole bundle in `(() => { ... })()`, which hides every top-level
// function declaration from Apps Script's global scope -- google.script.run
// would never find them, and doGet wouldn't be found by the platform either.
// cjs format is the one that leaves declarations flat at the top level, at
// the cost of a trailing `module.exports = ...` line referencing globals
// (`module`) that don't exist in the Apps Script runtime -- stripped below.
// Confirmed against esbuild 0.28.2; re-check if the esbuild version changes.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(dir, 'dist', 'Code.js');

mkdirSync(path.join(dir, 'dist'), { recursive: true });

await build({
  entryPoints: [path.join(dir, 'server.ts')],
  bundle: true,
  format: 'cjs',
  outfile,
  platform: 'neutral',
});

const bundled = readFileSync(outfile, 'utf8');
const stripped = bundled
  .split('\n')
  .filter((line) => !line.startsWith('module.exports ='))
  .join('\n');
writeFileSync(outfile, stripped);

copyFileSync(path.join(dir, 'appsscript.json'), path.join(dir, 'dist', 'appsscript.json'));
copyFileSync(path.join(dir, 'web.html'), path.join(dir, 'dist', 'web.html'));

console.log(`built ${outfile}`);
