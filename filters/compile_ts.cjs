const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SRC = path.resolve(process.cwd(), 'data', 'gametests', 'src');
const OUT = path.resolve(process.cwd(), 'BP', 'scripts');
const EXCLUDE_PATTERNS = [/not in use/i];

function walk(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(walk(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function isExcluded(rel) {
  return EXCLUDE_PATTERNS.some((re) => re.test(rel));
}

const allFiles = walk(SRC);
const files = allFiles.filter((f) => !isExcluded(path.relative(SRC, f)));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let ok = 0;
const skipped = [];

for (const f of files) {
  const rel = path.relative(SRC, f);
  const outPath = path.join(OUT, rel.replace(/\.ts$/, '.js'));
  const source = fs.readFileSync(f, 'utf8');

  try {
    const result = esbuild.transformSync(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2020',
      sourcefile: rel,
    });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.code);
    ok++;
  } catch (e) {
    const msg = e && e.errors && e.errors[0] ? e.errors[0].text : String(e);
    skipped.push({ file: rel.replace(/\\/g, '/'), error: msg });
  }
}

console.log(
  `compile_ts: compiled ${ok}/${files.length} file(s) to BP/scripts (${allFiles.length - files.length} excluded by name)`,
);
for (const s of skipped) {
  console.error(`  [SKIPPED] ${s.file}: ${s.error}`);
}
