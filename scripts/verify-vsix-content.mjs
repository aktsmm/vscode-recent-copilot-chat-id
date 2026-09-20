import { isDeepStrictEqual } from "node:util";

export function verifyVsixContent(
  sourceManifest,
  packagedManifest,
  entries,
  readSource,
) {
  for (const key of [
    "name",
    "version",
    "publisher",
    "engines",
    "main",
    "icon",
    "l10n",
    "extensionKind",
    "activationEvents",
    "capabilities",
    "enabledApiProposals",
    "contributes",
    "preview",
  ]) {
    if (!isDeepStrictEqual(packagedManifest[key], sourceManifest[key])) {
      throw new Error(`Packaged manifest field differs from source: ${key}`);
    }
  }
  for (const [name, contents] of entries) {
    if (
      name.startsWith("extension/out/src/") ||
      name.startsWith("extension/l10n/") ||
      name.startsWith("extension/images/") ||
      /^extension\/package\.nls(?:\.[\w-]+)?\.json$/.test(name)
    ) {
      const sourcePath = name.slice("extension/".length);
      if (!contents.equals(readSource(sourcePath))) {
        throw new Error(`Packaged content differs from source: ${name}`);
      }
    }
  }
}
