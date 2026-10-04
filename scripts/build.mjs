import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const compilerPath = path.join(projectRoot, "node_modules/typescript/bin/tsc");

// Compile first so type errors cannot be mistaken for a successful build.
execFileSync(process.execPath, [compilerPath, "--project", "tsconfig.json", "--noEmit"], {
  cwd: projectRoot,
  stdio: "inherit",
});

// Resolve browser dependencies locally; no executable code is loaded from a CDN.
await build({
  absWorkingDir: projectRoot,
  entryPoints: ["src/popup/popup.ts", "src/options/options.ts", "src/resume/extraction.worker.ts"],
  outbase: "src", outdir: "dist", bundle: true, platform: "browser",
  format: "esm", target: "chrome125", legalComments: "linked",
  // PDF.js relies on class/function names; do not minify identifiers.
  minify: false,
});

const vendorRoot = path.join(projectRoot, "dist/vendor/pdf");
await mkdir(vendorRoot, { recursive: true });
await copyFile(path.join(projectRoot, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"), path.join(vendorRoot, "pdf.worker.min.mjs"));
for (const directory of ["cmaps", "standard_fonts"]) {
  await cp(path.join(projectRoot, "node_modules/pdfjs-dist", directory), path.join(vendorRoot, directory), { recursive: true });
}
await copyFile(path.join(projectRoot, "node_modules/pdfjs-dist/LICENSE"), path.join(vendorRoot, "LICENSE"));
await mkdir(path.join(projectRoot, "dist/vendor/mammoth"), { recursive: true });
await copyFile(path.join(projectRoot, "node_modules/mammoth/LICENSE"), path.join(projectRoot, "dist/vendor/mammoth/LICENSE"));

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
