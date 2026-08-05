import path from "node:path";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const TEST_VERSION = "1.125.0";

function resolveProductPath(executablePath: string): string {
  const executableRoot = path.dirname(executablePath);
  const direct = path.join(executableRoot, "resources", "app", "product.json");
  const candidates = [direct];

  for (const entry of readdirSync(executableRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      candidates.push(
        path.join(
          executableRoot,
          entry.name,
          "resources",
          "app",
          "product.json",
        ),
      );
    }
  }

  const existing = candidates.filter((candidate) => existsSync(candidate));
  if (existing.length !== 1) {
    throw new Error(
      `Expected one test product.json, found ${existing.length}.`,
    );
  }

  return existing[0];
}

async function prepareTestExecutable(extensionRoot: string): Promise<string> {
  const cachePath = path.join(extensionRoot, ".vscode-test");
  const executable = await downloadAndUnzipVSCode({
    version: TEST_VERSION,
    cachePath,
  });

  if (process.platform !== "win32") {
    return executable;
  }

  const cacheRoot = realpathSync(cachePath);
  const executablePath = realpathSync(executable);
  const relative = path.relative(cacheRoot, executablePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "Refusing to modify a VS Code executable outside the test cache.",
    );
  }

  // Archive builds are not Inno Setup installations and must not share its update mutex.
  const productPath = resolveProductPath(executablePath);
  const product = JSON.parse(readFileSync(productPath, "utf8"));
  if (product.win32VersionedUpdate !== false) {
    product.win32VersionedUpdate = false;
    writeFileSync(productPath, `${JSON.stringify(product, null, 2)}\n`);
  }

  return executablePath;
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index");
  const vscodeExecutablePath = await prepareTestExecutable(
    extensionDevelopmentPath,
  );

  // The second run has no folder argument so the empty-window storage path is exercised too.
  for (const folderArgs of [[extensionDevelopmentPath], []]) {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
      launchArgs: [...folderArgs, "--disable-extensions"],
    });
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown test runner error";
  process.stderr.write(`Extension tests failed: ${message}\n`);
  process.exitCode = 1;
});
