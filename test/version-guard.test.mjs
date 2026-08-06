import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyVersion } from "../scripts/verify-version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("verifyVersion accepts the current untagged changelog version", () => {
  assert.doesNotThrow(() => verifyVersion(ROOT, "0.2.0"));
});

test("verifyVersion rejects an existing release tag", () => {
  assert.throws(
    () => verifyVersion(ROOT, "0.1.0"),
    /already tagged as v0\.1\.0/,
  );
});

test("verifyVersion rejects invalid changelog dates before packaging", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "version-guard-date-"));
  try {
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Change Log\n\n## 0.2.0 - 2026-02-31\n",
    );
    assert.throws(
      () => verifyVersion(root, "0.2.0"),
      /invalid release date/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyVersion fails closed outside a Git work tree", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "version-guard-git-"));
  try {
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Change Log\n\n## 0.2.0 - Unreleased\n",
    );
    assert.throws(
      () => verifyVersion(root, "0.2.0"),
      /Git repository verification failed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
