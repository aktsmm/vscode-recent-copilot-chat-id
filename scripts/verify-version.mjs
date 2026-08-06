import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function verifyVersion(root, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Package version must be stable semver: ${version}`);
  }

  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const escapedVersion = version.replaceAll(".", "\\.");
  const heading = new RegExp(
    `^## ${escapedVersion} - (Unreleased|(\\d{4})-(\\d{2})-(\\d{2}))$`,
    "m",
  );
  const match = changelog.match(heading);
  if (!match) {
    throw new Error(
      `CHANGELOG.md must contain an entry for package version ${version}.`,
    );
  }
  if (match[1] !== "Unreleased") {
    const year = Number(match[2]);
    const month = Number(match[3]);
    const day = Number(match[4]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error(`CHANGELOG.md has an invalid release date: ${match[1]}.`);
    }
  }

  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (inside !== "true") {
      throw new Error("not a work tree");
    }
  } catch {
    throw new Error(
      "Git repository verification failed. Package from the cloned repository.",
    );
  }

  const tag = `v${version}`;
  let tagExists = false;
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`],
      { cwd: root, stdio: "ignore" },
    );
    tagExists = true;
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("status" in error) ||
      error.status !== 1
    ) {
      throw new Error(`Git tag verification failed for ${tag}.`);
    }
  }

  if (tagExists) {
    throw new Error(
      `Package version ${version} is already tagged as ${tag}. Bump the version before packaging new source.`,
    );
  }
}

function main() {
  const manifest = JSON.parse(
    readFileSync(path.join(defaultRoot, "package.json"), "utf8"),
  );
  verifyVersion(defaultRoot, manifest.version);
  process.stdout.write(
    `Version ${manifest.version} is available for packaging.\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
