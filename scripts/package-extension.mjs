import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const output = path.join(
  root,
  "artifacts",
  "vsix",
  `${manifest.name}-${manifest.version}.vsix`,
);

mkdirSync(path.dirname(output), { recursive: true });
for (const name of readdirSync(path.dirname(output))) {
  if (
    name.endsWith(".vsix") &&
    path.join(path.dirname(output), name) !== output
  ) {
    rmSync(path.join(path.dirname(output), name), { force: true });
  }
}

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  throw new Error("npm_execpath is unavailable; run this script through npm.");
}

if (!existsSync(npmExecPath)) {
  throw new Error(`npm CLI was not found: ${npmExecPath}`);
}

const result = spawnSync(
  process.execPath,
  [
    npmExecPath,
    "exec",
    "--yes",
    "--package=@vscode/vsce@3.9.2",
    "--",
    "vsce",
    "package",
    "--out",
    output,
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
