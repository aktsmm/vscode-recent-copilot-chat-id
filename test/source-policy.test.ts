import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

const ALLOWED_STATIC_MODULES = new Set([
  "vscode",
  "node:path",
  "node:crypto",
  "node:worker_threads",
]);
const ALLOWED_DYNAMIC_MODULES = new Set(["node:sqlite"]);
const FILE_READ_NAMES = new Set([
  "readFile",
  "readFileSync",
  "createReadStream",
  "open",
  "openSync",
]);
const NETWORK_NAMES = new Set(["fetch"]);
const MODULE_LOADERS = new Set(["require"]);
const FILE_READ_OWNER = "session-usage-reader.ts";

interface SourceFacts {
  readonly file: string;
  readonly staticModules: string[];
  readonly dynamicModules: string[];
  /** Specifiers that are not plain literals, plus loader, network, and read aliasing. */
  readonly opaqueReferences: string[];
  readonly fileReads: string[];
  readonly networkCalls: string[];
  readonly messageLiterals: string[];
  readonly nonLiteralMessages: string[];
  readonly localizedLogs: string[];
}

function listSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSources(full);
    }
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function isCallee(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if (ts.isCallExpression(parent) && parent.expression === node) {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.parent !== undefined &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  );
}

function containsTranslateCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && calleeName(node.expression) === "t") {
    return true;
  }
  return ts.forEachChild(node, containsTranslateCall) ?? false;
}

function analyze(text: string, name: string): SourceFacts {
  const source = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const facts: SourceFacts = {
    file: name,
    staticModules: [],
    dynamicModules: [],
    opaqueReferences: [],
    fileReads: [],
    networkCalls: [],
    messageLiterals: [],
    nonLiteralMessages: [],
    localizedLogs: [],
  };
  const excerpt = (node: ts.Node): string =>
    node.getText(source).replaceAll(/\s+/g, " ").slice(0, 60);

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        facts.staticModules.push(node.moduleSpecifier.text);
      } else {
        facts.opaqueReferences.push(excerpt(node));
      }
    }
    if (ts.isImportEqualsDeclaration(node)) {
      facts.opaqueReferences.push(excerpt(node));
    }
    if (ts.isImportTypeNode(node)) {
      const literal = ts.isLiteralTypeNode(node.argument)
        ? node.argument.literal
        : undefined;
      if (literal && ts.isStringLiteral(literal)) {
        facts.dynamicModules.push(literal.text);
      } else {
        facts.opaqueReferences.push(excerpt(node));
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      (FILE_READ_NAMES.has(node.argumentExpression.text) ||
        NETWORK_NAMES.has(node.argumentExpression.text) ||
        MODULE_LOADERS.has(node.argumentExpression.text))
    ) {
      facts.opaqueReferences.push(excerpt(node));
    }
    if (
      ts.isIdentifier(node) &&
      (MODULE_LOADERS.has(node.text) || NETWORK_NAMES.has(node.text)) &&
      !isCallee(node)
    ) {
      facts.opaqueReferences.push(excerpt(node.parent ?? node));
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const [first] = node.arguments;
      const isLoader =
        (name !== undefined && MODULE_LOADERS.has(name)) ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isLoader) {
        if (first && ts.isStringLiteral(first)) {
          facts.dynamicModules.push(first.text);
        } else {
          facts.opaqueReferences.push(excerpt(node));
        }
      }
      if (name && FILE_READ_NAMES.has(name)) {
        facts.fileReads.push(name);
      }
      if (name && NETWORK_NAMES.has(name)) {
        facts.networkCalls.push(name);
      }
      if (name === "t") {
        if (first && ts.isStringLiteral(first)) {
          facts.messageLiterals.push(first.text);
        } else {
          facts.nonLiteralMessages.push(excerpt(node));
        }
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ["info", "warn", "error"].includes(node.expression.name.text) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === "output" &&
        node.arguments.some(containsTranslateCall)
      ) {
        facts.localizedLogs.push(excerpt(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return facts;
}

function collect(file: string): SourceFacts {
  return analyze(readFileSync(file, "utf8"), path.relative(SRC, file));
}

const facts = listSources(SRC).map(collect);
const japaneseBundle: Record<string, string> = JSON.parse(
  readFileSync(path.join(ROOT, "l10n", "bundle.l10n.ja.json"), "utf8"),
);

test("the scan covers exactly the modules the VSIX ships", () => {
  const packaged = [
    ...readFileSync(
      path.join(ROOT, "scripts", "verify-vsix.mjs"),
      "utf8",
    ).matchAll(/"extension\/out\/src\/([^"]+)\.js"/g),
  ].map((match) => `${match[1]}.ts`);

  assert.ok(packaged.length > 0);
  const scanned = new Set(facts.map((entry) => entry.file));
  for (const name of packaged) {
    assert.ok(scanned.has(name), `Unscanned packaged module: src/${name}`);
  }
  assert.equal(scanned.size, packaged.length);
});

test("the scan walks nested directories", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "source-policy-"));
  try {
    mkdirSync(path.join(root, "nested"));
    writeFileSync(path.join(root, "nested", "deep.ts"), "export const a = 1;");
    writeFileSync(path.join(root, "skip.md"), "not source");
    assert.deepEqual(
      listSources(root).map((file) => path.relative(root, file)),
      [path.join("nested", "deep.ts")],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the scan detects each violation it guards", () => {
  const violating = analyze(
    [
      'import "node:child_process";',
      'import net from "node:net";',
      'const direct = require("node:fs");',
      "const load = require;",
      "const send = fetch;",
      'const aliased = load("node:dns");',
      "function go(t, key, vscode, fs) {",
      '  readFileSync("x");',
      '  fs["readFile"](key);',
      '  fetch("https://example.invalid");',
      '  this.output.warn(t("nope"));',
      "  return t(key);",
      "}",
    ].join("\n"),
    "violating.ts",
  );

  assert.deepEqual(violating.staticModules, ["node:child_process", "node:net"]);
  assert.deepEqual(violating.dynamicModules, ["node:fs"]);
  assert.deepEqual(violating.fileReads, ["readFileSync"]);
  assert.deepEqual(violating.networkCalls, ["fetch"]);
  assert.deepEqual(violating.messageLiterals, ["nope"]);
  assert.equal(violating.nonLiteralMessages.length, 1);
  assert.equal(violating.localizedLogs.length, 1);
  // The require alias, the fetch alias, and the element-access read.
  assert.ok(violating.opaqueReferences.length >= 3);
});

test("the scan rejects non-literal module specifiers", () => {
  const templated = analyze(
    ["const a = require(`node:fs`);", "const b = import(`node:net`);"].join(
      "\n",
    ),
    "templated.ts",
  );

  assert.deepEqual(templated.dynamicModules, []);
  assert.equal(templated.opaqueReferences.length, 2);
});

test("only allowlisted modules are referenced", () => {
  for (const entry of facts) {
    assert.deepEqual(
      entry.opaqueReferences,
      [],
      `src/${entry.file} references a module or loader indirectly`,
    );
    for (const module of entry.staticModules) {
      if (module.startsWith(".")) {
        const resolved = path.resolve(SRC, path.dirname(entry.file), module);
        assert.ok(
          resolved.startsWith(SRC + path.sep),
          `Relative import escapes src: ${module} in src/${entry.file}`,
        );
        continue;
      }
      assert.ok(
        ALLOWED_STATIC_MODULES.has(module),
        `Unexpected import ${module} in src/${entry.file}`,
      );
    }
    for (const module of entry.dynamicModules) {
      assert.ok(
        ALLOWED_DYNAMIC_MODULES.has(module),
        `Unexpected dynamic module ${module} in src/${entry.file}`,
      );
    }
  }
});

test("no source performs network or out-of-scope file reads", () => {
  for (const entry of facts) {
    assert.deepEqual(
      entry.networkCalls,
      [],
      `src/${entry.file} must not call the network`,
    );
    if (entry.file !== FILE_READ_OWNER) {
      assert.deepEqual(
        entry.fileReads,
        [],
        `src/${entry.file} must not read file contents`,
      );
    }
  }
});

test("every localized message uses a literal key that is translated", () => {
  const collected: string[] = [];
  for (const entry of facts) {
    assert.deepEqual(
      entry.nonLiteralMessages,
      [],
      `src/${entry.file} passes a non-literal message key`,
    );
    collected.push(...entry.messageLiterals);
  }
  assert.ok(collected.length > 0);
  for (const message of collected) {
    assert.ok(
      message in japaneseBundle,
      `Missing Japanese translation: ${message}`,
    );
  }
});

test("diagnostic log calls stay untranslated", () => {
  for (const entry of facts) {
    assert.deepEqual(
      entry.localizedLogs,
      [],
      `src/${entry.file} localizes a diagnostic log entry`,
    );
  }
});
