import assert from "node:assert/strict";
import { test } from "node:test";
import { userConfigDirectory } from "../../dist/storage/paths.js";
import { resolveConfigurationLocation } from "../../dist/config/paths.js";

const cases = [
  ["Windows roaming profile", { platform: "win32", homeDirectory: "C:\\Users\\alex", env: { APPDATA: "D:\\Settings" } }, "D:\\Settings\\debt-finder"],
  ["Windows fallback", { platform: "win32", homeDirectory: "C:\\Users\\alex", env: {} }, "C:\\Users\\alex\\AppData\\Roaming\\debt-finder"],
  ["relative Windows base is ignored", { platform: "win32", homeDirectory: "C:\\Users\\alex", env: { APPDATA: "relative" } }, "C:\\Users\\alex\\AppData\\Roaming\\debt-finder"],
  ["macOS", { platform: "darwin", homeDirectory: "/Users/alex", env: {} }, "/Users/alex/Library/Application Support/debt-finder"],
  ["Linux XDG", { platform: "linux", homeDirectory: "/home/alex", env: { XDG_CONFIG_HOME: "/settings" } }, "/settings/debt-finder"],
  ["Linux fallback", { platform: "linux", homeDirectory: "/home/alex", env: {} }, "/home/alex/.config/debt-finder"],
  ["relative XDG base is ignored", { platform: "linux", homeDirectory: "/home/alex", env: { XDG_CONFIG_HOME: "relative" } }, "/home/alex/.config/debt-finder"],
];

for (const [name, options, expected] of cases) {
  test(`personal config path: ${name}`, () => {
    assert.equal(userConfigDirectory(options), expected);
  });
}

test("personal configuration resolution needs neither Git nor a working directory", async () => {
  const location = await resolveConfigurationLocation({ global: true }, {
    platform: "linux", homeDirectory: "/home/alex", cwd: "/does-not-exist", env: {},
  });
  assert.deepEqual(location, { scope: "global", path: "/home/alex/.config/debt-finder/debt-finder.config.json" });
});
