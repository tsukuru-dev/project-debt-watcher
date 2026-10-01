import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { inspectSetup } from "../../dist/setup/inspect.js";
import { configFilename, fixture } from "../helpers/config-fixture.mjs";

function json(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + "\n"); }
function manifest(repo, changes = {}) {
  json(join(repo, "package.json"), { name: "consumer", private: false,
    scripts: { "debt-watcher": "debt-watcher", build: "do-not-execute" },
    devDependencies: { "debt-watcher": "^1.2.3" }, ...changes });
}
function installed(repo) {
  const directory = join(repo, "node_modules", "debt-watcher");
  mkdirSync(directory, { recursive: true });
  json(join(directory, "package.json"), { name: "debt-watcher", version: "1.2.3" });
}
function complete(f, repo) {
  f.writeConfig(repo);
  manifest(repo);
  installed(repo);
  json(join(repo, "package-lock.json"), { lockfileVersion: 3,
    packages: { "": { devDependencies: { "debt-watcher": "^1.2.3" } },
      "node_modules/debt-watcher": { version: "1.2.3", dev: true } } });
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
}
async function inspect(f, repo) {
  return inspectSetup(undefined, { cwd: repo, env: f.env });
}
const item = (result, id) => {
  const found = result.items.find((entry) => entry.id === id);
  assert.ok(found, id);
  return found;
};

test("init previews a non-Node repository without changing files, Git state, or personal settings", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  writeFileSync(join(repo, "main.py"), "print('hello')\n");
  const before = readdirSync(repo).sort();
  const result = await f.invoke(["init"], repo, f.env, {
    interactive: true,
    confirm: async () => assert.fail("Inspection must not prompt"),
    openEditor: async () => assert.fail("Inspection must not open an editor"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Read-only preview/);
  assert.match(result.stdout, /fresh: 30 days/);
  assert.match(result.stdout, /private.*true/);
  assert.match(result.stdout, /local development dependency/);
  assert.match(result.stdout, /Add npm script/);
  assert.match(result.stdout, /Create the repository .gitignore/);
  assert.match(result.stdout, /Applying setup is not implemented/);
  assert.deepEqual(readdirSync(repo).sort(), before);
  assert.deepEqual(readdirSync(f.home), []);
  assert.equal(f.git(repo, ["diff", "--cached"]), "");
});

test("existing setup entries are preserved and inspection is repeatable", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  complete(f, repo);
  const paths = [configFilename, "package.json", "package-lock.json", ".gitignore"];
  const before = paths.map((path) => readFileSync(join(repo, path), "utf8"));
  const first = await inspect(f, repo);
  assert.ok(first.items.every((entry) => entry.status === "present"), JSON.stringify(first));
  assert.deepEqual(await inspect(f, repo), first);
  const result = await f.invoke(["init"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not a compatibility check/);
  assert.deepEqual(paths.map((path) => readFileSync(join(repo, path), "utf8")), before);
  assert.deepEqual(readdirSync(f.home), []);
});

test("declared dependencies are distinguished from missing local installations and lockfiles", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  manifest(repo);
  const result = await inspect(f, repo);
  assert.equal(item(result, "dependency").status, "present");
  assert.equal(item(result, "installation").status, "missing");
  assert.equal(item(result, "lockfile").status, "missing");
});

test("conflicting scripts and existing dependency classifications require review without replacement", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  manifest(repo, { scripts: { "debt-watcher": "custom-script", test: "keep-me" },
    devDependencies: {}, dependencies: { "debt-watcher": "^1.2.3" } });
  const before = readFileSync(join(repo, "package.json"), "utf8");
  const result = await inspect(f, repo);
  assert.equal(item(result, "script").status, "conflict");
  assert.equal(item(result, "dependency").status, "review");
  const cli = await f.invoke(["init"], repo);
  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /Ask before replacing/);
  assert.match(cli.stderr, /requiring review/);
  assert.equal(readFileSync(join(repo, "package.json"), "utf8"), before);
});

test("invalid configuration, manifest and lockfile are all reported and preserved", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo, { fresh: "bad" });
  writeFileSync(join(repo, "package.json"), "{bad json");
  writeFileSync(join(repo, "package-lock.json"), "[]");
  const paths = [configFilename, "package.json", "package-lock.json"];
  const before = paths.map((path) => readFileSync(join(repo, path), "utf8"));
  const result = await inspect(f, repo);
  for (const id of ["config", "package", "lockfile"]) assert.equal(item(result, id).status, "conflict");
  assert.equal(result.items.some((entry) => entry.id === "script"), false, "Do not propose script edits from an unreadable manifest");
  assert.deepEqual(paths.map((path) => readFileSync(join(repo, path), "utf8")), before);
});

test("Git evaluates negated rules, ignored shared files, and the matching rule source", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  writeFileSync(join(repo, ".gitignore"), "*.json\n!debt-watcher.config.json\nnode_modules/\n");
  const result = await inspect(f, repo);
  assert.equal(item(result, "tracking-" + configFilename).status, "present");
  assert.equal(item(result, "tracking-package.json").status, "review");
  assert.match(item(result, "tracking-package.json").message, /\.gitignore:1/);
  assert.equal(item(result, "ignore-node_modules").status, "present");
});

test("machine-only ignore rules still need a shared node_modules rule", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  mkdirSync(join(repo, ".git", "info"), { recursive: true });
  writeFileSync(join(repo, ".git", "info", "exclude"), "node_modules/\n");
  const result = await inspect(f, repo);
  assert.equal(item(result, "ignore-node_modules").status, "missing");
  assert.match(item(result, "ignore-node_modules").message, /ignored only by/);
  assert.deepEqual(readdirSync(repo), [".git"]);
});

test("tracked node_modules and ignored-but-tracked config are reported without changing the index", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo);
  installed(repo);
  f.git(repo, ["add", configFilename, "node_modules"]);
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n" + configFilename + "\n");
  const before = f.git(repo, ["ls-files", "--stage"]);
  const result = await inspect(f, repo);
  assert.equal(item(result, "tracked-node_modules").status, "conflict");
  assert.equal(item(result, "tracking-" + configFilename).status, "review");
  assert.match(item(result, "tracking-" + configFilename).message, /already tracked/);
  assert.equal(f.git(repo, ["ls-files", "--stage"]), before);
});

test("--repo and nested invocations select the intended checkout despite inherited Git overrides", async (t) => {
  const f = fixture(t);
  const first = f.repository("first");
  const second = f.repository("second repo");
  complete(f, second);
  const nested = join(second, "src");
  mkdirSync(nested);
  const env = { ...f.env, GIT_DIR: join(first, ".git"), GIT_WORK_TREE: first };
  const result = await f.invoke(["init", "--repo", relative(first, nested)], first, env);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith("Setup inspection: " + second));
  assert.match(result.stdout, /Keep the existing valid shared configuration/);
  assert.deepEqual(readdirSync(first), [".git"]);
});

test("linked worktree inspection uses its own active configuration and does not switch branches", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo);
  f.git(repo, ["add", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "Config"]);
  const linked = join(f.root, "linked");
  f.git(repo, ["worktree", "add", "--quiet", "-b", "other", linked]);
  f.writeConfig(linked, { fresh: "bad" });
  assert.equal(item(await inspect(f, repo), "config").status, "present");
  assert.equal(item(await inspect(f, linked), "config").status, "conflict");
  assert.equal(f.git(linked, ["branch", "--show-current"]), "other");
  assert.equal(f.git(linked, ["diff", "--cached"]), "");
});

test("manifest field errors, workspace workflows, shrinkwrap and self-installation are visible", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  manifest(repo, { scripts: [] });
  assert.equal(item(await inspect(f, repo), "package").status, "conflict");
  manifest(repo, { name: "debt-watcher", workspaces: ["packages/*"], packageManager: "pnpm@9.0.0" });
  json(join(repo, "npm-shrinkwrap.json"), { lockfileVersion: 3 });
  const result = await inspect(f, repo);
  assert.equal(item(result, "package-workflow").status, "review");
  assert.equal(item(result, "package-self").status, "conflict");
  assert.equal(item(result, "shrinkwrap").status, "review");
});

test("directory conflicts and lockfiles missing Debt Watcher are not treated as ready", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  mkdirSync(join(repo, configFilename));
  json(join(repo, "package-lock.json"), { lockfileVersion: 3, packages: {} });
  const result = await inspect(f, repo);
  assert.equal(item(result, "config").status, "conflict");
  assert.equal(item(result, "lockfile").status, "missing");
});
