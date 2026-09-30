import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { configFilename, fixture, listedSettings, template } from "../helpers/config-fixture.mjs";

test("lists complete saved settings and markers, preserving file content and repository state", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const configPath = f.writeConfig(repo, { markers: ["TO DO", "FIXME"], metadata: { team: "tools" } });
  const before = readFileSync(configPath, "utf8");
  const statusBefore = f.git(repo, ["status", "--porcelain"]);
  const result = await f.invoke(["config", "--list"], repo);
  assert.equal(result.stdout.split("\n")[0], `Configuration: ${configPath}`);
  assert.deepEqual(listedSettings(result), { ...template, markers: ["TO DO", "FIXME"], metadata: { team: "tools" } });
  const markers = await f.invoke(["config", "--list", "markers"], repo);
  assert.equal(markers.status, 0, markers.stderr);
  assert.equal(markers.stdout, `Configuration: ${configPath}\nTO DO\nFIXME\n`);
  assert.equal(readFileSync(configPath, "utf8"), before);
  assert.equal(f.git(repo, ["status", "--porcelain"]), statusBefore);
  assert.deepEqual(readdirSync(repo).sort(), [".git", configFilename].sort());
  assert.deepEqual(readdirSync(f.home), []);
});

test("reads the root config from nested folders and picks up uncommitted edits on the next invocation", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo);
  const nested = join(repo, "src", "nested");
  f.writeConfig(nested, { fresh: 99 });
  assert.equal(listedSettings(await f.invoke(["config", "--list"], nested)).fresh, 30);
  f.writeConfig(repo, { fresh: 15 });
  assert.equal(listedSettings(await f.invoke(["config", "--list"], nested)).fresh, 15);
});

test("--repo is resolved against the invocation folder and ignores inherited Git repository overrides", async (t) => {
  const f = fixture(t);
  const first = f.repository("first");
  const second = f.repository("second repo");
  const firstConfig = f.writeConfig(first, { fresh: 15 });
  f.writeConfig(second, { fresh: 45 });
  const before = readFileSync(firstConfig, "utf8");
  const env = { ...f.env, GIT_DIR: join(first, ".git"), GIT_WORK_TREE: first };
  const result = await f.invoke(["config", "--list", "--repo", relative(first, second)], first, env);
  assert.equal(listedSettings(result).fresh, 45);
  assert.ok(result.stdout.includes(join(second, configFilename)));
  assert.equal(readFileSync(firstConfig, "utf8"), before);
  assert.equal(env.GIT_DIR, join(first, ".git"), "Do not mutate the caller's environment");
});

test("personal settings can be listed outside a repository without Git on PATH", async (t) => {
  const f = fixture(t);
  const configPath = f.writeConfig(f.personalDirectory, { fresh: 15 });
  const before = readFileSync(configPath, "utf8");
  const env = { ...f.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") env[key] = "";
  const result = await f.invoke(["--global", "config", "--list"], f.root, env);
  assert.equal(listedSettings(result).fresh, 15);
  assert.ok(result.stdout.includes(configPath));
  assert.equal(readFileSync(configPath, "utf8"), before);
});

test("repository settings stay independent of personal defaults", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo, { fresh: 30, showAuthors: false });
  f.writeConfig(f.personalDirectory, { fresh: 15, showAuthors: true });
  const result = listedSettings(await f.invoke(["config", "--list"], repo));
  assert.equal(result.fresh, 30);
  assert.equal(result.showAuthors, false);
});

test("missing repository config fails without creating files or falling back to personal defaults", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(f.personalDirectory);
  const result = await f.invoke(["config", "--list"], repo);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing repository configuration/);
  assert.ok(result.stderr.includes(join(repo, configFilename)));
  assert.deepEqual(readdirSync(repo), [".git"]);
});

test("listing missing personal defaults fails without initialising them", async (t) => {
  const f = fixture(t);
  const before = readdirSync(f.home);
  const result = await f.invoke(["--global", "config", "--list"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing personal configuration/);
  assert.ok(result.stderr.includes(join(f.personalDirectory, configFilename)));
  assert.deepEqual(readdirSync(f.home), before);
});

test("invalid saved settings include the file path and stay untouched", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const configPath = f.writeConfig(repo, { fresh: "30", showAuthors: "false" });
  f.writeConfig(f.personalDirectory);
  const before = readFileSync(configPath, "utf8");
  const result = await f.invoke(["config", "--list"], repo);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(configPath));
  assert.match(result.stderr, /fresh must/);
  assert.match(result.stderr, /showAuthors must/);
  assert.equal(readFileSync(configPath, "utf8"), before);
});

test("malformed JSON is reported and a UTF-8 BOM is accepted without rewriting the file", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const configPath = join(repo, configFilename);
  writeFileSync(configPath, '{ "fresh": 30, }');
  const invalid = await f.invoke(["config", "--list"], repo);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid JSON/);
  assert.ok(invalid.stderr.includes(configPath));
  const bom = "\uFEFF" + JSON.stringify(template);
  writeFileSync(configPath, bom);
  assert.deepEqual(listedSettings(await f.invoke(["config", "--list"], repo)), template);
  assert.equal(readFileSync(configPath, "utf8"), bom);
});

test("a directory in place of the config produces a file error", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  mkdirSync(join(repo, configFilename));
  const result = await f.invoke(["config", "--list"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot read configuration/);
});

test("list selectors handle settings, automatic bands, empty markers, and unknown keys", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo, { markers: [] });
  for (const [key, expected] of [["fresh", "30"], ["includeFresh", "false"],
    ["ageing", "(not set; automatic age bands)"], ["markers", "(no markers configured)"]]) {
    const result = await f.invoke(["config", "--list", key], repo);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.endsWith(`${expected}\n`));
  }
  const invalid = await f.invoke(["config", "--list", "include_fresh"], repo);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown configuration key/);
});

test("invalid repository paths and non-worktrees produce useful errors", async (t) => {
  const f = fixture(t);
  const file = join(f.root, "file.txt");
  writeFileSync(file, "text");
  for (const [path, expected] of [[join(f.root, "absent"), /Cannot access repository path/],
    [file, /must be a directory/], [f.root, /Cannot resolve a Git working tree/]]) {
    const result = await f.invoke(["config", "--list", "--repo", path]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.ok(result.stderr.includes(path));
  }
  const bare = join(f.root, "bare.git");
  f.git(f.root, ["init", "--bare", "--quiet", "--template=", bare]);
  const result = await f.invoke(["config", "--list", "--repo", bare]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /working tree/);
});

test("branch changes select the active file; listing never checks out a branch or borrows a missing config", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo);
  f.git(repo, ["add", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "Default config"]);
  f.git(repo, ["switch", "--quiet", "-c", "stricter"]);
  f.writeConfig(repo, { fresh: 15 });
  f.git(repo, ["commit", "--quiet", "-am", "Stricter config"]);

  for (const [branch, fresh] of [["main", 30], ["stricter", 15]]) {
    f.git(repo, ["switch", "--quiet", branch]);
    const head = f.git(repo, ["rev-parse", "HEAD"]);
    assert.equal(listedSettings(await f.invoke(["config", "--list"], repo)).fresh, fresh);
    assert.equal(f.git(repo, ["branch", "--show-current"]), branch);
    assert.equal(f.git(repo, ["rev-parse", "HEAD"]), head);
    assert.equal(f.git(repo, ["status", "--porcelain"]), "");
  }
  f.git(repo, ["switch", "--quiet", "-c", "without-config"]);
  f.git(repo, ["rm", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "Remove config on this branch"]);
  const result = await f.invoke(["config", "--list"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing repository configuration/);
  assert.equal(f.git(repo, ["branch", "--show-current"]), "without-config");
});

test("linked Git worktrees read their own checkout configuration", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo);
  f.git(repo, ["add", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "Initial config"]);
  const worktree = join(f.root, "linked worktree");
  f.git(repo, ["worktree", "add", "--quiet", "-b", "linked", worktree]);
  f.writeConfig(worktree, { fresh: 15 });
  const before = f.git(worktree, ["status", "--porcelain"]);
  assert.equal(listedSettings(await f.invoke(["config", "--list"], repo)).fresh, 30);
  assert.equal(listedSettings(await f.invoke(["config", "--list"], worktree)).fresh, 15);
  assert.equal(f.git(worktree, ["status", "--porcelain"]), before);
});
