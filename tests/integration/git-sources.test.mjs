import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "../helpers/config-fixture.mjs";
import { runGit } from "../../dist/git/client.js";
import { selectBranches } from "../../dist/git/branches.js";
import { listSourceFiles, readSourceFile } from "../../dist/git/files.js";
import { languageForPath } from "../../dist/scanners/comments/languages.js";
import { extractJavaScriptComments } from "../../dist/scanners/comments/javascript.js";
import { extractCssComments } from "../../dist/scanners/comments/css.js";
import { extractPythonComments } from "../../dist/scanners/comments/python.js";
import { extractGoComments } from "../../dist/scanners/comments/go.js";
import { extractRustComments } from "../../dist/scanners/comments/rust.js";

function commit(f, repo, content = "// TODO: main\n") {
  writeFileSync(join(repo, "main.ts"), content);
  f.git(repo, ["add", "main.ts"]);
  f.git(repo, ["commit", "--quiet", "-m", "source snapshot"]);
  return f.git(repo, ["rev-parse", "HEAD"]);
}

test("Go extraction uses committed source and treats directives as inert comments", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const path = join(repo, "main.go");
  writeFileSync(path, 'package main\n//go:generate do-not-run\nvar s = `// hidden`\n/* TODO committed */\n');
  f.git(repo, ["add", "main.go"]);
  f.git(repo, ["commit", "--quiet", "-m", "Go snapshot"]);
  const [branch] = await selectBranches(context);
  writeFileSync(path, "// working copy only\n");
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  const [file] = await listSourceFiles(branch.commitId, context);
  assert.equal(file.language, "go");
  const saved = await readSourceFile(file, context);
  assert.equal(saved.kind, "text");
  const result = extractGoComments(saved.text);
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.comments.map((c) => [c.text, c.start.line]), [["go:generate do-not-run", 2], [" TODO committed ", 4]]);
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), before);
  assert.equal(readFileSync(path, "utf8"), "// working copy only\n");
});

test("Rust extraction reads committed comments without scanning raw strings or dirty source", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const path = join(repo, "main.rs");
  writeFileSync(path, 'let x = r#"// hidden"#;\n/* TODO committed /* nested */ still here */\n');
  f.git(repo, ["add", "main.rs"]);
  f.git(repo, ["commit", "--quiet", "-m", "Rust snapshot"]);
  const [branch] = await selectBranches(context);
  writeFileSync(path, "// working copy only\n");
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  const [file] = await listSourceFiles(branch.commitId, context);
  assert.equal(file.language, "rust");
  const saved = await readSourceFile(file, context);
  assert.equal(saved.kind, "text");
  const result = extractRustComments(saved.text);
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.comments.map((c) => [c.text, c.start.line]), [[" TODO committed /* nested */ still here ", 2]]);
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), before);
  assert.equal(readFileSync(path, "utf8"), "// working copy only\n");
});

// Build Git trees directly so Windows can test names it cannot create on disk.
async function treeCommit(context, entries) {
  const tree = (await runGit(["mktree", "-z"], context, entries.join(""))).trim();
  return (await runGit(["-c", "user.name=Source tests", "-c", "user.email=tests@example.invalid",
    "-c", "commit.gpgSign=false", "commit-tree", tree, "-m", "synthetic source tree"], context)).trim();
}

test("empty repositories have no branch snapshots and detached HEAD does not invent a branch", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  assert.deepEqual(await selectBranches(context), []);
  assert.deepEqual(await selectBranches(context, "remote"), []);
  const id = commit(f, repo);
  f.git(repo, ["checkout", "--detach", "--quiet", id]);
  assert.deepEqual((await selectBranches(context)).map((b) => b.ref), ["refs/heads/main"]);
  assert.equal(f.git(repo, ["rev-parse", "HEAD"]), id);
});

test("branch scope is deterministic, excludes tags and remote aliases, and does not fetch", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const id = commit(f, repo);
  f.git(repo, ["branch", "z-topic/nested"]);
  f.git(repo, ["branch", "a-topic"]);
  f.git(repo, ["tag", "release"]);
  f.git(repo, ["update-ref", "refs/remotes/origin/main", id]);
  f.git(repo, ["update-ref", "refs/remotes/other/topic", id]);
  f.git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  // No remote URLs are configured: remote selection only reads existing tracking refs.
  const local = await selectBranches(context);
  assert.deepEqual(local.map((b) => b.name), ["a-topic", "main", "z-topic/nested"]);
  assert.ok(local.every((b) => b.commitId === id && b.scope === "local"));
  const remote = await selectBranches(context, "remote");
  assert.deepEqual(remote.map((b) => b.name), ["origin/main", "other/topic"]);
  assert.ok(remote.every((b) => b.scope === "remote" && b.commitId === id));
});

test("snapshots survive moving/deleting a branch and never use staged or dirty contents", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const id = commit(f, repo);
  f.git(repo, ["branch", "topic"]);
  const snapshots = await selectBranches(context);
  commit(f, repo, "// TODO: newer committed code\n");
  f.git(repo, ["branch", "-D", "topic"]);
  writeFileSync(join(repo, "main.ts"), "// TODO: staged only\n");
  f.git(repo, ["add", "main.ts"]);
  writeFileSync(join(repo, "main.ts"), "// TODO: working file only\n");
  writeFileSync(join(repo, "untracked.py"), "# TODO: untracked\n");
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  const indexBefore = readFileSync(join(repo, ".git", "index"));
  for (const branch of snapshots) {
    assert.equal(branch.commitId, id);
    const files = await listSourceFiles(branch.commitId, context);
    assert.deepEqual(files.map((file) => file.path), ["main.ts"]);
    assert.deepEqual(await readSourceFile(files[0], context), { kind: "text", text: "// TODO: main\n" });
  }
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), before);
  assert.deepEqual(readFileSync(join(repo, ".git", "index")), indexBefore);
  assert.equal(readFileSync(join(repo, "main.ts"), "utf8"), "// TODO: working file only\n");
});

test("enumeration uses the full tree from nested directories and selected linked worktrees", async (t) => {
  const f = fixture(t), repo = f.repository();
  commit(f, repo);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "part.py"), "# TODO: nested\n");
  f.git(repo, ["add", "src/part.py"]);
  f.git(repo, ["commit", "--quiet", "-m", "nested source"]);
  const linked = join(f.root, "linked");
  f.git(repo, ["worktree", "add", "--quiet", "-b", "linked-topic", linked]);
  for (const cwd of [join(repo, "src"), linked]) {
    const context = { cwd, env: { ...f.env, GIT_DIR: join(f.root, "nonexistent"), GIT_WORK_TREE: f.root } };
    const branches = await selectBranches(context);
    const files = await listSourceFiles(branches[0].commitId, context);
    assert.deepEqual(files.map((file) => file.path), ["main.ts", "src/part.py"]);
    assert.equal((await readSourceFile(files[1], context)).text, "# TODO: nested\n");
  }
});

test("unusual names remain literal and symlinks/submodules are not treated as source files", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const base = commit(f, repo);
  const blob = (await runGit(["hash-object", "-w", "--stdin"], context, "// TODO: literal content\n")).trim();
  const names = ["-option.ts", "space name.py", "colon:name.ts", "tab\tand\nnewline.jsx", "日本語 é.tsx", "shell $(nope) &.go"];
  const id = await treeCommit(context, [
    ...names.map((name) => `100644 blob ${blob}\t${name}\0`),
    `100755 blob ${blob}\texecutable.js\0`, `120000 blob ${blob}\tlink.py\0`,
    `160000 commit ${base}\tsubmodule.ts\0`, `100644 blob ${blob}\treadme.md\0`,
  ]);
  const files = await listSourceFiles(id, context);
  assert.deepEqual(files.map((file) => file.path).sort(), [...names, "executable.js"].sort());
  assert.equal(files.find((file) => file.path === "executable.js").mode, "100755");
  for (const file of files) assert.deepEqual(await readSourceFile(file, context), { kind: "text", text: "// TODO: literal content\n" });
});

test("binary, invalid UTF-8 and oversized source candidates have explicit skip reasons", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  writeFileSync(join(repo, "binary.js"), Buffer.from([65, 0, 66]));
  writeFileSync(join(repo, "invalid.py"), Buffer.from([0xff, 0xfe, 0x61]));
  writeFileSync(join(repo, "large.ts"), "// TODO: " + "x".repeat(1024 * 1024 + 1));
  writeFileSync(join(repo, "empty.css"), "");
  writeFileSync(join(repo, "bom.rs"), "\uFEFF// TODO: keep line endings\r\n");
  f.git(repo, ["add", "."]);
  f.git(repo, ["commit", "--quiet", "-m", "source byte cases"]);
  const files = await listSourceFiles(f.git(repo, ["rev-parse", "HEAD"]), context);
  const get = (name) => files.find((file) => file.path === name);
  assert.deepEqual(await readSourceFile(get("binary.js"), context), { kind: "skipped", reason: "binary" });
  assert.deepEqual(await readSourceFile(get("invalid.py"), context), { kind: "skipped", reason: "invalid-utf8" });
  assert.deepEqual(await readSourceFile(get("large.ts"), context, 1024), { kind: "skipped", reason: "too-large" });
  assert.equal((await readSourceFile(get("large.ts"), context)).text.length, get("large.ts").size);
  assert.deepEqual(await readSourceFile(get("empty.css"), context), { kind: "text", text: "" });
  assert.deepEqual(await readSourceFile(get("bom.rs"), context), { kind: "text", text: "\uFEFF// TODO: keep line endings\r\n" });
});

test("replacement objects do not silently change the contents of a snapshotted blob", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const id = commit(f, repo, "// TODO: original\n");
  const [file] = await listSourceFiles(id, context);
  const replacement = (await runGit(["hash-object", "-w", "--stdin"], context, "// TODO: replaced\n")).trim();
  f.git(repo, ["replace", file.blobId, replacement]);
  assert.deepEqual(await readSourceFile(file, context), { kind: "text", text: "// TODO: original\n" });
});

test("invalid object IDs and missing objects fail explicitly instead of becoming empty results", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  for (const id of ["HEAD", "--help", "main:path.ts", "a".repeat(39)]) {
    await assert.rejects(listSourceFiles(id, context), /full Git object ID/);
  }
  await assert.rejects(listSourceFiles("0".repeat(40), context));
  await assert.rejects(selectBranches(context, "invalid"), /scope/);
  const id = commit(f, repo);
  const [file] = await listSourceFiles(id, context);
  await assert.rejects(readSourceFile(file, context, 0), /positive integer/);
  await assert.rejects(readSourceFile({ ...file, size: file.size + 1 }, context), /size changed/);
  await assert.rejects(readSourceFile({ ...file, blobId: "0".repeat(40) }, context));
});

test("source extension classification covers required language families without treating all files as code", () => {
  const cases = { "a.py": "python", "a.pyi": "python", "a.cjs": "javascript", "a.mjs": "javascript",
    "a.jsx": "jsx", "a.mts": "typescript", "a.cts": "typescript", "a.tsx": "tsx", "a.css": "css",
    "a.cpp": "cpp", "a.hpp": "cpp", "a.C": "cpp", "a.rs": "rust", "a.go": "go",
    "templates/a.html": "django-template", "a.djhtml": "django-template" };
  for (const [path, language] of Object.entries(cases)) assert.equal(languageForPath(path), language, path);
  for (const path of ["README.md", "package.json", "image.png", "no-extension"]) assert.equal(languageForPath(path), undefined);
});

test("SHA-256 repositories use the same snapshot and source-reading APIs", async (t) => {
  const f = fixture(t), repo = join(f.root, "sha256");
  mkdirSync(repo);
  f.git(repo, ["init", "--quiet", "--object-format=sha256", "--initial-branch=main", "--template="]);
  const id = commit(f, repo);
  assert.equal(id.length, 64);
  const context = { cwd: repo, env: f.env };
  const [branch] = await selectBranches(context);
  assert.equal(branch.commitId, id);
  const [file] = await listSourceFiles(id, context);
  assert.equal(file.blobId.length, 64);
  assert.deepEqual(await readSourceFile(file, context), { kind: "text", text: "// TODO: main\n" });
});

test("comment extraction consumes the committed source with original line positions", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const source = 'const url: string = "https://example.invalid//TODO";\n/* FIXME committed */\n';
  const id = commit(f, repo, source);
  writeFileSync(join(repo, "main.ts"), "// TODO working copy only\n");
  const [file] = await listSourceFiles(id, context);
  const saved = await readSourceFile(file, context);
  assert.equal(saved.kind, "text");
  const extracted = extractJavaScriptComments(saved.text, file.language);
  assert.equal(extracted.status, "ok");
  assert.deepEqual(extracted.comments.map((c) => [c.text, c.start.line, c.start.column]), [[" FIXME committed ", 2, 1]]);
  assert.equal(readFileSync(join(repo, "main.ts"), "utf8"), "// TODO working copy only\n");
});

test("CSS extraction reads committed styles without treating URLs or strings as comments", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const path = join(repo, "style.css");
  writeFileSync(path, 'a { background: url(https://host/*TODO*/image); content: "/* fake */"; }\n/* FIXME committed */\n');
  f.git(repo, ["add", "style.css"]);
  f.git(repo, ["commit", "--quiet", "-m", "CSS snapshot"]);
  const [branch] = await selectBranches(context);
  writeFileSync(path, "/* working copy only */");
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  const [file] = await listSourceFiles(branch.commitId, context);
  assert.equal(file.language, "css");
  const saved = await readSourceFile(file, context);
  assert.equal(saved.kind, "text");
  const extracted = extractCssComments(saved.text);
  assert.equal(extracted.status, "ok");
  assert.deepEqual(extracted.comments.map((c) => [c.text, c.start.line, c.start.column]), [[" FIXME committed ", 2, 1]]);
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), before);
  assert.equal(readFileSync(path, "utf8"), "/* working copy only */");
});

test("Python extraction reads committed comments and excludes docstrings and raw string contents", async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  const path = join(repo, "main.py");
  writeFileSync(path, '"""# TODO docstring"""\nx = r"# FIXME raw text"\n# TODO committed\n');
  f.git(repo, ["add", "main.py"]);
  f.git(repo, ["commit", "--quiet", "-m", "Python snapshot"]);
  const [branch] = await selectBranches(context);
  writeFileSync(path, "# working copy only\n");
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  const [file] = await listSourceFiles(branch.commitId, context);
  assert.equal(file.language, "python");
  const saved = await readSourceFile(file, context);
  assert.equal(saved.kind, "text");
  const extracted = extractPythonComments(saved.text);
  assert.equal(extracted.status, "ok");
  assert.deepEqual(extracted.comments.map((c) => [c.text, c.start.line, c.start.column]), [[" TODO committed", 3, 1]]);
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), before);
  assert.equal(readFileSync(path, "utf8"), "# working copy only\n");
});
