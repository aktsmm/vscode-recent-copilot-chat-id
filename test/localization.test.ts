import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  describeRecordStatus,
  describeSessionStatus,
  describeUnavailableStatus,
} from "../src/status-presentation";
import { buildSessionTreeRows } from "../src/session-tree-model";

const ROOT = path.resolve(__dirname, "../..");

function readJson(...segments: string[]): Record<string, string> {
  return JSON.parse(readFileSync(path.join(ROOT, ...segments), "utf8"));
}

function readSource(name: string): string {
  return readFileSync(path.join(ROOT, "src", name), "utf8");
}

const manifest = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
);
const defaultNls = readJson("package.nls.json");
const japaneseNls = readJson("package.nls.ja.json");
const japaneseBundle = readJson("l10n", "bundle.l10n.ja.json");

test("every manifest nls placeholder is translated in all locales", () => {
  const placeholders = [
    ...JSON.stringify(manifest).matchAll(/%([\w.]+)%/g),
  ].map((match) => match[1]);

  assert.ok(placeholders.length > 0);
  for (const key of placeholders) {
    assert.ok(key in defaultNls, `Missing default nls key: ${key}`);
    assert.ok(key in japaneseNls, `Missing Japanese nls key: ${key}`);
  }
  assert.deepEqual(
    Object.keys(defaultNls).sort(),
    Object.keys(japaneseNls).sort(),
  );
});

test("manifest declares the runtime l10n bundle folder", () => {
  assert.equal(manifest.l10n, "./l10n");
});

test("every runtime l10n string has a Japanese translation", () => {
  const source = ["extension.ts", "session-tree.ts"].map(readSource).join("\n");
  const runtimeStrings = [
    ...source.matchAll(/vscode\.l10n\.t\(\s*"((?:[^"\\]|\\.)*)"/g),
  ].map((match) => JSON.parse(`"${match[1]}"`) as string);

  assert.ok(runtimeStrings.length > 0);
  for (const message of runtimeStrings) {
    assert.ok(
      message in japaneseBundle,
      `Missing Japanese translation: ${message}`,
    );
  }
});

test("every status bar string has a Japanese translation", () => {
  const collected: string[] = [];
  const collect = (message: string, ...args: string[]): string => {
    collected.push(message);
    return args.reduce(
      (text, value, index) => text.replaceAll(`{${index}}`, value),
      message,
    );
  };

  describeSessionStatus([], collect);
  describeSessionStatus(
    [
      { id: "11111111-1111-4111-8111-111111111111", modifiedAt: 300 },
      { id: "22222222-2222-4222-8222-222222222222", modifiedAt: 300 },
    ],
    collect,
  );
  describeSessionStatus(
    [{ id: "11111111-1111-4111-8111-111111111111", modifiedAt: 300 }],
    collect,
  );
  describeUnavailableStatus(collect);
  describeRecordStatus(
    [
      {
        id: "11111111-1111-4111-8111-111111111111",
        modifiedAt: 300,
        displayTitle: "Authentication failure",
        titleSource: "metadata",
      },
    ],
    collect,
  );
  buildSessionTreeRows(
    [
      {
        id: "11111111-1111-4111-8111-111111111111",
        modifiedAt: 300,
        displayTitle: "Authentication failure",
        titleSource: "metadata",
      },
    ],
    "en-US",
    collect,
    400,
  );

  assert.ok(collected.length > 0);
  for (const message of collected) {
    assert.ok(
      message in japaneseBundle,
      `Missing Japanese translation: ${message}`,
    );
  }
});

test("translations keep the same placeholder set", () => {
  for (const [source, translated] of Object.entries(japaneseBundle)) {
    const expected = [...source.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();
    const actual = [...translated.matchAll(/\{(\d+)\}/g)]
      .map((m) => m[1])
      .sort();
    assert.deepEqual(actual, expected, `Placeholder mismatch for: ${source}`);
  }
});
