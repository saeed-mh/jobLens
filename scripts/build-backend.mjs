import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--project", "backend/tsconfig.json", "--noEmit"], {
  cwd: root, stdio: "inherit",
});
const placeholder = "JOB_LENS_BUILD_ID_PLACEHOLDER";
const bundle = await build({
  absWorkingDir: root, entryPoints: ["backend/src/worker.ts"], outfile: "backend/dist/worker.js",
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: false, write: false,
  define: { __JOB_LENS_BUILD_ID__: JSON.stringify(placeholder) },
});
const generated = bundle.outputFiles[0].text;
const buildId = `job-lens-${createHash("sha256").update(generated).digest("hex").slice(0, 16)}`;
const workerCode = generated.replaceAll(placeholder, buildId);
const directory = path.join(root, "backend/dist");
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, "worker.js"), workerCode);
await writeFile(path.join(directory, "build-info.json"), JSON.stringify({ buildId }, null, 2) + "\n");
console.log("Backend built: backend/dist/worker.js. Paste the entire file into the Cloudflare Worker editor.");
console.log(`Expected deployed build: ${buildId}`);
