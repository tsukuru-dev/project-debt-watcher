import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { editorCommand, openEditor, parseEditorCommand } from "../../dist/terminal/editor.js";
import { isInteractive } from "../../dist/terminal/prompts.js";
import { discoverEditors } from "../../dist/terminal/editor-discovery.js";

test("editor selection prefers VISUAL, then EDITOR, then the platform default", () => {
  assert.deepEqual(editorCommand({ env: { VISUAL: "code --wait", EDITOR: "vi" } }), ["code", "--wait"]);
  assert.deepEqual(editorCommand({ env: { VISUAL: " ", EDITOR: "nano" } }), ["nano"]);
  assert.deepEqual(editorCommand({ env: {}, platform: "win32" }), ["notepad.exe"]);
  assert.deepEqual(editorCommand({ env: {}, platform: "darwin" }), ["/usr/bin/open", "-t"]);
  assert.deepEqual(editorCommand({ env: {}, platform: "linux" }), ["vi"]);
});

test("editor parsing preserves quoted paths and Windows backslashes without shell expansion", () => {
  assert.deepEqual(parseEditorCommand('"C:\\Program Files\\Editor\\editor.exe" --wait "a b"'),
    ["C:\\Program Files\\Editor\\editor.exe", "--wait", "a b"]);
  assert.deepEqual(parseEditorCommand("'/path with spaces/editor' '$HOME' '$(echo nope)'"),
    ["/path with spaces/editor", "$HOME", "$(echo nope)"]);
  assert.throws(() => parseEditorCommand('"unfinished'), /unclosed quote/);
  assert.throws(() => parseEditorCommand('""'), /executable/);
  assert.throws(() => parseEditorCommand("code\0"), /null character/);
});

test("CI and redirected streams disable interaction", () => {
  assert.equal(isInteractive({}, true), true);
  assert.equal(isInteractive({}, false), false);
  assert.equal(isInteractive({ CI: "true" }, true), false);
  assert.equal(isInteractive({ CI: "1" }, true), false);
  assert.equal(isInteractive({ CI: "false" }, true), true);
});

test("the confirmation prompt accepts only yes and cancels on blank input or EOF", () => {
  const url = new URL("../../dist/terminal/prompts.js", import.meta.url).href;
  const script = "import {confirm} from " + JSON.stringify(url)
    + "; console.log('\\nRESULT=' + await confirm('Replace settings?'));";
  for (const [input, expected] of [["yes\n", true], ["Y\n", true], ["no\n", false],
    ["\n", false], ["", false], ["perhaps\n", false]]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      input, encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("RESULT=" + expected), result.stdout);
  }
});

test("editor launch errors reject and Windows batch wrappers are not sent to a shell", async () => {
  await assert.rejects(openEditor("/unused/config.json", { env: { EDITOR: "debt-finder-nonexistent-editor-4981" } }), /Could not launch editor/);
  await assert.rejects(openEditor("C:\\unused\\config.json", { platform: "win32", env: { EDITOR: "editor.cmd" } }), /executable.*wrapper/);
});

test("starting-defaults prompt selects personal or template and cancels on blank, cancel or EOF", () => {
  const url = new URL("../../dist/terminal/prompts.js", import.meta.url).href;
  const script = "import {chooseDefaults} from " + JSON.stringify(url)
    + "; console.log('\\nRESULT=' + await chooseDefaults('/personal/config.json'));";
  for (const [input, expected] of [["1\n", "personal"], ["2\n", "template"], ["3\n", "undefined"],
    ["\n", "undefined"], ["", "undefined"], ["invalid\n", "undefined"]]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      input, encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("RESULT=" + expected), result.stdout);
  }
});

function launcher(outcomes) {
  const calls = [];
  return {
    calls,
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      const outcome = outcomes.shift();
      queueMicrotask(() => {
        if (outcome instanceof Error) child.emit("error", outcome);
        else child.emit("exit", outcome, null);
      });
      return child;
    },
  };
}

test("Windows opens the associated app and passes special characters as data", async () => {
  const fake = launcher([0]);
  const path = "C:\\repo & user's $project; (test)\\debt-finder.config.json";
  const env = { VISUAL: " ", EDITOR: "" };
  await openEditor(path, { platform: "win32", env, spawnProcess: fake.spawnProcess });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.command, "powershell.exe");
  assert.equal(call.options.env.DEBT_FINDER_EDITOR_FILE, path);
  assert.ok(call.args.every((arg) => !arg.includes(path)));
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.equal(env.DEBT_FINDER_EDITOR_FILE, undefined);
});

test("Windows falls back to Notepad when association lookup or launching fails", async () => {
  for (const failure of [1, new Error("PowerShell unavailable")]) {
    const fake = launcher([failure, 0]);
    await openEditor("C:\\config.json", { platform: "win32", env: {}, spawnProcess: fake.spawnProcess });
    assert.deepEqual(fake.calls.map((call) => call.command), ["powershell.exe", "notepad.exe"]);
    assert.deepEqual(fake.calls[1].args, ["C:\\config.json"]);
  }
  const fake = launcher([1, new Error("Notepad unavailable")]);
  await assert.rejects(openEditor("C:\\config.json", {
    platform: "win32", env: {}, spawnProcess: fake.spawnProcess,
  }), /Notepad unavailable/);
});

test("explicit Windows editors bypass associations and retain launch errors", async () => {
  for (const key of ["VISUAL", "EDITOR"]) {
    const fake = launcher([new Error("Configured editor unavailable")]);
    await assert.rejects(openEditor("C:\\config.json", {
      platform: "win32", env: { [key]: '"C:\\Editor\\editor.exe" --wait' },
      spawnProcess: fake.spawnProcess,
      discoverEditors: async () => { assert.fail("Explicit preference must bypass discovery"); },
    }), /Configured editor unavailable/);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].command, "C:\\Editor\\editor.exe");
    assert.deepEqual(fake.calls[0].args, ["--wait", "C:\\config.json"]);
  }
});

test("installed editors are tried in product order before Windows associations", async () => {
  const fake = launcher([1, new Error("Missing editor"), 0]);
  await openEditor("C:\\repo & data\\config.json", {
    platform: "win32", env: {}, spawnProcess: fake.spawnProcess,
    discoverEditors: async () => [["Code.exe"], ["Cursor.exe"], ["Antigravity.exe"]],
  });
  assert.deepEqual(fake.calls.map((call) => call.command), ["Code.exe", "Cursor.exe", "Antigravity.exe"]);
  for (const call of fake.calls) assert.deepEqual(call.args, ["C:\\repo & data\\config.json"]);
});

test("exhausted discovery falls back through associations to basic editors on each platform", async () => {
  for (const [platform, association, basic, basicArgs] of [
    ["win32", "powershell.exe", "notepad.exe", ["/config.json"]],
    ["darwin", "/usr/bin/open", "/usr/bin/open", ["-t", "/config.json"]],
    ["linux", "xdg-open", "vi", ["/config.json"]],
  ]) {
    const fake = launcher([1, 1, 0]);
    await openEditor("/config.json", {
      platform, env: {}, spawnProcess: fake.spawnProcess, discoverEditors: async () => [["broken-editor"]],
    });
    assert.deepEqual(fake.calls.map((call) => call.command), ["broken-editor", association, basic]);
    assert.deepEqual(fake.calls[2].args, basicArgs);
  }
});

test("Windows discovery finds native executables in PATH and standard installs in product order", async () => {
  const installed = new Set([
    "D:\\Cursor\\Cursor.exe", "C:\\Users\\A\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    "C:\\Program Files\\Antigravity\\Antigravity.exe",
  ]);
  const result = await discoverEditors({ platform: "win32", env: {
    Path: '"D:\\Cursor\\bin"', LOCALAPPDATA: "C:\\Users\\A\\AppData\\Local", ProgramFiles: "C:\\Program Files",
  }, isExecutable: async (path) => installed.has(path) });
  assert.deepEqual(result, [
    ["C:\\Users\\A\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"],
    ["D:\\Cursor\\Cursor.exe"], ["C:\\Program Files\\Antigravity\\Antigravity.exe"],
  ]);
});

test("a recognised current editor takes priority, but generic vscode terminal markers do not", async () => {
  const installed = new Set(["/usr/bin/code", "/usr/share/cursor/cursor"]);
  const options = { platform: "linux", env: {
    PATH: "/usr/bin", TERM_PROGRAM: "vscode",
    VSCODE_GIT_ASKPASS_MAIN: "/usr/share/cursor/resources/app/extensions/git/dist/askpass-main.js",
  }, isExecutable: async (path) => installed.has(path) };
  assert.deepEqual(await discoverEditors(options), [["/usr/share/cursor/cursor"], ["/usr/bin/code"]]);
  assert.deepEqual(await discoverEditors({ ...options, env: { PATH: "/usr/bin", TERM_PROGRAM: "vscode" } }), [["/usr/bin/code"]]);
});

test("macOS discovers app bundles without PATH setup and respects the current editor", async () => {
  const code = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
  const cursor = "/Users/a/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  const installed = new Set([code, cursor]);
  const options = { platform: "darwin", env: { HOME: "/Users/a" }, isExecutable: async (path) => installed.has(path) };
  assert.deepEqual(await discoverEditors(options), [[code], [cursor]]);
  assert.deepEqual(await discoverEditors({ ...options, env: { ...options.env,
    VSCODE_GIT_ASKPASS_MAIN: "/Users/a/Applications/Cursor.app/Contents/resources/app/extensions/git/dist/askpass-main.js",
  } }), [[cursor], [code]]);
});
