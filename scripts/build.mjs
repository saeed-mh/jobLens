import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const compilerPath = path.join(projectRoot, "node_modules/typescript/bin/tsc");

// Compile first so type errors cannot be mistaken for a successful build.
execFileSync(process.execPath, [compilerPath, "--project", "tsconfig.json"], {
  cwd: projectRoot,
  stdio: "inherit",
});

const staticFiles = [
  "manifest.json",
  "styles.css",
  "popup/popup.html",
  "options/options.html",
];

for (const relativePath of staticFiles) {
  const destination = path.join(projectRoot, "dist", relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(projectRoot, "src", relativePath), destination);
}

console.log("Build complete. Load the dist folder in chrome://extensions.");
