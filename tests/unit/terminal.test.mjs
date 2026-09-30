import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
