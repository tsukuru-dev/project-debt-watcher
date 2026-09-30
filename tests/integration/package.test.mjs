import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const project = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));

function npm(args, cwd) {
  assert.ok(process.env.npm_execpath, "Run package verification through npm test.");
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd,
    env: { ...process.env, npm_config_update_notifier: "false", npm_config_logs_max: "0" },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

test("packed CLI installs and resolves its executable offline without development dependencies", () => {
  const directory = mkdtempSync(join(tmpdir(), "debt-watcher-package-"));
  try {
    // npm test already built the CLI. Do not recurse through build lifecycle scripts here.
    const [packed] = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--offline",
      "--pack-destination", directory], project));
    const paths = packed.files.map((file) => file.path);
    assert.ok(paths.includes("dist/cli.js"));
    assert.ok(paths.includes("dist/program.js"));
    assert.ok(paths.includes("templates/debt-watcher.config.json"));
    assert.ok(!paths.some((path) => /^(src|tests|node_modules)\//.test(path)));
    assert.deepEqual(Object.keys(manifest.bin), ["debt-watcher"]);

    writeFileSync(join(directory, "package.json"), JSON.stringify({
      name: "debt-watcher-package-test", private: true,
      scripts: { "debt-watcher": "debt-watcher" },
    }));
    npm(["install", join(directory, packed.filename), "--offline", "--ignore-scripts",
      "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false"], directory);

    const version = npm(["exec", "--offline", "--", "debt-watcher", "--version"], directory);
    assert.equal(version.trim(), manifest.version);
    const help = npm(["run", "--silent", "debt-watcher", "--", "graveyard", "--help"], directory);
    assert.match(help, /Usage: debt-watcher graveyard/);
    assert.match(help, /--save/);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("debt-watcher-package-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
