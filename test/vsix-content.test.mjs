import assert from "node:assert/strict";
import test from "node:test";
import { verifyVsixContent } from "../scripts/verify-vsix-content.mjs";

const manifest = {
  name: "fixture",
  version: "0.3.1",
  publisher: "fixture-publisher",
  engines: { vscode: "^1.105.0" },
  contributes: { commands: [{ command: "fixture.run" }] },
};
const assets = [
  "out/src/extension.js",
  "out/src/session-usage-worker.js",
  "l10n/bundle.l10n.ja.json",
  "package.nls.json",
  "package.nls.ja.json",
  "images/icon.png",
  "images/sessions-activity.svg",
];
const source = new Map(
  assets.map((name) => [name, Buffer.from(`fixture:${name}`)]),
);
const entries = new Map(
  [...source].map(([name, contents]) => [`extension/${name}`, contents]),
);
const readSource = (name) => {
  assert.ok(source.has(name), `Unexpected source read: ${name}`);
  return source.get(name);
};

test("VSIX content gate accepts matching runtime assets and structured manifest", () => {
  verifyVsixContent(manifest, structuredClone(manifest), entries, readSource);
});

test("VSIX content gate rejects stale compiled code, locales and icons with the same filenames", () => {
  for (const name of assets) {
    const stale = new Map(entries);
    stale.set(`extension/${name}`, Buffer.from("stale payload"));
    assert.throws(
      () => verifyVsixContent(manifest, manifest, stale, readSource),
      (error) =>
        error.message ===
        `Packaged content differs from source: extension/${name}`,
    );
  }
});

test("VSIX content gate rejects incorrect engine, publisher and contributions", () => {
  for (const update of [
    { engines: { vscode: "^1.125.0" } },
    { publisher: "other-publisher" },
    { contributes: { commands: [] } },
    { enabledApiProposals: ["fixture"] },
  ]) {
    assert.throws(
      () =>
        verifyVsixContent(
          manifest,
          { ...manifest, ...update },
          entries,
          readSource,
        ),
      /Packaged manifest field differs from source:/,
    );
  }
});
