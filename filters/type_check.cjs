const path = require('path');
const regolithRoot = path.resolve(__dirname, '..');
const ts = require(path.join(regolithRoot, 'node_modules', 'typescript'));

const configPath = ts.findConfigFile(
  regolithRoot,
  ts.sys.fileExists,
  'tsconfig.json',
);
if (!configPath) {
  console.error('type_check: tsconfig.json not found in', regolithRoot);
  process.exit(1);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  regolithRoot,
);

const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
});

const diagnostics = ts.getPreEmitDiagnostics(program);

if (diagnostics.length > 0) {
  const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => regolithRoot,
    getCanonicalFileName: (f) => f,
    getNewLine: () => ts.sys.newLine,
  });
  console.error(formatted);
  console.error(`type_check: found ${diagnostics.length} type error(s)`);
  process.exit(1);
}

console.log('type_check: no type errors found');
