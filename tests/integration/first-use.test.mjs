import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runCli } from "../../dist/program.js";
import { setupDeclined, setupStatePath } from "../../dist/storage/setup-state.js";
import { isGlobalInstallation } from "../../dist/setup/installation.js";
import { configFilename, fixture, template } from "../helpers/config-fixture.mjs";
import { materialise, npmFixture } from "../helpers/setup-fixture.mjs";

const { metadata: _templateNotes, ...templateSettings } = template;
const { ageing: _ageing, buried: _buried, ...automaticSettings } = templateSettings;

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const forbidden = async () => assert.fail("Unexpected prompt, editor or npm invocation");

function harness(f, repo, overrides = {}) {
  const calls = { reports: [], editors: [], prompts: [] };
  const setup = npmFixture(repo);
  const options = { version: "1.2.3", cwd: repo, env: { ...f.env, CI: "" }, homeDirectory: f.home, setup,
    terminal: { interactive: true, confirm: async (q) => { calls.prompts.push(q); return true; },
      openEditor: async (path) => { calls.editors.push(path); }, chooseDefaults: forbidden },
    report: async (args, prepared) => { calls.reports.push({ args, prepared }); }, ...overrides };
  async function invoke(args, extra = {}) {
    let stdout = "", stderr = "";
    const status = await runCli(args, { ...options, ...extra,
      stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
    return { status, stdout, stderr };
  }
  return { invoke, calls, setup, options };
}

function complete(f, repo, production = false) {
  f.writeConfig(repo);
  const pkg = { private: true, scripts: { "debt-finder": "debt-finder" },
    [production ? "dependencies" : "devDependencies"]: { "debt-finder": "^1.2.3" } };
  writeFileSync(join(repo, "package.json"), JSON.stringify(pkg));
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  materialise(repo, pkg);
}

test("accepted first use creates team setup, opens config, and resumes exact report options", async (t) => {
  const f = fixture(t), repo = f.repository();
  const h = harness(f, repo);
  const result = await h.invoke(["graveyard", "--save", "--summary", "blame", "--fresh", "60", "--filter", "includefresh=true"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(join(repo, configFilename)), template);
  assert.equal(read(join(repo, "package.json")).scripts["debt-finder"], "debt-finder");
  assert.deepEqual(h.calls.editors, [join(repo, configFilename)]);
  assert.equal(h.calls.prompts.length, 1);
  assert.deepEqual(h.calls.reports[0].args, { save: true, summary: "blame", fresh: 60, filter: { includeFresh: true } });
  assert.equal(h.calls.reports[0].prepared.configuration.fresh, 30);
  assert.equal(h.calls.reports[0].prepared.location.repositoryRoot, repo);
  assert.equal(h.setup.calls.filter(([c]) => c === "install").length, 1);
  assert.deepEqual(readdirSync(f.home), []);
});

test("personal defaults are copied as settings only and do not continuously override the repo", async (t) => {
  const f = fixture(t), repo = f.repository();
  const personal = f.writeConfig(f.personalDirectory, { fresh: 65, markers: ["TO DO"], metadata: { private: "keep here" }, $schema: "personal-schema" });
  const h = harness(f, repo);
  const terminal = { ...h.options.terminal, chooseDefaults: async (path) => {
    assert.equal(path, personal); return "personal";
  } };
  assert.equal((await h.invoke(["init"], { terminal })).status, 0);
  assert.deepEqual(read(join(repo, configFilename)), { ...automaticSettings, fresh: 65, markers: ["TO DO"] });
  f.writeConfig(f.personalDirectory, { fresh: 99 });
  const result = await h.invoke(["graveyard"], { terminal: { interactive: true, confirm: forbidden, openEditor: forbidden, chooseDefaults: forbidden } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(h.calls.reports[0].prepared.configuration.fresh, 65);
});

test("template choice bypasses malformed personal defaults; copying them preserves files on error", async (t) => {
  const f = fixture(t), repo = f.repository();
  const personal = f.writeConfig(f.personalDirectory);
  writeFileSync(personal, "invalid personal json");
  const h = harness(f, repo);
  const copy = await h.invoke(["init"], { terminal: { ...h.options.terminal, chooseDefaults: async () => "personal" } });
  assert.equal(copy.status, 1);
  assert.match(copy.stderr, /Invalid JSON/);
  assert.deepEqual(readdirSync(repo), [".git"]);
  const result = await h.invoke(["init"], { terminal: { ...h.options.terminal, chooseDefaults: async () => "template" } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(join(repo, configFilename)), template);
  assert.equal(readFileSync(personal, "utf8"), "invalid personal json");
});

test("declining missing-config setup is remembered per repo; explicit init retries and clears it", async (t) => {
  const f = fixture(t), repo = f.repository();
  const h = harness(f, repo);
  const result = await h.invoke(["graveyard"], { terminal: { interactive: true, confirm: async () => false, openEditor: forbidden } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Report cancelled/);
  assert.equal(await setupDeclined(repo, { env: f.env, homeDirectory: f.home }), true);
  assert.deepEqual(readdirSync(repo), [".git"]);
  assert.equal(h.calls.reports.length, 0);
  assert.equal(h.setup.calls.length, 0);
  const again = await h.invoke(["graveyard"], { terminal: { interactive: true, confirm: forbidden } });
  assert.match(again.stderr, /Run debt-finder init/);
  assert.equal(await setupDeclined(f.repository("other"), { env: f.env, homeDirectory: f.home }), false);
  const retried = await h.invoke(["init"]);
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(await setupDeclined(repo, { env: f.env, homeDirectory: f.home }), false);
});

test("declining integration repair still reports with existing config and does not prompt next time", async (t) => {
  const f = fixture(t), repo = f.repository();
  const path = f.writeConfig(repo, { fresh: 44 });
  const before = readFileSync(path, "utf8");
  const h = harness(f, repo);
  const first = await h.invoke(["graveyard"], { terminal: { interactive: true, confirm: async () => false } });
  assert.equal(first.status, 0, first.stderr);
  const next = await h.invoke(["graveyard"], { terminal: { interactive: true, confirm: forbidden } });
  assert.equal(next.status, 0, next.stderr);
  assert.equal(h.calls.reports.length, 2);
  assert.equal(h.calls.reports[1].prepared.configuration.fresh, 44);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(existsSync(join(repo, "package.json")), false);
});

test("cancelling defaults selection or script replacement writes no project files and remembers the offer", async (t) => {
  for (const action of ["selection", "script"]) {
    const f = fixture(t), repo = f.repository(action);
    const h = harness(f, repo);
    f.writeConfig(f.personalDirectory);
    if (action === "script") writeFileSync(join(repo, "package.json"), '{"scripts":{"debt-finder":"custom"}}');
    let questions = 0;
    const result = await h.invoke(["graveyard"], { terminal: { interactive: true,
      confirm: async () => action === "selection" || ++questions === 1,
      chooseDefaults: async () => undefined, openEditor: forbidden } });
    assert.equal(result.status, 1);
    assert.equal(existsSync(join(repo, configFilename)), false);
    assert.equal(existsSync(join(repo, "node_modules")), false);
    assert.equal(await setupDeclined(repo, { env: f.env, homeDirectory: f.home }), true);
    if (action === "script") assert.equal(read(join(repo, "package.json")).scripts["debt-finder"], "custom");
  }
});

test("existing config is preserved during repair without consulting personal defaults", async (t) => {
  const f = fixture(t), repo = f.repository();
  const path = f.writeConfig(repo, { fresh: 87, metadata: { team: "shared" } });
  const original = readFileSync(path, "utf8");
  const personal = f.writeConfig(f.personalDirectory);
  writeFileSync(personal, "bad json");
  const h = harness(f, repo);
  const result = await h.invoke(["graveyard"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path, "utf8"), original);
  assert.equal(h.calls.reports[0].prepared.configuration.fresh, 87);
});

test("CI and piped reports require saved config and never initialise, prompt, install, or open", async (t) => {
  for (const envCI of ["true", ""]) {
    const f = fixture(t), repo = f.repository();
    const h = harness(f, repo, { env: { ...f.env, CI: envCI },
      terminal: { interactive: envCI === "true", confirm: forbidden, openEditor: forbidden },
      isGlobalInstallation: forbidden, setup: { npm: forbidden } });
    const missing = await h.invoke(["graveyard"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Missing repository configuration/);
    assert.deepEqual(readdirSync(repo), [".git"]);
    f.writeConfig(repo, { fresh: 51 });
    const configured = await h.invoke(["graveyard"]);
    assert.equal(configured.status, 0, configured.stderr);
    assert.equal(h.calls.reports[0].prepared.configuration.fresh, 51);
    assert.deepEqual(readdirSync(f.home), []);
  }
});

test("complete setups, including production dependencies, go straight to reporting", async (t) => {
  for (const production of [false, true]) {
    const f = fixture(t), repo = f.repository();
    complete(f, repo, production);
    const h = harness(f, repo, { terminal: { interactive: true, confirm: forbidden, openEditor: forbidden } });
    const result = await h.invoke(["graveyard"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(h.calls.reports.length, 1);
    assert.deepEqual(h.setup.calls.map(([command]) => command), ["ls", "ls"]);
  }
});

test("automatic repair verifies executable and lockfile integrity before continuing the report", async (t) => {
  for (const defect of ["executable", "lockfile", "npm-tree"]) {
    const f = fixture(t), repo = f.repository();
    complete(f, repo);
    const original = readFileSync(join(repo, configFilename), "utf8");
    if (defect === "executable") {
      const path = join(repo, "node_modules", "debt-finder", "package.json");
      writeFileSync(path, JSON.stringify({ ...read(path), bin: { "debt-finder": "missing.js" } }));
    } else if (defect === "lockfile") {
      const path = join(repo, "package-lock.json"), lock = read(path);
      lock.packages["node_modules/debt-finder"].version = "0.9.0";
      writeFileSync(path, JSON.stringify(lock));
    }
    const h = harness(f, repo);
    let installed = false;
    const npm = async (args, context) => {
      if (defect === "npm-tree" && args[0] === "ls" && !installed) {
        return { code: 1, stdout: "{}", stderr: "Invalid dependency tree" };
      }
      const result = await h.setup.npm(args, context);
      if (args[0] === "install") installed = true;
      return result;
    };
    const result = await h.invoke(["graveyard", "--summary"], { setup: { ...h.setup, npm } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(h.calls.prompts.length, 1, defect);
    assert.equal(installed, true, defect);
    assert.deepEqual(h.calls.reports[0].args, { summary: "types" });
    assert.equal(readFileSync(join(repo, configFilename), "utf8"), original);
  }
});

test("declined executable repair is remembered and valid configuration still reports", async (t) => {
  const f = fixture(t), repo = f.repository();
  complete(f, repo);
  const path = join(repo, "node_modules", "debt-finder", "package.json");
  writeFileSync(path, JSON.stringify({ ...read(path), bin: { "debt-finder": "missing.js" } }));
  const h = harness(f, repo);
  const first = await h.invoke(["graveyard"], { terminal: { interactive: true, confirm: async () => false } });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(await setupDeclined(repo, { env: f.env, homeDirectory: f.home }), true);
  const next = await h.invoke(["graveyard"], { terminal: { interactive: true, confirm: forbidden }, setup: { npm: forbidden } });
  assert.equal(next.status, 0, next.stderr);
  assert.equal(h.calls.reports.length, 2);
  assert.equal(h.setup.calls.length, 0);
});

test("unavailable installation verification does not block a configured report", async (t) => {
  const f = fixture(t), repo = f.repository();
  complete(f, repo);
  const h = harness(f, repo, { terminal: { interactive: true, confirm: forbidden, openEditor: forbidden },
    setup: { npm: async () => { throw new Error("Cannot locate npm"); } } });
  const result = await h.invoke(["graveyard"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Could not verify team installation/);
  assert.equal(h.calls.reports.length, 1);
});

test("invalid repository config is preserved and blocks setup/reporting", async (t) => {
  const f = fixture(t), repo = f.repository();
  writeFileSync(join(repo, configFilename), "invalid");
  const h = harness(f, repo, { terminal: { interactive: true, confirm: forbidden, openEditor: forbidden } });
  const result = await h.invoke(["graveyard"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid JSON/);
  assert.equal(h.calls.reports.length, 0);
  assert.equal(readFileSync(join(repo, configFilename), "utf8"), "invalid");
});

test("unavailable verification during script repair permits reporting but explicit init still fails", async (t) => {
  const f = fixture(t), repo = f.repository();
  complete(f, repo);
  const packagePath = join(repo, "package.json"), pkg = read(packagePath);
  delete pkg.scripts["debt-finder"];
  writeFileSync(packagePath, JSON.stringify(pkg));
  const files = ["package.json", "package-lock.json", ".gitignore", configFilename];
  const before = files.map((name) => readFileSync(join(repo, name), "utf8"));
  const h = harness(f, repo, { terminal: { interactive: true, confirm: forbidden, openEditor: forbidden },
    setup: { npm: async () => { throw new Error("Cannot locate npm"); } } });
  const result = await h.invoke(["graveyard", "--summary"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Could not verify team installation: Cannot locate npm/);
  assert.deepEqual(h.calls.reports[0].args, { summary: "types" });
  assert.deepEqual(h.calls.reports[0].prepared.configuration, template);
  assert.deepEqual(files.map((name) => readFileSync(join(repo, name), "utf8")), before);
  assert.deepEqual(readdirSync(f.home), []);

  const init = await h.invoke(["init"]);
  assert.equal(init.status, 1);
  assert.match(init.stderr, /Cannot locate npm/);
  assert.equal(h.calls.reports.length, 1);
  assert.deepEqual(files.map((name) => readFileSync(join(repo, name), "utf8")), before);
});

test("verification errors after setup writes still block reporting with valid config", async (t) => {
  const f = fixture(t), repo = f.repository();
  complete(f, repo);
  const packagePath = join(repo, "package.json"), pkg = read(packagePath);
  delete pkg.scripts["debt-finder"];
  writeFileSync(packagePath, JSON.stringify(pkg));
  const h = harness(f, repo);
  let checks = 0;
  const result = await h.invoke(["graveyard"], { setup: { npm: async (args, context) => {
    if (++checks > 2) throw new Error("Cannot locate npm");
    return h.setup.npm(args, context);
  } } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Setup is incomplete/);
  assert.equal(read(packagePath).scripts["debt-finder"], "debt-finder");
  assert.equal(h.calls.reports.length, 0);
  assert.equal(h.calls.editors.length, 0);
  assert.deepEqual(readdirSync(f.home), []);
});

test("editor failure preserves successful setup and continues reporting with a manual path", async (t) => {
  const f = fixture(t), repo = f.repository();
  const h = harness(f, repo);
  const result = await h.invoke(["graveyard"], { terminal: { ...h.options.terminal,
    openEditor: async () => { throw new Error("No editor available"); } } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Setup is complete, but the editor could not open/);
  assert.ok(result.stdout.includes(join(repo, configFilename)));
  assert.equal(h.calls.reports.length, 1);
});

test("setup failure does not run the report or editor and is not remembered as a decline", async (t) => {
  const f = fixture(t), repo = f.repository();
  const h = harness(f, repo, { setup: npmFixture(repo, { fail: true }) });
  const result = await h.invoke(["graveyard"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Setup is incomplete/);
  assert.equal(h.calls.reports.length, 0);
  assert.equal(h.calls.editors.length, 0);
  assert.equal(await setupDeclined(repo, { env: f.env, homeDirectory: f.home }), false);
});

test("--repo targets the selected worktree and reads its config again after setup/editor", async (t) => {
  const f = fixture(t), current = f.repository("current"), target = f.repository("target");
  f.writeConfig(current, { fresh: 99 });
  const h = harness(f, target, { cwd: current });
  const result = await h.invoke(["graveyard", "--repo", "../target"], { terminal: { ...h.options.terminal,
    openEditor: async (path) => { assert.equal(path, join(target, configFilename)); f.writeConfig(target, { fresh: 42 }); } } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(h.calls.reports[0].prepared.configuration.fresh, 42);
  assert.equal(h.calls.reports[0].prepared.location.repositoryRoot, target);
  assert.equal(read(join(current, configFilename)).fresh, 99);
  assert.equal(existsSync(join(current, "package.json")), false);
});

test("personal defaults are created on normal global use only, and existing preferences are kept", async (t) => {
  const f = fixture(t), repo = f.repository();
  complete(f, repo);
  const h = harness(f, repo, { isGlobalInstallation: async () => true });
  const first = await h.invoke(["graveyard"]);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(read(join(f.personalDirectory, configFilename)), template);
  f.writeConfig(f.personalDirectory, { fresh: 99 });
  assert.equal((await h.invoke(["graveyard"])).status, 0);
  assert.equal(read(join(f.personalDirectory, configFilename)).fresh, 99);
  assert.equal(h.calls.reports[1].prepared.configuration.fresh, 30);
});

test("help, version, dry-run, listing, failed validation and snapshot export do not initialise personal defaults", async (t) => {
  const f = fixture(t), repo = f.repository();
  let detections = 0;
  const h = harness(f, repo, { isGlobalInstallation: async () => { detections++; return true; } });
  for (const args of [[], ["--help"], ["--version"], ["init", "--help"], ["graveyard", "--help"], ["init", "--dry-run"],
    ["config", "--list"], ["--global", "config", "--list"], ["config", "--set", "fresh=bad"], ["graveyard", "--fresh", "bad"],
    ["config", "--copy-from", "global"], ["graveyard", "--save", "latest"]]) {
    await h.invoke(args);
    assert.deepEqual(readdirSync(f.home), [], args.join(" "));
    assert.deepEqual(readdirSync(repo), [".git"]);
  }
  assert.deepEqual(h.calls.reports, [{ args: { save: "latest" }, prepared: undefined }]);
  assert.equal(detections, 0);
});

test("global installation detection distinguishes local/cache/development copies and custom npm prefixes", async (t) => {
  const f = fixture(t);
  const globalRoot = join(f.root, "custom-prefix", "node_modules");
  const globalPackage = join(globalRoot, "debt-finder");
  const localPackage = join(f.root, "local", "node_modules", "debt-finder");
  const cachePackage = join(f.root, "cache", "_npx", "hash", "node_modules", "debt-finder");
  for (const path of [globalPackage, localPackage, cachePackage]) mkdirSync(path, { recursive: true });
  const context = { cwd: f.root, env: f.env };
  assert.equal(await isGlobalInstallation(globalPackage, context, async () => globalRoot), true);
  for (const path of [localPackage, cachePackage]) assert.equal(await isGlobalInstallation(path, context, async () => globalRoot), false);
  assert.equal(await isGlobalInstallation(f.root, context, forbidden), false);
  assert.equal(await isGlobalInstallation(globalPackage, context, async () => { throw new Error("npm absent"); }), false);
});

test("absolute personal report directories require agreement before they enter team config", async (t) => {
  const f = fixture(t), repo = f.repository();
  const reportDirectory = join(f.root, "personal-reports");
  f.writeConfig(f.personalDirectory, { reportDirectory });
  const h = harness(f, repo);
  let asks = 0;
  const result = await h.invoke(["init"], { terminal: { ...h.options.terminal,
    chooseDefaults: async () => "personal", confirm: async () => ++asks === 1 } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /absolute reportDirectory/);
  assert.equal(asks, 2);
  assert.deepEqual(readdirSync(repo), [".git"]);
  assert.equal(existsSync(reportDirectory), false);
});

test("a corrupt decline file is reported without preventing repair", async (t) => {
  const f = fixture(t), repo = f.repository();
  const path = setupStatePath(repo, { env: f.env, homeDirectory: f.home });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "bad state");
  const h = harness(f, repo);
  const result = await h.invoke(["graveyard"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Cannot read saved setup decision/);
  assert.equal(await setupDeclined(repo, { env: f.env, homeDirectory: f.home }), false);
});

test("reports read active branch settings and worktrees keep separate declined offers", async (t) => {
  const f = fixture(t), repo = f.repository();
  f.writeConfig(repo, { fresh: 31 });
  f.git(repo, ["add", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "main config"]);
  f.git(repo, ["checkout", "--quiet", "-b", "different"]);
  f.writeConfig(repo, { fresh: 72 });
  f.git(repo, ["add", configFilename]);
  f.git(repo, ["commit", "--quiet", "-m", "branch config"]);
  const h = harness(f, repo);
  const declined = { terminal: { interactive: true, confirm: async () => false, openEditor: forbidden } };
  assert.equal((await h.invoke(["graveyard"], declined)).status, 0);
  assert.equal(h.calls.reports[0].prepared.configuration.fresh, 72);
  f.git(repo, ["checkout", "--quiet", "main"]);
  assert.equal((await h.invoke(["graveyard"], { terminal: { interactive: true, confirm: forbidden } })).status, 0);
  assert.equal(h.calls.reports[1].prepared.configuration.fresh, 31);
  const worktree = join(f.root, "linked");
  f.git(repo, ["worktree", "add", "--quiet", worktree, "different"]);
  assert.equal(await setupDeclined(worktree, { env: f.env, homeDirectory: f.home }), false);
  const other = harness(f, worktree);
  let prompted = 0;
  const result = await other.invoke(["graveyard"], { terminal: { interactive: true,
    confirm: async () => { prompted++; return false; }, openEditor: forbidden } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(prompted, 1);
  assert.equal(other.calls.reports[0].prepared.configuration.fresh, 72);
  assert.equal(f.git(repo, ["branch", "--show-current"]), "main");
});

test("personal initialisation failure and unsupported integration do not block a valid report", async (t) => {
  const f = fixture(t), repo = f.repository();
  complete(f, repo);
  mkdirSync(f.personalDirectory, { recursive: true });
  mkdirSync(join(f.personalDirectory, configFilename));
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const h = harness(f, repo, { isGlobalInstallation: async () => true,
    terminal: { interactive: true, confirm: forbidden, openEditor: forbidden }, setup: { npm: forbidden } });
  const result = await h.invoke(["graveyard"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Could not initialise personal defaults/);
  assert.match(result.stdout, /manual attention/);
  assert.equal(h.calls.reports.length, 1);
});
