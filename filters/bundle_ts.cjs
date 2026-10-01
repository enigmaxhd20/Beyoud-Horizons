const path = require('path');
const esbuild = require('esbuild');

const ENTRY = path.resolve(
  process.cwd(),
  'data',
  'gametests',
  'src',
  'main.ts',
);
const OUTFILE = path.resolve(process.cwd(), 'BP', 'scripts', 'main.js');

try {
  esbuild.buildSync({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify: true,
  });
  console.log(
    'bundle_ts: generated BP/scripts/main.js (single minified bundle)',
  );
} catch (e) {
  console.error('bundle_ts: bundling failed -', (e && e.message) || String(e));
  process.exit(1);
}
