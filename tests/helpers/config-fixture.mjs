import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runCli } from "../../dist/program.js";
import { userConfigDirectory } from "../../dist/storage/paths.js";

export const template = JSON.parse(readFileSync(new URL("../../templates/debt-watcher.config.json", import.meta.url), "utf8"));
export const configFilename = "debt-watcher.config.json";

export function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "debt-watcher-config-")));
  const home = join(root, "home");
  mkdirSync(home);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith("GIT_")) delete env[key];
  }
  Object.assign(env, {
    CI: "true", HOME: home, USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_STATE_HOME: join(home, ".state"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "absent-gitconfig"), GIT_TERMINAL_PROMPT: "0",
  });
  t.after(() => {
    // Only remove this test's newly created directory, never an unchecked computed path.
    assert.equal(dirname(resolve(root)), realpathSync.native(tmpdir()));
    assert.ok(basename(root).startsWith("debt-watcher-config-"));
    rmSync(root, { recursive: true, force: true });
  });

  function git(cwd, args) {
    const result = spawnSync("git", [
      "-c", "core.hooksPath=", "-c", "commit.gpgSign=false", "-c", "core.autocrlf=false",
      "-c", "user.name=Debt Watcher tests", "-c", "user.email=tests@example.invalid", ...args,
    ], { cwd, env, encoding: "utf8", windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }

  function repository(name = "repo") {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    git(directory, ["init", "--quiet", "--initial-branch=main", "--template="]);
    return directory;
  }

  function writeConfig(directory, changes = {}) {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, configFilename);
    const document = { ...template, ...changes };
    // Older fixture cases vary only fresh; omit fixed bands if that age would cross them.
    if (typeof changes.fresh === "number" && changes.fresh >= template.ageing
      && !Object.hasOwn(changes, "ageing") && !Object.hasOwn(changes, "buried")) {
      delete document.ageing;
      delete document.buried;
    }
    writeFileSync(path, JSON.stringify(document, null, 2) + "\n");
    return path;
  }

  async function invoke(args, cwd = root, environment = env, terminal, setup) {
    let stdout = "";
    let stderr = "";
    const status = await runCli(args, {
      version: "0.0.0", cwd, env: environment, homeDirectory: home,
      // Setup tests simulate editors; config tests can still exercise their fake executable.
      terminal: { ...(args.includes("init") ? { openEditor: async () => {} } : {}), ...terminal }, setup,
      stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; },
    });
    return { status, stdout, stderr };
  }

  return { root, home, env, git, repository, writeConfig, invoke,
    personalDirectory: userConfigDirectory({ env, homeDirectory: home }) };
}

export function listedSettings(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Configuration: /);
  return JSON.parse(result.stdout.slice(result.stdout.indexOf("\n") + 1));
}
