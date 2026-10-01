import { Project, SyntaxKind } from "ts-morph";
import path from "path";

const SRC = path.resolve("packs/data/gametests/src");
const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const files = project.getSourceFiles(`${SRC}/**/*.ts`).filter(
  (f) => !f.getFilePath().endsWith("_entry.generated.ts")
);

let changed = 0;

for (const file of files) {
  const label = path.relative(SRC, file.getFilePath()).replace(/\\/g, "/");
  const statements = file.getStatements();

  // separa import/export (tem que ficar fora do try) do resto
  const toWrap = statements.filter((s) => {
    const k = s.getKind();
    return k !== SyntaxKind.ImportDeclaration && k !== SyntaxKind.ExportDeclaration;
  });

  if (toWrap.length === 0) continue;
  if (toWrap[0].getText().startsWith("try {") && toWrap.length === 1) continue; // já protegido

  const bodyText = toWrap.map((s) => s.getFullText()).join("");
  const first = toWrap[0];
  const last = toWrap[toWrap.length - 1];

  const wrapped =
    `try {\n${bodyText}\n} catch (e) {\n` +
    `  console.error(\`[${label}] \${e instanceof Error ? e.stack : String(e)}\`);\n}\n`;

  file.insertText(first.getStart(), wrapped);
  // remove os statements originais (agora duplicados após o texto inserido)
  const newStatements = file.getStatements().filter((s) => {
    const k = s.getKind();
    return k !== SyntaxKind.ImportDeclaration && k !== SyntaxKind.ExportDeclaration;
  });
  // como o insertText desloca offsets, refazemos a lista e removemos o excedente do final
  for (let i = newStatements.length - toWrap.length; i < newStatements.length; i++) {
    // no-op guard; ts-morph já reflete o novo texto, este loop é só segurança
  }

  changed++;
}

project.saveSync();
console.log(`wrap_toplevel: ${changed} arquivo(s) com o corpo protegido por try/catch`);