import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { editorCommand, openEditor, parseEditorCommand } from "../../dist/terminal/editor.js";
import { isInteractive } from "../../dist/terminal/prompts.js";

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
  await assert.rejects(openEditor("/unused/config.json", { env: { EDITOR: "debt-watcher-nonexistent-editor-4981" } }), /Could not launch editor/);
  await assert.rejects(openEditor("C:\\unused\\config.json", { platform: "win32", env: { EDITOR: "editor.cmd" } }), /executable.*wrapper/);
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
  const path = "C:\\repo & user's $project; (test)\\debt-watcher.config.json";
  const env = { VISUAL: " ", EDITOR: "" };
  await openEditor(path, { platform: "win32", env, spawnProcess: fake.spawnProcess });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.command, "powershell.exe");
  assert.equal(call.options.env.DEBT_WATCHER_EDITOR_FILE, path);
  assert.ok(call.args.every((arg) => !arg.includes(path)));
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.equal(env.DEBT_WATCHER_EDITOR_FILE, undefined);
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
    }), /Configured editor unavailable/);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].command, "C:\\Editor\\editor.exe");
    assert.deepEqual(fake.calls[0].args, ["--wait", "C:\\config.json"]);
  }
});
