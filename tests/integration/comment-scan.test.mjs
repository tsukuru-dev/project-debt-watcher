import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "../helpers/config-fixture.mjs";
import { selectBranches } from "../../dist/git/branches.js";
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
