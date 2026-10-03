import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { latestReport, rememberReport, reportSnapshotPath } from "../../dist/storage/snapshots.js";

test("report snapshots survive separate reads and stay isolated by repository", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "debt-watcher-snapshot-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const options = { homeDirectory: root, env: { APPDATA: join(root, "appdata"),
    XDG_CONFIG_HOME: join(root, "config") } };
  const repositoryRoot = join(root, "repo-a");
  const snapshot = { version: 1, repositoryRoot, generatedAt: "2026-01-01T00:00:00.000Z",
    checkoutBranch: "main", checkoutCommit: "a".repeat(40), scope: "local",
    scannedBranches: [{ ref: "refs/heads/main", commitId: "a".repeat(40) }],
    settings: { fresh: 30, ageing: 60, buried: 90, markers: ["TODO"], includeFresh: false,
      showAuthors: true, order: "oldnew", reportDirectory: "./reports" },
    filters: { includeFresh: false }, order: "oldnew", markdown: "# Original report\n" };
  assert.equal(await latestReport(repositoryRoot, options), null);
  await rememberReport(snapshot, options);
  assert.deepEqual(await latestReport(repositoryRoot, options), snapshot);
  assert.equal(await latestReport(join(root, "repo-b"), options), null);
  await rememberReport({ ...snapshot, markdown: "# New report\n" }, options);
  assert.equal((await latestReport(repositoryRoot, options)).markdown, "# New report\n");
  writeFileSync(reportSnapshotPath(repositoryRoot, options), "bad JSON");
  await assert.rejects(latestReport(repositoryRoot, options), /Report cache is invalid/);
});
