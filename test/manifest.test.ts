import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(__dirname, "../..");
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
);

test("manifest exposes the Track A commands and opt-in setting", () => {
  assert.equal(manifest.publisher, "yamapan");
  assert.equal(manifest.license, "CC-BY-NC-SA-4.0");
  assert.equal(
    manifest.repository.url,
    "https://github.com/aktsmm/vscode-recent-copilot-chat-id",
  );
  const commandIds = manifest.contributes.commands.map(
    (entry: { command: string }) => entry.command,
  );
  assert.deepEqual(commandIds, [
    "agShowSessionId.refresh",
    "agShowSessionId.copyRecent",
    "agShowSessionId.showSessions",
    "agShowSessionId.showOutput",
  ]);
  assert.equal(
    manifest.contributes.configuration.properties["agShowSessionId.enabled"]
      .default,
    false,
  );
  assert.equal(
    manifest.contributes.configuration.properties["agShowSessionId.enabled"]
      .scope,
    "machine",
  );
  assert.deepEqual(manifest.extensionKind, ["ui"]);
  assert.equal(manifest.enabledApiProposals, undefined);
});

test("runtime source keeps the filename-only privacy boundary", () => {
  const sourceFiles = readdirSync(path.join(ROOT, "src")).filter((name) =>
    name.endsWith(".ts"),
  );
  const source = sourceFiles
    .map((name) => readFileSync(path.join(ROOT, "src", name), "utf8"))
    .join("\n");
  assert.match(source, /workspace\.fs\.readDirectory/);
  assert.match(source, /workspace\.fs\.stat/);
  assert.doesNotMatch(source, /workspace\.fs\.readFile/);
  assert.doesNotMatch(
    source,
    /debug-logs|state\.vscdb|process\.env\.APPDATA|%APPDATA%/i,
  );
  assert.doesNotMatch(
    source,
    /fetch\(|from ["']node:(?:http|https|net|tls|child_process)["']/,
  );
  assert.match(
    source,
    /Recent saved session UUID prefix: \$\{shortenSessionId/,
  );
  assert.doesNotMatch(source, /Recent saved session UUID: \$\{this\.sessions/);
});

test("package lock resolves only from the public npm registry", () => {
  const lock = JSON.parse(
    readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
  );
  const resolved = Object.values(lock.packages)
    .map((entry) => (entry as { resolved?: string } | undefined)?.resolved)
    .filter((value): value is string => Boolean(value));

  assert.ok(resolved.length > 0);
  for (const url of resolved) {
    assert.equal(new URL(url).hostname, "registry.npmjs.org", url);
  }
});

test("status bar updates flow through the accessible renderer", () => {
  const source = readFileSync(path.join(ROOT, "src", "extension.ts"), "utf8");
  assert.equal(source.match(/statusBar\.text =/g)?.length, 1);
  assert.match(source, /statusBar\.accessibilityInformation = \{ label:/);
  assert.match(source, /createOutputChannel\(\s*vscode\.l10n\.t\(/);
  assert.match(source, /Intl\.DateTimeFormat\(vscode\.env\.language/);
  assert.doesNotMatch(
    source,
    /context\.subscriptions\.push\(\s*this\.statusBar/,
  );
  assert.doesNotMatch(source, /context\.subscriptions\.push\(output/);
  assert.match(source, /this\.output\.dispose\(\)/);
  assert.equal(source.match(/clipboard\.writeText\(/g)?.length, 1);
  assert.equal(source.match(/copySessionId\(/g)?.length, 3);
  assert.match(source, /copySessionIdWithRecovery\(id/);
});

test("commands use a single palette category", () => {
  const commands: { command: string; title: string; category?: string }[] =
    manifest.contributes.commands;
  const nls: Record<string, string> = JSON.parse(
    readFileSync(path.join(ROOT, "package.nls.json"), "utf8"),
  );
  const resolve = (value: string): string =>
    value.startsWith("%") ? nls[value.slice(1, -1)] : value;

  for (const entry of commands) {
    assert.equal(resolve(entry.category ?? ""), "Recent Copilot Chat ID");
    assert.doesNotMatch(
      resolve(entry.title),
      /Recent Copilot Chat ID/,
      `Category is duplicated in the title: ${entry.title}`,
    );
  }
});

test("the opt-in intro is shown at most once per profile", () => {
  const source = readFileSync(path.join(ROOT, "src", "extension.ts"), "utf8");
  assert.match(source, /globalState\.get<boolean>\(INTRO_SHOWN_KEY, false\)/);
  assert.match(source, /globalState\.update\(INTRO_SHOWN_KEY, true\)/);
});

test("session file changes update one entry instead of re-scanning", () => {
  const source = readFileSync(path.join(ROOT, "src", "extension.ts"), "utf8");
  assert.equal(
    source.match(/this\.runSafely\(\(\) => this\.applyChangedFile\(uri\)\)/g)
      ?.length,
    2,
  );
  assert.match(source, /upsertSavedSession\(this\.sessions/);
  assert.match(source, /if \(statusKey === this\.lastStatusKey\)/);
});

test("async scans discard stale results and stop after disposal", () => {
  const source = readFileSync(path.join(ROOT, "src", "extension.ts"), "utf8");
  assert.match(source, /const generation = \+\+this\.scanGeneration;/);
  assert.match(
    source,
    /return this\.disposed \|\| generation !== this\.scanGeneration;/,
  );
  assert.equal(source.match(/this\.isStale\(generation\)/g)?.length, 4);
  assert.doesNotMatch(source, /void this\.(refresh|applyChangedFile)\(/);
  assert.match(source, /if \(!this\.disposed\) \{\s*this\.output\.error/);
});

test("session storage resolves for workspace and empty windows", () => {
  const source = readFileSync(path.join(ROOT, "src", "extension.ts"), "utf8");
  assert.match(source, /joinPath\(storageUri, "\.\.", "chatSessions"\)/);
  assert.match(source, /"emptyWindowChatSessions"/);

  const runner = readFileSync(path.join(ROOT, "test", "run-test.ts"), "utf8");
  assert.match(runner, /\[\[extensionDevelopmentPath\], \[\]\]/);
  assert.match(runner, /downloadAndUnzipVSCode/);
  assert.match(runner, /win32VersionedUpdate = false/);
  assert.match(
    runner,
    /Refusing to modify a VS Code executable outside the test cache/,
  );
  assert.match(runner, /Expected one test product\.json/);
});

test("the manifest icon exists as a 128x128 PNG", () => {
  assert.equal(manifest.icon, "images/icon.png");
  assert.match(manifest.scripts.prepackage, /npm run icon/);

  const icon = readFileSync(path.join(ROOT, manifest.icon));
  assert.deepEqual(
    [...icon.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "Icon is not a PNG",
  );
  assert.equal(icon.readUInt32BE(16), 128);
  assert.equal(icon.readUInt32BE(20), 128);
});

test("packaging derives the VSIX filename from package metadata", () => {
  assert.equal(
    manifest.scripts.package,
    "npm run compile && node scripts/package-extension.mjs && npm run verify:vsix",
  );
  assert.equal(manifest.scripts["verify:vsix"], "node scripts/verify-vsix.mjs");
  assert.equal(
    manifest.scripts["verify:install"],
    "node scripts/verify-install.mjs",
  );
  assert.equal(
    manifest.scripts["verify:release"],
    "npm audit --audit-level=high && npm test && npm run package && npm run verify:install",
  );

  const packager = readFileSync(
    path.join(ROOT, "scripts", "package-extension.mjs"),
    "utf8",
  );
  assert.match(
    packager,
    /`\$\{manifest\.name\}-\$\{manifest\.version\}\.vsix`/,
  );
  assert.match(packager, /process\.env\.npm_execpath/);
  assert.match(packager, /spawnSync\(\s*process\.execPath/);
  assert.match(packager, /--package=@vscode\/vsce@3\.9\.2/);

  const verifier = readFileSync(
    path.join(ROOT, "scripts", "verify-vsix.mjs"),
    "utf8",
  );
  assert.match(verifier, /VSIX payload mismatch/);
  assert.match(verifier, /enabledApiProposals/);
  assert.match(verifier, /machine-scoped/);
  assert.match(verifier, /Compressed data exceeds VSIX bounds/);
  assert.match(verifier, /central directory exceeds archive bounds/);

  const installer = readFileSync(
    path.join(ROOT, "scripts", "verify-install.mjs"),
    "utf8",
  );
  assert.match(installer, /reuseMachineInstall: false/);
  assert.match(installer, /--install-extension/);
  assert.match(installer, /--list-extensions/);

  for (const readme of ["README.md", "README.ja.md"]) {
    const content = readFileSync(path.join(ROOT, readme), "utf8");
    assert.doesNotMatch(content, /ag-show-session-id-\d+\.\d+\.\d+\.vsix/);
  }
});

test("the English and Japanese readmes link to each other", () => {
  const english = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const japanese = readFileSync(path.join(ROOT, "README.ja.md"), "utf8");

  assert.match(english, /href="README\.ja\.md"/);
  assert.match(japanese, /href="README\.md"/);
  for (const readme of [english, japanese]) {
    assert.match(readme, /badgen\.net\/badge\/Status\/Preview/);
    assert.match(
      readme,
      /marketplace\.visualstudio\.com\/items\?itemName=yamapan\.ag-show-session-id/,
    );
    assert.match(readme, /github\.com\/aktsmm\/vscode-recent-copilot-chat-id/);
    assert.doesNotMatch(readme, /aktsmm\.ag-show-session-id|UNLICENSED/);
  }

  for (const heading of [
    "Installation",
    "Enable",
    "Commands",
    "Status bar states",
    "Privacy",
    "Compatibility",
  ]) {
    assert.ok(english.includes(`## ${heading}`), `Missing section: ${heading}`);
  }
  assert.equal(
    english.match(/^## /gm)?.length,
    japanese.match(/^## /gm)?.length,
    "Readme translations drifted apart",
  );
});

test("every unit test file is registered in the test:unit script", () => {
  const unitScript: string = manifest.scripts["test:unit"];
  const testFiles = readdirSync(path.join(ROOT, "test")).filter((name) =>
    name.endsWith(".test.ts"),
  );

  assert.ok(testFiles.length > 0);
  for (const file of testFiles) {
    const compiled = `out/test/${file.replace(/\.ts$/, ".js")}`;
    assert.ok(
      unitScript.includes(compiled),
      `Test file is never executed: ${compiled}`,
    );
  }
});
