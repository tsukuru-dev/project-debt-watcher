import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture, template } from "../helpers/config-fixture.mjs";
import { selectBranches } from "../../dist/git/branches.js";
import { runGit } from "../../dist/git/client.js";
import { scanBranchTips } from "../../dist/scanners/branches.js";

test("branch tips use immutable commits, committer age and the last commit author", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const commit = async (message, authorDate, committerDate, name, email) => {
    writeFileSync(join(repo, "work.txt"), message + "\n");
    f.git(repo, ["add", "work.txt"]);
    await runGit(["-c", "commit.gpgSign=false", "commit", "--quiet", "-m", message], {
      cwd: repo, env: { ...f.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: "Integrator", GIT_COMMITTER_EMAIL: "integrator@example.test",
        GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: committerDate } });
    return f.git(repo, ["rev-parse", "HEAD"]);
  };
  const old = await commit("old work", "2026-01-01T12:00:00Z", "2026-01-01T12:00:00Z",
    "Old Author", "old@example.test");
  f.git(repo, ["branch", "legacy"]);
  const recent = await commit("recent integration", "2026-01-01T12:00:00Z", "2026-10-02T12:00:00Z",
    "Recent Author", "recent@example.test");
  f.git(repo, ["update-ref", "refs/remotes/origin/legacy", old]);
  f.git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/legacy"]);
  const selected = await selectBranches(context);
  const remote = await selectBranches(context, "remote");
  assert.deepEqual(selected.map((branch) => branch.name), ["legacy", "main"]);
  assert.deepEqual(remote.map((branch) => branch.name), ["origin/legacy"]);
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  f.git(repo, ["update-ref", "refs/heads/legacy", recent]);
  writeFileSync(join(repo, "work.txt"), "dirty work\n");
  const dirty = f.git(repo, ["status", "--porcelain=v1"]);
  const asOf = new Date("2026-10-03T12:00:00.000Z");
  const scan = await scanBranchTips(context, selected, template, asOf);
  assert.equal(scan.generatedAt, asOf.toISOString());
  assert.deepEqual(scan.thresholds, { mode: "custom", fresh: 30, ageing: 60, buried: 90 });
  assert.equal(scan.findings.length, 2);
  const [legacy, main] = scan.findings;
  assert.equal(legacy.branch.commitId, old);
  assert.equal(legacy.authorName, "Old Author");
  assert.equal(legacy.authorEmail, "old@example.test");
  assert.equal(legacy.category, "fossil");
  assert.ok(legacy.ageDays > 90);
  assert.equal(main.branch.commitId, recent);
  assert.equal(main.authorName, "Recent Author");
  assert.equal(main.authoredAt, "2026-01-01T12:00:00.000Z");
  assert.equal(main.committedAt, "2026-10-02T12:00:00.000Z");
  assert.equal(main.ageDays, 1);
  assert.equal(main.category, "fresh");
  const remoteScan = await scanBranchTips(context, remote, template, asOf);
  assert.equal(remoteScan.findings[0].branch.scope, "remote");
  assert.equal(remoteScan.findings[0].branch.commitId, old);
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), dirty);
  assert.equal(readFileSync(join(repo, "work.txt"), "utf8"), "dirty work\n");
  assert.equal(before, "");
});

test("empty branch scope is a valid branch-tip scan", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const scan = await scanBranchTips(context, await selectBranches(context), template,
    new Date("2026-10-03T12:00:00.000Z"));
  assert.deepEqual(scan.findings, []);
  assert.equal(scan.thresholds.fresh, 30);
});
