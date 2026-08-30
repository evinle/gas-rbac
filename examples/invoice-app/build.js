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
const clientOutfile = path.join(dir, 'dist', 'Client.js');

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

// client.ts is browser code (runs inside the HTML service page, not the
// Apps Script server), so it gets esbuild's default iife format instead
// of server.ts's cjs -- there's no `module`/`exports` global to strip
// here, and there's nothing to keep flat at the top level for
// google.script.run to find, unlike server.ts's doGet/__rbacDispatch.
await build({
  entryPoints: [path.join(dir, 'client.ts')],
  bundle: true,
  format: 'iife',
  outfile: clientOutfile,
  platform: 'browser',
});

const clientBundle = readFileSync(clientOutfile, 'utf8');
const webHtml = readFileSync(path.join(dir, 'web.html'), 'utf8').replace('/* CLIENT_BUNDLE */', clientBundle);
writeFileSync(path.join(dir, 'dist', 'web.html'), webHtml);

copyFileSync(path.join(dir, 'appsscript.json'), path.join(dir, 'dist', 'appsscript.json'));

console.log(`built ${outfile} and inlined ${clientOutfile} into dist/web.html`);
