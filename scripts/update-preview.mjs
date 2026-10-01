import { execSync } from "node:child_process";

const pkgs = ["@minecraft/server", "@minecraft/server-ui"];

const latestPreview = (name) => {
  const time = JSON.parse(execSync(`npm view ${name} time --json`, { encoding: "utf8" }));
  return Object.entries(time)
    .filter(([v]) => /-beta\..*-preview\.\d+$/.test(v))
    .sort((a, b) => new Date(b[1]) - new Date(a[1]))[0][0];
};

const specs = pkgs.map((p) => `${p}@${latestPreview(p)}`);
console.log("Instalando:", specs.join(" "));
execSync(`npm i -E ${specs.join(" ")}`, { stdio: "inherit" });