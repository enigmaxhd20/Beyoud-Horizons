const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(process.cwd(), 'BP', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`strip_bom: manifest not found at ${manifestPath}`);
  process.exit(1);
}

const buffer = fs.readFileSync(manifestPath);
const hasBOM =
  buffer.length >= 3 &&
  buffer[0] === 0xef &&
  buffer[1] === 0xbb &&
  buffer[2] === 0xbf;

if (hasBOM) {
  fs.writeFileSync(manifestPath, buffer.slice(3));
  console.log('strip_bom: removed BOM from BP/manifest.json');
} else {
  console.log('strip_bom: no BOM found, nothing to do');
}
