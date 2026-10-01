const fs = require('fs');
const path = require('path');

const cwdBP = path.resolve(process.cwd(), 'BP');
const cwdRP = path.resolve(process.cwd(), 'RP');

const projectRoot = path.resolve(__dirname, '..', '..');
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

const appdata = process.env.APPDATA;
const localAppData = process.env.LOCALAPPDATA;

const candidates = [
  localAppData &&
    path.join(
      localAppData,
      'Packages',
      'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
      'LocalState',
      'games',
      'com.mojang',
    ),
  localAppData &&
    path.join(
      localAppData,
      'Packages',
      'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe',
      'LocalState',
      'games',
      'com.mojang',
    ),
  appdata &&
    path.join(
      appdata,
      'Minecraft Bedrock',
      'Users',
      'Shared',
      'games',
      'com.mojang',
    ),
  appdata &&
    path.join(
      appdata,
      'Minecraft Bedrock Preview',
      'Users',
      'Shared',
      'games',
      'com.mojang',
    ),
].filter(Boolean);

let found = 0;

for (const root of candidates) {
  if (!fs.existsSync(root)) continue;
  found++;

  const bpOut = path.join(root, 'development_behavior_packs', `${packName}_bp`);
  const rpOut = path.join(root, 'development_resource_packs', `${packName}_rp`);
  fs.rmSync(bpOut, { recursive: true, force: true });
  fs.rmSync(rpOut, { recursive: true, force: true });
  fs.cpSync(cwdBP, bpOut, { recursive: true });
  fs.cpSync(cwdRP, rpOut, { recursive: true });
  console.log(`export_to_game: copied BP/RP to ${root}`);

  if (fs.existsSync(projectSP)) {
    const spOut = path.join(root, 'development_skin_packs', `${packName}_sp`);
    fs.rmSync(spOut, { recursive: true, force: true });
    fs.cpSync(projectSP, spOut, { recursive: true });
    console.log(
      `export_to_game: copied SP to ${spOut} (confirm in-game that it was recognized)`,
    );
  }

  if (fs.existsSync(projectWT)) {
    const wtOut = path.join(
      root,
      'development_world_templates',
      `${packName}_wt`,
    );
    fs.rmSync(wtOut, { recursive: true, force: true });
    fs.cpSync(projectWT, wtOut, { recursive: true });
    console.log(
      `export_to_game: copied WT to ${wtOut} (folder is not officially documented; confirm in-game)`,
    );
  }
}

if (found === 0) {
  console.error(
    'export_to_game: no Minecraft Bedrock installation found in known locations',
  );
  process.exit(1);
}

if (!fs.existsSync(projectSP))
  console.log('export_to_game: SP folder not found, skipped (optional)');
if (!fs.existsSync(projectWT))
  console.log('export_to_game: WT folder not found, skipped (optional)');
