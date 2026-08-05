import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceManifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const defaultVsix = path.join(
  root,
  "artifacts",
  "vsix",
  `${sourceManifest.name}-${sourceManifest.version}.vsix`,
);
const vsixPath = path.resolve(root, process.argv[2] ?? defaultVsix);
const archive = readFileSync(vsixPath);
const siblingVsix = readdirSync(path.dirname(vsixPath)).filter((name) =>
  name.endsWith(".vsix"),
);
if (siblingVsix.length !== 1 || siblingVsix[0] !== path.basename(vsixPath)) {
  throw new Error(`Stale VSIX artifacts found: ${siblingVsix.join(", ")}`);
}

function findEndOfCentralDirectory() {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset--) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("VSIX end-of-central-directory record was not found.");
}

function readEntries() {
  const end = findEndOfCentralDirectory();
  const total = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12);
  let offset = archive.readUInt32LE(end + 16);
  const centralEnd = offset + centralSize;
  if (centralEnd > end || centralEnd > archive.length) {
    throw new Error("VSIX central directory exceeds archive bounds.");
  }
  const entries = new Map();

  for (let index = 0; index < total; index++) {
    if (offset + 46 > centralEnd) {
      throw new Error(`Truncated central-directory entry at offset ${offset}.`);
    }
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central-directory entry at offset ${offset}.`);
    }

    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > centralEnd) {
      throw new Error(
        `Central-directory fields exceed archive bounds at ${offset}.`,
      );
    }
    const name = archive
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");

    if (entries.has(name)) {
      throw new Error(`Duplicate VSIX entry: ${name}`);
    }
    entries.set(name, {
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = nextOffset;
  }

  if (offset !== centralEnd) {
    throw new Error("VSIX central-directory size does not match its entries.");
  }

  return entries;
}

function readEntry(entries, name) {
  const entry = entries.get(name);
  if (!entry) {
    throw new Error(`Missing VSIX entry: ${name}`);
  }
  if (entry.localOffset + 30 > archive.length) {
    throw new Error(`Local entry header exceeds VSIX bounds: ${name}`);
  }
  if (archive.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error(`Invalid local entry header: ${name}`);
  }

  const nameLength = archive.readUInt16LE(entry.localOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localOffset + 28);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataOffset < entry.localOffset || dataEnd > archive.length) {
    throw new Error(`Compressed data exceeds VSIX bounds: ${name}`);
  }
  const compressed = archive.subarray(dataOffset, dataEnd);
  const data =
    entry.method === 0
      ? compressed
      : entry.method === 8
        ? inflateRawSync(compressed)
        : (() => {
            throw new Error(
              `Unsupported compression method ${entry.method}: ${name}`,
            );
          })();

  if (data.length !== entry.uncompressedSize) {
    throw new Error(`Uncompressed size mismatch: ${name}`);
  }
  return data;
}

const entries = readEntries();
const expected = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/changelog.md",
  "extension/README.ja.md",
  "extension/LICENSE.txt",
  "extension/images/icon.png",
  "extension/images/sessions-activity.svg",
  "extension/l10n/bundle.l10n.ja.json",
  "extension/out/src/copy-session.js",
  "extension/out/src/extension.js",
  "extension/out/src/session-alias-store.js",
  "extension/out/src/session-index.js",
  "extension/out/src/session-model.js",
  "extension/out/src/session-scanner.js",
  "extension/out/src/session-tree-model.js",
  "extension/out/src/session-tree.js",
  "extension/out/src/status-presentation.js",
  "extension/out/src/visible-refresh.js",
  "extension/package.json",
  "extension/package.nls.ja.json",
  "extension/package.nls.json",
  "extension/readme.md",
].sort();
const actual = [...entries.keys()].sort();

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  const missing = expected.filter((name) => !entries.has(name));
  const unexpected = actual.filter((name) => !expected.includes(name));
  throw new Error(
    `VSIX payload mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`,
  );
}

const packagedManifest = JSON.parse(
  readEntry(entries, "extension/package.json").toString("utf8"),
);
if (
  packagedManifest.name !== sourceManifest.name ||
  packagedManifest.version !== sourceManifest.version
) {
  throw new Error(
    "Packaged manifest name/version does not match the source manifest.",
  );
}
if (packagedManifest.icon !== "images/icon.png") {
  throw new Error("Packaged manifest icon path is incorrect.");
}
if (packagedManifest.preview !== true) {
  throw new Error("Packaged extension must remain marked as preview.");
}
if (
  packagedManifest.contributes.configuration.properties[
    "agShowSessionId.enabled"
  ].scope !== "machine"
) {
  throw new Error("Packaged opt-in setting must remain machine-scoped.");
}
if (
  packagedManifest.contributes.configuration.properties[
    "agShowSessionId.readTitles"
  ].default !== false ||
  packagedManifest.contributes.configuration.properties[
    "agShowSessionId.readTitles"
  ].scope !== "machine"
) {
  throw new Error(
    "Packaged title metadata opt-in must default off and remain machine-scoped.",
  );
}
if (packagedManifest.enabledApiProposals !== undefined) {
  throw new Error(
    "Proposed APIs must not be enabled in this stable extension.",
  );
}

const englishReadme = readEntry(entries, "extension/readme.md").toString(
  "utf8",
);
const japaneseReadme = readEntry(entries, "extension/README.ja.md").toString(
  "utf8",
);
if (!/href="[^"]*README\.ja\.md"/.test(englishReadme)) {
  throw new Error(
    "English README does not link to the packaged Japanese README.",
  );
}
if (!/href="[^"]*README\.md"/.test(japaneseReadme)) {
  throw new Error(
    "Japanese README does not link to the packaged English README.",
  );
}

const icon = readEntry(entries, "extension/images/icon.png");
if (
  icon.length < 24 ||
  icon.readUInt32BE(16) !== 128 ||
  icon.readUInt32BE(20) !== 128
) {
  throw new Error("Packaged icon must be a 128x128 PNG.");
}

process.stdout.write(
  `Verified ${path.relative(root, vsixPath)} (${entries.size} exact entries).\n`,
);
