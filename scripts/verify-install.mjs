import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVSCodeCommand } from "@vscode/test-electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const vsix = path.join(
  root,
  "artifacts",
  "vsix",
  `${manifest.name}-${manifest.version}.vsix`,
);
const options = {
  version: "1.125.0",
  cachePath: path.join(root, ".vscode-test"),
  reuseMachineInstall: false,
};

await runVSCodeCommand(["--install-extension", vsix, "--force"], options);
const { stdout } = await runVSCodeCommand(
  ["--list-extensions", "--show-versions"],
  options,
);

const expected =
  `${manifest.publisher}.${manifest.name}@${manifest.version}`.toLowerCase();
const installed = stdout
  .split(/\r?\n/)
  .map((line) => line.trim().toLowerCase())
  .filter(Boolean);

if (!installed.includes(expected)) {
  throw new Error(
    `Isolated VSIX install did not list ${expected}. Found: ${installed.join(", ") || "none"}.`,
  );
}

process.stdout.write(`Verified isolated install: ${expected}.\n`);
