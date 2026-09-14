import { describe, expect, it } from "vitest";

import cargoToml from "../../src-tauri/Cargo.toml?raw";
import tauriConf from "../../src-tauri/tauri.conf.json";
import pkg from "../../package.json";
import changelog from "../../CHANGELOG.md?raw";

/**
 * The version lives in package.json; everything else must agree with it, or a
 * release would ship with a mismatched About box, bundle name or Cargo metadata.
 * `npm run version:set -- <version>` keeps them together.
 */
describe("the app version", () => {
  it("is plain semver", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it("is read by Tauri from package.json rather than repeated", () => {
    expect(tauriConf.version).toBe("../package.json");
  });

  it("matches Cargo.toml", () => {
    const cargoVersion = /\[package\][^[]*?\nversion\s*=\s*"([^"]+)"/.exec(cargoToml)?.[1];
    expect(cargoVersion).toBe(pkg.version);
  });

  it("has a changelog entry", () => {
    expect(changelog).toContain(`## [${pkg.version}]`);
  });
});
