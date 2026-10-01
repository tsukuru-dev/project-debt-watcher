import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture, configFilename } from "../helpers/config-fixture.mjs";
import { npmFixture } from "../helpers/setup-fixture.mjs";

test("copying aborts if either repository changes branch while confirmation is open", async (t) => {
  for (const global of [false, true]) {
    const f = fixture(t), repo = f.repository();
    const repositoryConfig = f.writeConfig(repo, { fresh: 42 });
    const personalConfig = f.writeConfig(f.personalDirectory, { fresh: 73 });
    f.git(repo, ["add", configFilename]);
    f.git(repo, ["commit", "--quiet", "-m", "shared configuration"]);
    f.git(repo, ["branch", "other"]);
    const files = [repositoryConfig, personalConfig];
    const before = files.map((file) => readFileSync(file, "utf8"));
    const args = global ? ["--global", "config", "--copy-from", "repo"] : ["config", "--copy-from", "global"];
    const result = await f.invoke(args, repo, { ...f.env, CI: "" }, { interactive: true,
      confirm: async () => { f.git(repo, ["checkout", "--quiet", "other"]); return true; } });
    assert.equal(result.status, 1, "A different branch with identical config bytes still needs a fresh command");
    assert.match(result.stderr, /checkout changed/i);
    assert.deepEqual(files.map((file) => readFileSync(file, "utf8")), before);
  }
});

test("copying aborts if the source is edited during confirmation", async (t) => {
  for (const global of [false, true]) {
    const f = fixture(t), repo = f.repository();
    f.writeConfig(repo, { fresh: 42 });
    f.writeConfig(f.personalDirectory, { fresh: 73 });
    const destination = join(global ? f.personalDirectory : repo, configFilename);
    const before = readFileSync(destination, "utf8");
    const args = global ? ["--global", "config", "--copy-from", "repo"] : ["config", "--copy-from", "global"];
    const result = await f.invoke(args, repo, { ...f.env, CI: "" }, { interactive: true,
      confirm: async () => { f.writeConfig(global ? repo : f.personalDirectory, { fresh: 99 }); return true; } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /source.*changed/i);
    assert.equal(readFileSync(destination, "utf8"), before);
  }
});

test("team setup does not copy stale personal settings after the defaults choice", async (t) => {
  const f = fixture(t), repo = f.repository();
  f.writeConfig(f.personalDirectory, { fresh: 42 });
  const npm = npmFixture(repo);
  const result = await f.invoke(["init"], repo, { ...f.env, CI: "" }, { interactive: true,
    confirm: async () => true,
    chooseDefaults: async () => { f.writeConfig(f.personalDirectory, { fresh: 99 }); return "personal"; },
  }, npm);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /personal.*changed/i);
  assert.deepEqual(readdirSync(repo), [".git"]);
  assert.equal(npm.calls.length, 0);
});

test("setup rejects a linked node_modules/.bin directory before npm can write outside the repo", async (t) => {
  const f = fixture(t), repo = f.repository();
  const external = join(f.root, "external-bin");
  mkdirSync(external);
  mkdirSync(join(repo, "node_modules"));
  symlinkSync(external, join(repo, "node_modules", ".bin"), process.platform === "win32" ? "junction" : "dir");
  const npm = npmFixture(repo);
  let questions = 0;
  const result = await f.invoke(["init"], repo, { ...f.env, CI: "" }, { interactive: true,
    confirm: async () => { questions++; return true; },
  }, npm);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /node_modules[\\/]\.bin.*not a regular directory/i);
  assert.equal(questions, 0);
  assert.equal(npm.calls.length, 0);
  assert.deepEqual(readdirSync(external), []);
});

test("setup reports an ignored .gitignore that teammates would not receive", async (t) => {
  const f = fixture(t), repo = f.repository();
  mkdirSync(join(repo, ".git", "info"), { recursive: true });
  writeFileSync(join(repo, ".git", "info", "exclude"), ".gitignore\n");
  const result = await f.invoke(["init", "--dry-run"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\.gitignore matches ignore rule/);
  assert.deepEqual(readdirSync(repo), [".git"]);
});
