import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { saveMarkdownReport } from "../../dist/storage/exports.js";

test("report export requires a real directory, asks before creation and overwrite", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "debt-watcher-export-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const options = { repositoryRoot: root, invocationDirectory: root,
    configuredDirectory: "./reports", generatedAt: "2026-01-02T03:04:05.000Z", interactive: false };
  await assert.rejects(saveMarkdownReport("first\n", options), /Report directory does not exist/);
  const created = await saveMarkdownReport("first\n", { ...options, interactive: true,
    chooseMissingDirectory: async () => "create" });
  assert.equal(created.path, join(root, "reports", "debt-watcher-report-2026-01-02T03-04-05-000Z.md"));
  assert.equal(readFileSync(created.path, "utf8"), "first\n");
  await assert.rejects(saveMarkdownReport("second\n", options), /Report already exists/);
  assert.equal(readFileSync(created.path, "utf8"), "first\n");
  await saveMarkdownReport("second\n", { ...options, interactive: true,
    confirm: async () => true });
  assert.equal(readFileSync(created.path, "utf8"), "second\n");
});

test("explicit output resolves from invocation directory; alternate folder does not silently edit settings", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "debt-watcher-export-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "other"));
  const saved = await saveMarkdownReport("report\n", { repositoryRoot: root,
    invocationDirectory: root, configuredDirectory: "./missing", generatedAt: "2026-01-02T03:04:05Z",
    interactive: true, chooseMissingDirectory: async () => "other",
    askDirectory: async () => "./other" });
  assert.equal(saved.path, join(root, "other", "debt-watcher-report-2026-01-02T03-04-05Z.md"));
  assert.equal(saved.alternateDirectory, join(root, "other"));
  const explicit = await saveMarkdownReport("explicit\n", { repositoryRoot: root,
    invocationDirectory: root, configuredDirectory: "./missing", output: "./other/picked.md",
    generatedAt: "2026-01-02T03:04:05Z", interactive: false });
  assert.equal(explicit.path, join(root, "other", "picked.md"));
});
