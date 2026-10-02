import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "../helpers/config-fixture.mjs";
import { selectBranches } from "../../dist/git/branches.js";
import { runGit } from "../../dist/git/client.js";
import { scanCommittedComments } from "../../dist/scanners/comments/scan.js";

const builtin = { python: { mode: "builtin" }, ruby: { mode: "builtin" },
  go: { mode: "builtin" }, php: { mode: "builtin" } };

test("committed comment scan dispatches every listed language family and records backends", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const sources = {
    "one.py": "# TODO\n", "one.rb": "# TODO\n", "one.go": "// TODO\n", "one.rs": "// TODO\n",
    "one.js": "// TODO\n", "one.jsx": "// TODO\n", "one.ts": "// TODO\n", "one.tsx": "// TODO\n",
    "one.c": "// TODO\n", "one.cpp": "// TODO\n", "one.css": "/* TODO */",
    "one.html": "<!-- TODO -->", "one.djhtml": "{# TODO #}", "one.php": "<?php // TODO\n",
  };
  for (const [name, source] of Object.entries(sources)) writeFileSync(join(repo, name), source);
  f.git(repo, ["add", "."]);
  f.git(repo, ["commit", "--quiet", "-m", "comment corpus"]);
  const branches = await selectBranches(context);
  const result = await scanCommittedComments(context, branches, ["TODO"], builtin);
  assert.equal(result.branches.length, 1);
  assert.equal(result.branches[0].files.length, Object.keys(sources).length);
  for (const entry of result.branches[0].files) {
    assert.equal(entry.status, "ok", entry.file.path);
    assert.deepEqual(entry.findings.map((finding) => finding.matches.map((match) => match.marker)), [["TODO"]]);
    assert.equal(result.backends[entry.file.language].kind, "builtin");
  }
  assert.equal(result.backends.python.version, "2");
});

test("scan uses each immutable branch and exposes skipped or unscannable files", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  writeFileSync(join(repo, "good.js"), '// TODO committed\nconst text = "FIXME fake";\n');
  writeFileSync(join(repo, "unknown.js"), "// TODO before\n@decorator class Example {}\n");
  writeFileSync(join(repo, "broken.css"), "/* TODO before\n");
  writeFileSync(join(repo, "binary.py"), Buffer.from([35, 32, 84, 79, 68, 79, 0]));
  f.git(repo, ["add", "."]);
  f.git(repo, ["commit", "--quiet", "-m", "main corpus"]);
  f.git(repo, ["checkout", "--quiet", "-b", "topic"]);
  writeFileSync(join(repo, "good.js"), "// FIXME topic\n");
  f.git(repo, ["add", "good.js"]);
  f.git(repo, ["commit", "--quiet", "-m", "topic source"]);
  writeFileSync(join(repo, "good.js"), "// TODO dirty\n");
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  const result = await scanCommittedComments(context, await selectBranches(context), ["TODO"], builtin);
  const byBranch = new Map(result.branches.map(({ branch, files }) => [branch.name,
    new Map(files.map((entry) => [entry.file.path, entry]))]));
  assert.equal(byBranch.get("main").get("good.js").findings[0].comment.text, " TODO committed");
  assert.deepEqual(byBranch.get("topic").get("good.js").findings, []);
  for (const files of byBranch.values()) {
    assert.deepEqual(files.get("binary.py"), {
      file: files.get("binary.py").file, status: "skipped", reason: "binary",
    });
    assert.equal(files.get("unknown.js").status, "unsupported");
    assert.equal(files.get("broken.css").status, "invalid");
    assert.ok(files.get("unknown.js").diagnostic.message);
  }
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), before);
});

test("marker lines in one block comment retain their own committed authors and dates", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const file = join(repo, "history.js");
  const commitAs = async (name, email, date, message) => {
    const env = { ...f.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_DATE: date };
    await runGit(["-c", "commit.gpgSign=false", "commit", "--quiet", "-m", message], { cwd: repo, env });
    return f.git(repo, ["rev-parse", "HEAD"]);
  };
  writeFileSync(file, "/* TODO first FIXME first\n * TODO original */\n");
  f.git(repo, ["add", "history.js"]);
  const firstCommit = await commitAs("Alex", "alex@example.invalid", "2020-01-02T03:04:05+00:00", "first comment");
  writeFileSync(file, "/* TODO first FIXME first\n * TODO revised */\n");
  f.git(repo, ["add", "history.js"]);
  const secondCommit = await commitAs("Blake", "blake@example.invalid", "2021-02-03T04:05:06+00:00", "edit second line");
  const branches = await selectBranches(context);
  writeFileSync(file, "// TODO dirty worktree\n");
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  const result = await scanCommittedComments(context, branches, ["TODO", "FIXME"], builtin);
  const [finding] = result.branches[0].files[0].findings;
  assert.deepEqual(finding.matches.map(({ marker, line }) => [marker, line]),
    [["TODO", 1], ["FIXME", 1], ["TODO", 2]]);
  assert.equal(finding.matches[0].attribution.commitId, firstCommit);
  assert.equal(finding.matches[0].attribution.authorName, "Alex");
  assert.equal(finding.matches[0].attribution.authorEmail, "alex@example.invalid");
  assert.equal(finding.matches[0].attribution.authoredAt, "2020-01-02T03:04:05.000Z");
  assert.strictEqual(finding.matches[0].attribution, finding.matches[1].attribution);
  assert.equal(finding.matches[2].attribution.commitId, secondCommit);
  assert.equal(finding.matches[2].attribution.authorName, "Blake");
  assert.equal(finding.matches[2].attribution.authoredAt, "2021-02-03T04:05:06.000Z");
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), before);
});
