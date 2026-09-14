#!/usr/bin/env node
// Set the app version everywhere it is recorded, in one step.
//
//   npm run version:set -- 0.0.2
//
// `package.json` is the source of truth: `tauri.conf.json` reads its version from
// there. Cargo needs its own copy in `Cargo.toml` (and `Cargo.lock`), and npm in
// `package-lock.json`. `src/lib/version.test.ts` fails if any of them disagree.
// No dependencies, so it runs anywhere Node does.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.argv[2]?.replace(/^v/, "");

// Plain semver, optionally with a pre-release such as 0.1.0-beta.1.
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: npm run version:set -- <major.minor.patch>");
  process.exit(1);
}

function update(path, transform) {
  const file = `${root}${path}`;
  const before = readFileSync(file, "utf8");
  const after = transform(before);
  if (after === before) {
    console.error(`${path}: version field not found or already ${version}`);
  }
  writeFileSync(file, after);
}

update("package.json", (text) => text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));

// The lockfile carries the version twice: at the top, and for the root package.
update("package-lock.json", (text) => {
  const lock = JSON.parse(text);
  lock.version = version;
  if (lock.packages?.[""]) {
    lock.packages[""].version = version;
  }
  return `${JSON.stringify(lock, null, 2)}\n`;
});

// Only the [package] table's version, never a dependency's.
update("src-tauri/Cargo.toml", (text) =>
  text.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${version}$2`),
);

// Refresh Cargo.lock's entry for this crate without touching any dependency.
execFileSync("cargo", ["update", "--workspace", "--offline"], {
  cwd: `${root}src-tauri`,
  stdio: "inherit",
});

console.log(`version set to ${version}; tag the release as v${version}`);
