import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { configFilename, fixture, template } from "../helpers/config-fixture.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const interactiveEnv = (f) => ({ ...f.env, CI: "" });
const terminal = (overrides = {}) => ({
  interactive: true,
  confirm: async () => { assert.fail("Unexpected confirmation"); },
  openEditor: async () => { assert.fail("Unexpected editor launch"); },
  ...overrides,
});

test("repository-to-personal copy validates first, creates only settings, and respects --repo", async (t) => {
  const f = fixture(t);
  const repo = f.repository("source repo");
  const source = f.writeConfig(repo, { fresh: 45, markers: ["TO DO"], metadata: { privateNote: "stay here" } });
  const before = readFileSync(source, "utf8");
  const destination = join(f.personalDirectory, configFilename);
  const result = await f.invoke(["--global", "config", "--copy-from", "repo",
    "--repo", relative(f.root, repo)]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(source));
  assert.ok(result.stdout.includes(destination));
  assert.deepEqual(read(destination), { ...template, fresh: 45, markers: ["TO DO"] });
  assert.equal(readFileSync(source, "utf8"), before);
  assert.deepEqual(readdirSync(repo).sort(), [".git", configFilename].sort());
  assert.deepEqual(readdirSync(f.personalDirectory), [configFilename]);
  f.writeConfig(repo, { fresh: 90 });
  assert.equal(read(destination).fresh, 45, "Copied settings must not continuously inherit");
});

test("explicit personal-to-repository copy can create a missing config without package integration", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const source = f.writeConfig(f.personalDirectory, { fresh: 60, reportDirectory: "./shared reports" });
  const before = readFileSync(source, "utf8");
  const result = await f.invoke(["config", "--copy-from", "global", "--repo", repo]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(join(repo, configFilename)), { ...template, fresh: 60, reportDirectory: "./shared reports" });
  assert.deepEqual(readdirSync(repo).sort(), [".git", configFilename].sort());
  assert.equal(readFileSync(source, "utf8"), before);
  assert.equal(existsSync(join(repo, "shared reports")), false);
});

test("confirmed copy replaces lists and custom bands but preserves destination metadata", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const source = f.writeConfig(f.personalDirectory, { markers: ["TO DO"], metadata: { secret: "never transfer" } });
  const path = f.writeConfig(repo, { ageing: 60, buried: 120, fossil: 365,
    $schema: "./team-schema.json", metadata: { team: "tools" } });
  const beforeSource = readFileSync(source, "utf8");
  let asked = 0;
  const result = await f.invoke(["config", "--copy-from", "global"], repo, interactiveEnv(f),
    terminal({ confirm: async (question) => {
      asked++;
      assert.ok(question.includes(path));
      assert.equal(read(path).ageing, 60, "No writes before consent");
      return true;
    } }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(asked, 1);
  assert.deepEqual(read(path), { ...template, markers: ["TO DO"], $schema: "./team-schema.json", metadata: { team: "tools" } });
  assert.equal(readFileSync(source, "utf8"), beforeSource);
});

test("declining replacement and non-interactive replacement both preserve destination bytes", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo, { fresh: 60 });
  const path = f.writeConfig(f.personalDirectory);
  const before = readFileSync(path, "utf8");
  const args = ["--global", "config", "--copy-from", "repo"];
  const cancelled = await f.invoke(args, repo, interactiveEnv(f), terminal({ confirm: async () => false }));
  assert.equal(cancelled.status, 1);
  assert.match(cancelled.stderr, /cancelled/);
  const ci = await f.invoke(args, repo, f.env, terminal());
  assert.equal(ci.status, 1);
  assert.match(ci.stderr, /requires confirmation/);
  const piped = await f.invoke(args, repo, interactiveEnv(f), { interactive: false });
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /requires confirmation/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.deepEqual(readdirSync(f.personalDirectory), [configFilename]);
});

test("matching settings are a no-op even when source metadata differs", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo, { metadata: { local: true } });
  const path = f.writeConfig(f.personalDirectory, { metadata: { personal: true } });
  const before = readFileSync(path, "utf8");
  const modified = statSync(path).mtimeMs;
  const result = await f.invoke(["--global", "config", "--copy-from", "repo"], repo, f.env, terminal());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No changes/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(statSync(path).mtimeMs, modified);
});

test("missing or invalid sources never manufacture defaults or touch the destination", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const path = f.writeConfig(repo);
  const before = readFileSync(path, "utf8");
  const missing = await f.invoke(["config", "--copy-from", "global"], repo);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing personal configuration/);
  assert.deepEqual(readdirSync(f.home), []);
  writeFileSync(path, "{broken JSON");
  const invalid = await f.invoke(["--global", "config", "--copy-from", "repo"], repo);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid JSON/);
  assert.deepEqual(readdirSync(f.home), []);
  writeFileSync(path, before);
  f.writeConfig(f.personalDirectory, { fresh: "30" });
  const invalidPersonal = await f.invoke(["config", "--copy-from", "global"], repo);
  assert.equal(invalidPersonal.status, 1);
  assert.match(invalidPersonal.stderr, /fresh must/);
  assert.equal(readFileSync(path, "utf8"), before);
});

test("an invalid destination is reported and preserved before prompting", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo);
  const path = f.writeConfig(f.personalDirectory, { fresh: "invalid" });
  const before = readFileSync(path, "utf8");
  const result = await f.invoke(["--global", "config", "--copy-from", "repo"], repo,
    interactiveEnv(f), terminal());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fresh must/);
  assert.equal(readFileSync(path, "utf8"), before);
});

test("absolute report paths are explained and preserved without creating directories", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const reportDirectory = join(f.root, "machine-specific reports");
  f.writeConfig(repo, { reportDirectory });
  const path = f.writeConfig(f.personalDirectory);
  const result = await f.invoke(["--global", "config", "--copy-from", "repo"], repo,
    interactiveEnv(f), terminal({ confirm: async () => true }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /absolute reportDirectory may be specific to this machine/);
  assert.equal(read(path).reportDirectory, reportDirectory);
  assert.equal(existsSync(reportDirectory), false);
});

test("changes made during confirmation are not overwritten", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  f.writeConfig(repo, { fresh: 60 });
  const path = f.writeConfig(f.personalDirectory);
  const result = await f.invoke(["--global", "config", "--copy-from", "repo"], repo,
    interactiveEnv(f), terminal({ confirm: async () => {
      f.writeConfig(f.personalDirectory, { fresh: 90 });
      return true;
    } }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /changed while editing/);
  assert.equal(read(path).fresh, 90);
});

test("copies affect only the selected linked worktree, never its index or HEAD", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const main = f.writeConfig(repo);
  f.git(repo, ["add", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "Initial config"]);
  const worktree = join(f.root, "linked");
  f.git(repo, ["worktree", "add", "--quiet", "-b", "linked", worktree]);
  const head = f.git(worktree, ["rev-parse", "HEAD"]);
  f.writeConfig(f.personalDirectory, { fresh: 60 });
  const result = await f.invoke(["config", "--copy-from", "global", "--repo", worktree],
    repo, interactiveEnv(f), terminal({ confirm: async () => true }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(main).fresh, 30);
  assert.equal(read(join(worktree, configFilename)).fresh, 60);
  assert.equal(f.git(repo, ["status", "--porcelain"]), "");
  assert.equal(f.git(worktree, ["diff", "--cached"]), "");
  assert.equal(f.git(worktree, ["rev-parse", "HEAD"]), head);
});

test("opening selects the root config from a nested invocation and leaves it untouched", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const path = f.writeConfig(repo);
  const before = readFileSync(path, "utf8");
  const nested = join(repo, "src");
  mkdirSync(nested);
  let opened;
  const result = await f.invoke(["config"], nested, interactiveEnv(f),
    terminal({ openEditor: async (file) => { opened = file; } }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(opened, path);
  assert.ok(result.stdout.includes(path));
  assert.equal(readFileSync(path, "utf8"), before);
  assert.deepEqual(readdirSync(f.home), []);
});

test("explicit personal opening creates template defaults without a repository or Git", async (t) => {
  const f = fixture(t);
  const env = interactiveEnv(f);
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") env[key] = "";
  const path = join(f.personalDirectory, configFilename);
  let opened = 0;
  const options = terminal({ openEditor: async (file) => {
    opened++;
    assert.equal(file, path);
    assert.deepEqual(read(file), opened === 1 ? template : { ...template, fresh: 90 });
  } });
  const result = await f.invoke(["--global", "config"], f.root, env, options);
  assert.equal(result.status, 0, result.stderr);
  f.writeConfig(f.personalDirectory, { fresh: 90 });
  assert.equal((await f.invoke(["--global", "config"], f.root, env, options)).status, 0);
  assert.equal(opened, 2);
  assert.deepEqual(readdirSync(f.root), ["home"]);
});

test("invalid JSON opens for repair without substituting defaults", async (t) => {
  const f = fixture(t);
  const path = f.writeConfig(f.personalDirectory);
  writeFileSync(path, "{ bad json");
  const result = await f.invoke(["--global", "config"], f.root, interactiveEnv(f),
    terminal({ openEditor: async (file) => {
      assert.equal(file, path);
      assert.equal(readFileSync(file, "utf8"), "{ bad json");
    } }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Invalid JSON/);
  assert.match(result.stdout, /manual correction/);
  assert.equal(readFileSync(path, "utf8"), "{ bad json");
});

test("missing repository opening fails; non-interactive opening never creates personal defaults", async (t) => {
  const f = fixture(t);
  const repo = f.repository();
  const missing = await f.invoke(["config"], repo, interactiveEnv(f), terminal());
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing repository configuration/);
  for (const [env, options] of [[f.env, terminal()], [interactiveEnv(f), { interactive: false }]]) {
    const result = await f.invoke(["--global", "config"], repo, env, options);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /non-interactive/);
    assert.ok(result.stderr.includes(join(f.personalDirectory, configFilename)));
  }
  assert.deepEqual(readdirSync(f.home), []);
  assert.deepEqual(readdirSync(repo), [".git"]);
});

test("editor failures retain the config and display the full path for manual opening", async (t) => {
  const f = fixture(t);
  const path = join(f.personalDirectory, configFilename);
  const result = await f.invoke(["--global", "config"], f.root, interactiveEnv(f),
    terminal({ openEditor: async () => { throw new Error("Editor unavailable"); } }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Editor unavailable.*Open the configuration manually/);
  assert.ok(result.stderr.includes(path));
  assert.deepEqual(read(path), template);
});

test("the real editor launcher passes paths and flags literally to an executable", async (t) => {
  const f = fixture(t);
  const repo = f.repository("repo & literal");
  const path = f.writeConfig(repo);
  const script = join(f.root, "fake editor.mjs");
  const log = join(f.root, "editor-args.json");
  writeFileSync(script, 'import {writeFileSync} from "node:fs"; writeFileSync(process.env.EDITOR_LOG, JSON.stringify(process.argv.slice(2)));');
  const env = { ...interactiveEnv(f), VISUAL: "", EDITOR: '"' + process.execPath + '" "' + script + '" --wait',
    EDITOR_LOG: log };
  const result = await f.invoke(["config", "--repo", repo], f.root, env, { interactive: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(log), ["--wait", path]);
  assert.deepEqual(read(path), template);
});
