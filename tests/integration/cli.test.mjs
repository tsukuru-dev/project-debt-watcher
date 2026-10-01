import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

test("compiled CLI works outside a Git repository and creates no user or project files", () => {
  const directory = mkdtempSync(join(tmpdir(), "debt-watcher-cli-"));
  try {
    const env = { ...process.env, CI: "true", HOME: directory, USERPROFILE: directory,
      APPDATA: directory, LOCALAPPDATA: directory, XDG_CONFIG_HOME: directory,
      XDG_CACHE_HOME: directory, XDG_STATE_HOME: directory };
    const cases = [
      [[], 0, /Usage: debt-watcher/],
      [["--help"], 0, /graveyard/],
      [["--version"], 0, manifest.version],
      [["graveyard", "--help"], 0, /--summary/],
      [["--global", "config", "--help"], 0, /--copy-from/],
      [["init", "--help"], 0, /--repo/],
      [["graveyard", "--save", "--summary", "blame"], 1, /Cannot resolve a Git working tree/],
      [["config", "--list"], 1, /Cannot resolve a Git working tree/],
      [["--global", "config"], 1, /Cannot open an editor in non-interactive use/],
      [["init"], 1, /Cannot resolve a Git working tree/],
      [["not-a-command"], 1, /unknown command/],
    ];
    for (const [args, status, expected] of cases) {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: directory, env, encoding: "utf8" });
      assert.ifError(result.error);
      assert.equal(result.status, status, `${args.join(" ")}: ${result.stderr}`);
      const output = status === 0 ? result.stdout : result.stderr;
      if (typeof expected === "string") assert.equal(output.trim(), expected);
      else assert.match(output, expected);
      assert.equal(status === 0 ? result.stderr : result.stdout, "");
      assert.deepEqual(readdirSync(directory), [], "CLI must not write setup, config, or cache files yet");
    }
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("debt-watcher-cli-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
