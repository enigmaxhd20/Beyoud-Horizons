const fs = require('fs');
const path = require('path');
const archiverModule = require('archiver');
const archiver = archiverModule.default || archiverModule;

const regolithRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(regolithRoot, '..');
const cwdBP = path.resolve(process.cwd(), 'BP');
const cwdRP = path.resolve(process.cwd(), 'RP');
const projectWT = path.join(projectRoot, 'WT');
const projectSP = path.join(projectRoot, 'SP');

const manifest = JSON.parse(
  fs
    .readFileSync(path.join(cwdBP, 'manifest.json'), 'utf8')
    .replace(/^\uFEFF/, ''),
);

function readLangValue(rawKey, langDirs) {
  for (const dir of langDirs) {
    const langPath = path.join(dir, 'texts', 'en_US.lang');
    if (!fs.existsSync(langPath)) continue;
    const lines = fs
      .readFileSync(langPath, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/);
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key === rawKey)
        return line
          .slice(eq + 1)
          .split('#')[0]
          .trim();
    }
  }
  return rawKey;
}

function sanitizeName(name) {
  return (
    name
      .replace(/§[0-9a-fk-or]/gi, '')
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'addon'
  );
}

function resolvePackName(rawName, langDirs) {
  if (typeof rawName !== 'string') return 'addon';
  const isTranslationKey =
    /^[a-z0-9_]+\.[a-z0-9_.]+$/i.test(rawName) && !rawName.includes(' ');
  const resolved = isTranslationKey
    ? readLangValue(rawName, langDirs)
    : rawName;
  return sanitizeName(resolved);
}

const packName = resolvePackName(manifest.header.name, [cwdRP, cwdBP]);
const packVersion = Array.isArray(manifest.header.version)
  ? manifest.header.version.join('.')
  : String(manifest.header.version);

const outDir = path.join(regolithRoot, 'build');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${packName}-${packVersion}.mcaddon`);

const output = fs.createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(
    `package_mcaddon: generated ${outFile} (${archive.pointer()} bytes)`,
  );
});
archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(cwdBP, 'BP');
archive.directory(cwdRP, 'RP');

if (fs.existsSync(projectSP)) {
  archive.directory(projectSP, 'SP');
  console.log('package_mcaddon: SP included in the package');
} else {
  console.log('package_mcaddon: SP not found, skipped (optional)');
}

if (fs.existsSync(projectWT)) {
  archive.directory(projectWT, 'WT');
  console.log('package_mcaddon: WT included in the package');
} else {
  console.log('package_mcaddon: WT not found, skipped (optional)');
}

archive.finalize();
