import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { configFilename, fixture, template } from "../helpers/config-fixture.mjs";
import { runNpm } from "../../dist/setup/npm.js";
import { npmFixture, materialise } from "../helpers/setup-fixture.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const packageVersion = read(fileURLToPath(new URL("../../package.json", import.meta.url))).version;
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const interactive = (f) => ({ ...f.env, CI: "" });
const yes = { interactive: true, confirm: async () => true };

test("declining setup or script replacement makes no changes and never installs", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const npm = npmFixture(repo);
  const cancelled = await f.invoke(["init"], repo, interactive(f),
    { interactive: true, confirm: async () => false }, npm);
  assert.equal(cancelled.status, 1);
  assert.match(cancelled.stderr, /cancelled/);
  assert.deepEqual(readdirSync(repo), [".git"]);
  write(join(repo, "package.json"), { scripts: { "debt-watcher": "custom" } });
  const before = readFileSync(join(repo, "package.json"), "utf8");
  let asked = 0;
  const conflict = await f.invoke(["init"], repo, interactive(f),
    { interactive: true, confirm: async () => ++asked === 1 }, npm);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /Script replacement declined/);
  assert.equal(asked, 2);
  assert.equal(readFileSync(join(repo, "package.json"), "utf8"), before);
  assert.equal(npm.calls.length, 0);
  assert.deepEqual(readdirSync(f.home), []);
});

test("CI refuses changes; dry-run needs neither confirmation nor npm", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const forbidden = { npm: async () => assert.fail("Must not call npm") };
  const fail = await f.invoke(["init"], repo, f.env, { interactive: true, confirm: async () => assert.fail("No CI prompt") }, forbidden);
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /interactive terminal/);
  const preview = await f.invoke(["init", "--dry-run"], repo, f.env, undefined, forbidden);
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(readdirSync(repo), [".git"]);
});

test("setup preserves existing settings and fields and asks separately about a conflicting script", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const config = f.writeConfig(repo, { fresh: 90, metadata: { team: "tools" } });
  const originalConfig = readFileSync(config, "utf8");
  write(join(repo, "package.json"), { name: "consumer", private: false, custom: { keep: true },
    scripts: { "debt-watcher": "custom", test: "keep this" }, devDependencies: { other: "^2.0.0" } });
  writeFileSync(join(repo, ".gitignore"), "dist/\r\nlogs/");
  let asked = 0;
  const npm = npmFixture(repo);
  const result = await f.invoke(["init"], repo, interactive(f),
    { interactive: true, confirm: async () => { asked++; return true; } }, npm);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(asked, 2);
  assert.equal(readFileSync(config, "utf8"), originalConfig);
  assert.deepEqual(read(join(repo, "package.json")), { name: "consumer", private: false, custom: { keep: true },
    scripts: { "debt-watcher": "debt-watcher", test: "keep this" },
    devDependencies: { other: "^2.0.0", "debt-watcher": "^1.2.3" } });
  assert.equal(readFileSync(join(repo, ".gitignore"), "utf8"), "dist/\r\nlogs/\r\nnode_modules/\r\n");
  assert.equal(f.git(repo, ["diff", "--cached"]), "");
  assert.deepEqual(readdirSync(f.home), []);
});

test("compatible production dependencies are retained and reused for script/config repair", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const pkg = { name: "consumer", dependencies: { "debt-watcher": "^1.2.3" } };
  write(join(repo, "package.json"), pkg);
  materialise(repo, pkg);
  const lockBefore = readFileSync(join(repo, "package-lock.json"), "utf8");
  const npm = npmFixture(repo);
  const result = await f.invoke(["init"], repo, interactive(f), yes, npm);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Keep Debt Watcher in dependencies/);
  assert.equal(npm.calls.some(([command]) => command === "install"), false);
  assert.equal(read(join(repo, "package.json")).devDependencies, undefined);
  assert.equal(readFileSync(join(repo, "package-lock.json"), "utf8"), lockBefore);
  assert.deepEqual(read(join(repo, configFilename)), template);
});

test("complete setup is a no-op, including in CI, and lockfile drift triggers repair", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const pkg = { scripts: { "debt-watcher": "debt-watcher" }, devDependencies: { "debt-watcher": "^1.2.3" } };
  write(join(repo, "package.json"), pkg);
  materialise(repo, pkg);
  f.writeConfig(repo);
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  const files = ["package.json", "package-lock.json", ".gitignore", configFilename];
  const before = files.map((name) => readFileSync(join(repo, name), "utf8"));
  const npm = npmFixture(repo);
  const first = await f.invoke(["init"], repo, f.env, { confirm: async () => assert.fail("No-op must not prompt") }, npm);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /already complete/);
  assert.deepEqual(files.map((name) => readFileSync(join(repo, name), "utf8")), before);
  const lock = read(join(repo, "package-lock.json"));
  lock.packages[""].devDependencies["debt-watcher"] = "^0.1.0";
  write(join(repo, "package-lock.json"), lock);
  const repaired = await f.invoke(["init"], repo, interactive(f), yes, npm);
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(npm.calls.filter(([command]) => command === "install").length, 1);
  assert.equal(read(join(repo, "package-lock.json")).packages[""].devDependencies["debt-watcher"], "^1.2.3");
  let invalidLockedTree = true;
  const lockedTreeRepair = await f.invoke(["init"], repo, interactive(f), yes, {
    ...npm, npm: async (args, context) => {
      if (invalidLockedTree && args.includes("--package-lock-only")) {
        return { code: 1, stdout: "{}", stderr: "Invalid transitive dependency in lockfile" };
      }
      if (args[0] === "install") invalidLockedTree = false;
      return npm.npm(args, context);
    },
  });
  assert.equal(lockedTreeRepair.status, 0, lockedTreeRepair.stderr);
  assert.equal(npm.calls.filter(([command]) => command === "install").length, 2);
});

test("failed npm installation reports partial state and a later run can complete it", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const failed = await f.invoke(["init"], repo, interactive(f), yes, npmFixture(repo, { fail: true }));
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Simulated registry failure/);
  assert.match(failed.stderr, /Setup is incomplete/);
  assert.equal(existsSync(join(repo, configFilename)), false);
  assert.equal(read(join(repo, "package.json")).private, true);
  const retried = await f.invoke(["init"], repo, interactive(f), yes, npmFixture(repo));
  assert.equal(retried.status, 0, retried.stderr);
  assert.deepEqual(read(join(repo, configFilename)), template);
});

test("edits or branch changes during confirmation abort before setup writes", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  write(join(repo, "package.json"), { private: false });
  f.git(repo, ["add", "package.json"]);
  f.git(repo, ["commit", "--quiet", "-m", "Initial"]);
  const npm = npmFixture(repo);
  const edited = await f.invoke(["init"], repo, interactive(f),
    { interactive: true, confirm: async () => { write(join(repo, "package.json"), { private: false, note: "user edit" }); return true; } }, npm);
  assert.equal(edited.status, 1);
  assert.match(edited.stderr, /File changed during setup/);
  assert.equal(read(join(repo, "package.json")).note, "user edit");
  const switched = await f.invoke(["init"], repo, interactive(f),
    { interactive: true, confirm: async () => { f.git(repo, ["switch", "--quiet", "-c", "another"]); return true; } }, npm);
  assert.equal(switched.status, 1);
  assert.match(switched.stderr, /checkout changed/);
  assert.equal(npm.calls.length, 0);
  assert.equal(existsSync(join(repo, configFilename)), false);
});

test("invalid configs, ignored shared files and other package managers block apply without prompts", async (t) => {
  const f = fixture(t);
  for (const [name, prepare] of [
    ["invalid", (repo) => f.writeConfig(repo, { fresh: "bad" })],
    ["ignored", (repo) => writeFileSync(join(repo, ".gitignore"), "*.json\n")],
    ["pnpm", (repo) => writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9\n")],
  ]) {
    const repo = f.repository(name);
    prepare(repo);
    const before = readdirSync(repo).sort();
    const result = await f.invoke(["init"], repo, interactive(f),
      { interactive: true, confirm: async () => assert.fail("Blocked setup must not prompt") },
      { npm: async () => assert.fail("Blocked setup must not run npm") });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Resolve these setup items/);
    assert.deepEqual(readdirSync(repo).sort(), before);
  }
});

test("the unpublished development build never tries a new registry installation", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const result = await f.invoke(["init"], repo, interactive(f),
    { interactive: true, confirm: async () => assert.fail("Cannot approve an unavailable installation") },
    { npm: async () => assert.fail("No registry call") });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /has not been released/);
  assert.deepEqual(readdirSync(repo), [".git"]);
});

test("real npm installs the local archive, generates the lock, exposes the CLI and reuses it on repeat", async (t) => {
  const f = fixture(t);
  const repo = f.repository("consumer with spaces");
  const project = fileURLToPath(new URL("../../", import.meta.url));
  assert.ok(process.env.npm_execpath);
  const packed = spawnSync(process.execPath, [process.env.npm_execpath, "pack", "--json",
    "--offline", "--ignore-scripts", "--pack-destination", f.root], {
    cwd: project, env: { ...f.env, npm_config_update_notifier: "false", npm_config_logs_max: "0" },
    encoding: "utf8", windowsHide: true, timeout: 60_000,
  });
  assert.ifError(packed.error);
  assert.equal(packed.status, 0, packed.stderr);
  const archive = join(f.root, JSON.parse(packed.stdout)[0].filename);
  const env = { ...interactive(f), npm_config_offline: "true" };
  const calls = [];
  const setup = { packageSpec: archive, npm: async (args, context) => {
    calls.push([...args]);
    return runNpm(args, context);
  } };
  const result = await f.invoke(["init", "--repo", repo], f.root, env, yes, setup);
  assert.equal(result.status, 0, result.stderr);
  const pkg = read(join(repo, "package.json"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts["debt-watcher"], "debt-watcher");
  assert.ok(pkg.devDependencies["debt-watcher"]);
  assert.deepEqual(read(join(repo, configFilename)), template);
  assert.ok(read(join(repo, "package-lock.json")).packages["node_modules/debt-watcher"]);
  assert.equal(f.git(repo, ["check-ignore", "node_modules/"]), "node_modules/");
  assert.equal(f.git(repo, ["diff", "--cached"]), "");
  const version = spawnSync(process.execPath, [process.env.npm_execpath, "run", "--silent",
    "debt-watcher", "--", "--version"], { cwd: repo, env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.ifError(version.error);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), packageVersion);
  const before = ["package.json", "package-lock.json", ".gitignore", configFilename]
    .map((name) => readFileSync(join(repo, name), "utf8"));
  const second = await f.invoke(["init"], repo, env,
    { interactive: true, confirm: async () => assert.fail("Complete setup must not prompt") }, setup);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already complete/);
  assert.equal(calls.filter(([command]) => command === "install").length, 1);
  assert.deepEqual(["package.json", "package-lock.json", ".gitignore", configFilename]
    .map((name) => readFileSync(join(repo, name), "utf8")), before);

  const teammate = f.repository("teammate");
  for (const name of ["package.json", "package-lock.json", configFilename]) {
    copyFileSync(join(repo, name), join(teammate, name));
  }
  const ci = await runNpm(["ci", "--offline"], { cwd: teammate, env });
  assert.equal(ci.code, 0, ci.stderr);
  assert.equal(read(join(teammate, "node_modules", "debt-watcher", "package.json")).version, packageVersion);
  assert.deepEqual(read(join(teammate, configFilename)), template);

  const existing = f.repository("existing npm project");
  const marker = join(existing, "lifecycle-ran.txt");
  write(join(existing, "package.json"), { name: "existing", private: false,
    scripts: { preinstall: "node lifecycle.cjs", test: "keep-me" } });
  writeFileSync(join(existing, "lifecycle.cjs"), 'require("node:fs").writeFileSync("lifecycle-ran.txt", "ran");');
  const existingResult = await f.invoke(["init"], existing, env, yes, setup);
  assert.equal(existingResult.status, 0, existingResult.stderr);
  assert.equal(existsSync(marker), false, "Setup must not run the consuming project's install hooks");
  assert.equal(read(join(existing, "package.json")).private, false);
  assert.equal(read(join(existing, "package.json")).scripts.test, "keep-me");
});

test("config-only repair preserves read-only package and ignore files", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const pkg = { scripts: { "debt-watcher": "debt-watcher" }, devDependencies: { "debt-watcher": "^1.2.3" } };
  write(join(repo, "package.json"), pkg);
  materialise(repo, pkg);
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  for (const name of ["package.json", ".gitignore"]) chmodSync(join(repo, name), 0o444);
  try {
    const result = await f.invoke(["init"], repo, interactive(f), yes, npmFixture(repo));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(read(join(repo, configFilename)), template);
  } finally {
    for (const name of ["package.json", ".gitignore"]) chmodSync(join(repo, name), 0o644);
  }
});

test("Windows npm shim path conflicts are reported before applying setup", { skip: process.platform !== "win32" }, async (t) => {
  const f = fixture(t);
  const repo = f.repository("consumer & data");
  const result = await f.invoke(["init"], repo, interactive(f),
    { interactive: true, confirm: async () => assert.fail("No prompt before resolving a path conflict") }, npmFixture(repo));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /npm-generated command shims/);
  assert.deepEqual(readdirSync(repo), [".git"]);
});

test("npm reporting success without a usable installation is not reported as complete", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const result = await f.invoke(["init"], repo, interactive(f), yes,
    { packageSpec: "debt-watcher@1.2.3", npm: async () => ({ code: 0, stdout: "{}", stderr: "" }) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verification failed/);
  assert.equal(result.stdout.includes("Team setup complete"), false);
  assert.equal(existsSync(join(repo, configFilename)), false);
});

test("a read-only package that needs changing fails before any setup files are written", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const path = join(repo, "package.json");
  write(path, { private: false });
  const before = readFileSync(path, "utf8");
  chmodSync(path, 0o444);
  const npm = npmFixture(repo);
  try {
    const result = await f.invoke(["init"], repo, interactive(f), yes, npm);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /read-only/);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(readdirSync(repo).sort(), [".git", "package.json"]);
    assert.equal(npm.calls.length, 0);
  } finally { chmodSync(path, 0o644); }
});
