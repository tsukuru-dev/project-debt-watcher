import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { readConfiguration, saveConfiguration } from "../../dist/config/store.js";
import { configFilename, fixture, listedSettings, template } from "../helpers/config-fixture.mjs";

function saved(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function success(result, path) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.includes(path));
}

test("set persists typed values and metadata in the active checkout without staging or committing", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const extra = { $schema: "./schema.json", metadata: { team: "platform", nested: { enabled: true } } };
  const path = f.writeConfig(repo, extra);
  f.git(repo, ["add", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "Shared settings"]);
  const head = f.git(repo, ["rev-parse", "HEAD"]);
  const nested = join(repo, "src", "nested");
  mkdirSync(nested, { recursive: true });
  const result = await f.invoke(["config", "--set", "fresh=45", "includeFresh=true",
    "showAuthors=false", "order=newold", "reportDirectory=./reports with spaces=latest",
    "markers=TO DO,FIXME"], nested);
  success(result, path);
  assert.deepEqual(saved(path), { ...template, ...extra, fresh: 45, includeFresh: true,
    showAuthors: false, order: "newold", reportDirectory: "./reports with spaces=latest", markers: ["TO DO", "FIXME"] });
  assert.deepEqual(listedSettings(await f.invoke(["config", "--list"], repo)), saved(path));
  assert.equal(f.git(repo, ["diff", "--cached"]), "");
  assert.equal(f.git(repo, ["rev-parse", "HEAD"]), head);
  assert.equal(f.git(repo, ["branch", "--show-current"]), "main");
  assert.equal(existsSync(join(repo, "reports with spaces=latest")), false);
  assert.deepEqual(readdirSync(f.home), []);
});

test("multiple thresholds save together and fresh alone later removes custom bands", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const path = f.writeConfig(repo, { ageing: 60, buried: 120, fossil: 365 });
  success(await f.invoke(["config", "--set", "ageing=150", "buried=200"], repo), path);
  assert.equal(saved(path).ageing, 150);
  assert.equal(saved(path).buried, 200);
  assert.equal(saved(path).fossil, 365);
  const result = await f.invoke(["config", "--set", "fresh=30"], repo);
  success(result, path);
  assert.match(result.stdout, /automatic age bands/);
  assert.deepEqual(saved(path), template);
});

test("adding, removing and replacing markers persists changes without duplicates", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const path = f.writeConfig(repo, { markers: ["TODO", "FIXME"] });
  success(await f.invoke(["config", "--add", "markers= TODO, TO DO,TO DO "], repo), path);
  assert.deepEqual(saved(path).markers, ["TODO", "FIXME", "TO DO"]);
  success(await f.invoke(["config", "--remove", "markers=FIXME,ABSENT"], repo), path);
  assert.deepEqual(saved(path).markers, ["TODO", "TO DO"]);
  success(await f.invoke(["config", "--set", "markers=TEMP,HACK"], repo), path);
  assert.deepEqual(saved(path).markers, ["TEMP", "HACK"]);
  success(await f.invoke(["config", "--remove", "markers=TEMP,HACK"], repo), path);
  assert.deepEqual(saved(path).markers, []);
});

test("no-op edits report no changes and preserve exact bytes and modification time", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const path = join(repo, configFilename);
  const source = "\uFEFF" + JSON.stringify(template, null, "\t").replaceAll("\n", "\r\n") + "\r\n";
  writeFileSync(path, source);
  const modified = statSync(path).mtimeMs;
  for (const args of [["--set", "fresh=30"], ["--add", "markers=TODO,TODO"], ["--remove", "markers=ABSENT"]]) {
    const result = await f.invoke(["config", ...args], repo);
    success(result, path);
    assert.match(result.stdout, /No changes/);
    assert.equal(readFileSync(path, "utf8"), source);
    assert.equal(statSync(path).mtimeMs, modified);
  }
  success(await f.invoke(["config", "--set", "fresh=60"], repo), path);
  assert.equal(readFileSync(path, "utf8"), source.replace('"fresh": 30', '"fresh": 60'));
});

test("rejected edits and conflicting actions leave the file and directory untouched", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const path = f.writeConfig(repo);
  const before = readFileSync(path, "utf8");
  const modified = statSync(path).mtimeMs;
  for (const args of [
    ["--set", "fresh=60", "showAuthors=perhaps"],
    ["--set", "fresh=60", "ageing=90"],
    ["--set", "ageing=120", "buried=60", "fossil=365"],
    ["--set", "fresh=60", "unknown=true"],
    ["--add", "markers=TODO,,FIXME"],
    ["--remove", "markers=// TODO"],
    ["--set", "fresh=60", "--add", "markers=NEW"],
  ]) {
    const result = await f.invoke(["config", ...args], repo);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "");
    assert.equal(readFileSync(path, "utf8"), before);
    assert.equal(statSync(path).mtimeMs, modified);
    assert.deepEqual(readdirSync(repo).sort(), [".git", configFilename].sort());
  }
});

test("explicit personal edits initialise defaults outside Git, even if the requested value matches the template", async (t) => {
  const f = fixture(t);
  const env = { ...f.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") env[key] = "";
  const path = join(f.personalDirectory, configFilename);
  const result = await f.invoke(["--global", "config", "--set", "fresh=30"], f.root, env);
  success(result, path);
  assert.match(result.stdout, /Created personal configuration/);
  assert.deepEqual(saved(path), template);
  success(await f.invoke(["--global", "config", "--add", "markers=TO DO"], f.root, env), path);
  assert.deepEqual(saved(path).markers, [...template.markers, "TO DO"]);
  success(await f.invoke(["--global", "config", "--remove", "markers=TODO"], f.root, env), path);
  assert.deepEqual(saved(path).markers, [...template.markers.filter((marker) => marker !== "TODO"), "TO DO"]);
  assert.deepEqual(readdirSync(f.personalDirectory), [configFilename]);
  assert.deepEqual(readdirSync(f.root), ["home"]);
});

test("invalid first-use personal edits do not create any configuration directories", async (t) => {
  const f = fixture(t);
  for (const args of [
    ["--set", "fresh=no"], ["--set", "ageing=60"], ["--add", "markers=TODO,"],
    ["--set", "ageing=120", "buried=60", "fossil=365"],
    ["--set", "reportDirectory=bad\0path"],
  ]) {
    const result = await f.invoke(["--global", "config", ...args]);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "");
    assert.deepEqual(readdirSync(f.home), []);
  }
});

test("editing a missing repository config neither creates one nor borrows personal settings", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const personal = f.writeConfig(f.personalDirectory, { fresh: 90 });
  const before = readFileSync(personal, "utf8");
  const result = await f.invoke(["config", "--set", "fresh=60"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing repository configuration/);
  assert.deepEqual(readdirSync(repo), [".git"]);
  assert.equal(readFileSync(personal, "utf8"), before);
});

test("invalid existing files are not replaced or silently repaired in either scope", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  for (const [directory, args] of [[repo, ["config"]], [f.personalDirectory, ["--global", "config"]]]) {
    const path = f.writeConfig(directory);
    for (const source of ["{bad json", JSON.stringify({ ...template, fresh: "30" })]) {
      writeFileSync(path, source);
      const result = await f.invoke([...args, "--set", "fresh=60"], repo);
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(path));
      assert.equal(readFileSync(path, "utf8"), source);
    }
  }
});

test("repository selection and personal edits change only their chosen configuration", async (t) => {
  const f = fixture(t);
  const first = f.repository("first");
  const second = f.repository("second repo");
  const firstPath = f.writeConfig(first);
  const secondPath = f.writeConfig(second);
  const personalPath = f.writeConfig(f.personalDirectory);
  const args = ["config", "--set", "fresh=60", "--repo", relative(first, second)];
  success(await f.invoke(args, first), secondPath);
  assert.equal(saved(firstPath).fresh, 30);
  assert.equal(saved(secondPath).fresh, 60);
  assert.equal(saved(personalPath).fresh, 30);
  success(await f.invoke(["--global", "config", "--set", "fresh=90"], first), personalPath);
  assert.equal(saved(firstPath).fresh, 30);
  assert.equal(saved(secondPath).fresh, 60);
  assert.equal(saved(personalPath).fresh, 90);
});

test("linked worktree edits use their own branch file and preserve the main checkout", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const mainPath = f.writeConfig(repo);
  f.git(repo, ["add", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "Initial config"]);
  const worktree = join(f.root, "linked worktree");
  f.git(repo, ["worktree", "add", "--quiet", "-b", "linked", worktree]);
  success(await f.invoke(["config", "--set", "fresh=60"], worktree), join(worktree, configFilename));
  assert.equal(saved(mainPath).fresh, 30);
  assert.equal(saved(join(worktree, configFilename)).fresh, 60);
  assert.equal(f.git(repo, ["status", "--porcelain"]), "");
  assert.equal(f.git(worktree, ["diff", "--cached"]), "");
  assert.equal(f.git(worktree, ["branch", "--show-current"]), "linked");
});

test("saving a stale snapshot or creating over an existing file fails without overwriting it", async (t) => {
  const f = fixture(t);
  const path = f.writeConfig(f.personalDirectory);
  const location = { scope: "global", path };
  const snapshot = await readConfiguration(location);
  f.writeConfig(f.personalDirectory, { fresh: 90 });
  const before = readFileSync(path, "utf8");
  await assert.rejects(saveConfiguration(location, { ...snapshot.document, fresh: 60 }, snapshot.source), /changed while editing/);
  await assert.rejects(saveConfiguration(location, template, null), /already exists/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.deepEqual(readdirSync(f.personalDirectory), [configFilename]);
});

test("a read-only config is preserved and saving leaves no temporary files", async (t) => {
  const f = fixture(t);
  const path = f.writeConfig(f.personalDirectory);
  const before = readFileSync(path, "utf8");
  chmodSync(path, 0o444);
  try {
    const result = await f.invoke(["--global", "config", "--set", "fresh=60"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /read-only/);
    assert.ok(result.stderr.includes(path));
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(readdirSync(f.personalDirectory), [configFilename]);
  } finally {
    chmodSync(path, 0o600);
  }
});
