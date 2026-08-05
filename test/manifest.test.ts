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
  assert.equal(manifest.preview, true);
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
    "agShowSessionId.openView",
    "agShowSessionId.copySession",
    "agShowSessionId.showDetails",
    "agShowSessionId.setAlias",
    "agShowSessionId.clearAlias",
    "agShowSessionId.openSettings",
    "agShowSessionId.enable",
    "agShowSessionId.enableTitles",
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
  assert.equal(
    manifest.contributes.configuration.properties["agShowSessionId.readTitles"]
      .default,
    false,
  );
  assert.equal(
    manifest.contributes.configuration.properties["agShowSessionId.readTitles"]
      .scope,
    "machine",
  );
  assert.equal(
    manifest.contributes.viewsContainers.activitybar[0].id,
    "agShowSessionIdSessions",
  );
  assert.match(
    manifest.contributes.viewsContainers.activitybar[0].id,
    /^[A-Za-z0-9_-]+$/,
  );
  assert.equal(
    manifest.contributes.views.agShowSessionIdSessions[0].id,
    "agShowSessionId.sessionsView",
  );
  assert.equal(manifest.contributes.menus["view/title"].length, 4);
  assert.equal(manifest.contributes.menus["view/item/context"].length, 4);
  const activityIcon = readFileSync(
    path.join(ROOT, "images", "sessions-activity.svg"),
    "utf8",
  );
  assert.match(activityIcon, /stroke="currentColor"/);
  assert.doesNotMatch(activityIcon, /#C5C5C5/i);
  assert.equal(manifest.contributes.viewsWelcome.length, 3);
  assert.match(
    manifest.contributes.viewsWelcome[1].when,
    /agShowSessionId\.scanAvailable/,
  );
  assert.match(
    manifest.contributes.viewsWelcome[2].when,
    /!agShowSessionId\.scanAvailable/,
  );
  assert.deepEqual(manifest.extensionKind, ["ui"]);
  assert.equal(manifest.enabledApiProposals, undefined);
});

test("runtime source keeps the bounded metadata privacy boundary", () => {
  const sourceFiles = readdirSync(path.join(ROOT, "src")).filter((name) =>
    name.endsWith(".ts"),
  );
  const source = sourceFiles
    .map((name) => readFileSync(path.join(ROOT, "src", name), "utf8"))
    .join("\n");
  assert.match(source, /workspace\.fs\.readDirectory/);
  assert.match(source, /workspace\.fs\.stat/);
  assert.doesNotMatch(source, /workspace\.fs\.readFile/);
  assert.doesNotMatch(source, /debug-logs|process\.env\.APPDATA|%APPDATA%/i);
  assert.doesNotMatch(
    source,
    /fetch\(|from ["']node:(?:http|https|net|tls|child_process)["']/,
  );
  assert.match(
    source,
    /Recent saved session UUID prefix: \$\{shortenSessionId/,
  );
  assert.doesNotMatch(source, /Recent saved session UUID: \$\{this\.sessions/);

  const indexSource = readFileSync(
    path.join(ROOT, "src", "session-index.ts"),
    "utf8",
  );
  assert.equal(indexSource.match(/state\.vscdb/g)?.length, 2);
  assert.match(
    indexSource,
    /new DatabaseSync\(databasePath, \{ readOnly: true \}\)/,
  );
  assert.match(indexSource, /SELECT value FROM ItemTable WHERE key = \?/);
  assert.match(indexSource, /length\(CAST\(value AS BLOB\)\)/);
  assert.match(indexSource, /MAX_SESSION_INDEX_BYTES/);
  assert.match(indexSource, /MAX_SESSION_INDEX_ENTRIES/);
  assert.match(indexSource, /MAX_SESSION_METADATA_TITLE_LENGTH/);
  assert.match(indexSource, /CHAT_SESSION_INDEX_KEY/);
  assert.doesNotMatch(indexSource, /(?:INSERT|UPDATE|DELETE|REPLACE)\s+/i);

  for (const file of sourceFiles.filter(
    (name) => name !== "session-index.ts",
  )) {
    const content = readFileSync(path.join(ROOT, "src", file), "utf8");
    assert.doesNotMatch(content, /state\.vscdb|DatabaseSync|ItemTable/);
  }
  assert.match(indexSource, /SESSION_INDEX_DATABASE_GLOB = "state\.vscdb\*"/);
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
  assert.match(source, /recent: COMMANDS\.openView/);
  assert.doesNotMatch(source, /recent: COMMANDS\.copyRecent/);
  assert.match(source, /this\.treeView\.reveal\(sessionNode/);
  assert.doesNotMatch(
    source,
    /context\.subscriptions\.push\(\s*this\.statusBar/,
  );
  assert.doesNotMatch(source, /context\.subscriptions\.push\(output/);
  assert.match(source, /this\.output\.dispose\(\)/);
  assert.equal(source.match(/clipboard\.writeText\(/g)?.length, 1);
  assert.equal(source.match(/copySessionId\(/g)?.length, 4);
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

test("local titles use profile-local state with workspace migration", () => {
  const source = readFileSync(path.join(ROOT, "src", "extension.ts"), "utf8");
  assert.match(source, /context\.globalState,/);
  assert.match(
    source,
    /context\.storageUri \? \[context\.workspaceState\] : \[\]/,
  );
  assert.match(source, /this\.aliasStore\.migrate\(ids\)/);
  assert.doesNotMatch(source, /setKeysForSync/);
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
  assert.match(source, /const generation = \+\+this\.scanGeneration;/);
  assert.match(source, /this\.scheduleRefresh\(\)/);
  assert.match(source, /SESSION_INDEX_DATABASE_GLOB/);
  assert.match(source, /scheduleTitleRefresh/);
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
  assert.match(source, /if \(this\.disposed\) \{\s*return;/);
  assert.match(
    source,
    /this\.records\.find\(\(record\) => record\.id === node\.record\.id\)/,
  );
  assert.match(source, /new VisibleRefreshScheduler/);
  assert.match(source, /setVisible\(this\.treeView\.visible\)/);
  assert.match(source, /onDidChangeVisibility/);
  assert.match(source, /selectSessionRecord\(this\.records, requestedId\)/);
  assert.match(source, /if \(requestedId && !record\)/);
  assert.doesNotMatch(source, /recordFromNode\(node\) \?\? this\.records\[0\]/);
  assert.match(source, /That saved session is no longer available\./);
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
  assert.match(packager, /name\.endsWith\("\.vsix"\)/);

  const verifier = readFileSync(
    path.join(ROOT, "scripts", "verify-vsix.mjs"),
    "utf8",
  );
  assert.match(verifier, /VSIX payload mismatch/);
  assert.match(verifier, /enabledApiProposals/);
  assert.match(verifier, /machine-scoped/);
  assert.match(verifier, /Compressed data exceeds VSIX bounds/);
  assert.match(verifier, /central directory exceeds archive bounds/);
  assert.match(verifier, /Stale VSIX artifacts found/);

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
