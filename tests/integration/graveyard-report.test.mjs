import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { runCli } from "../../dist/program.js";
import { runGit } from "../../dist/git/client.js";
import { configFilename, fixture } from "../helpers/config-fixture.mjs";

test("graveyard reports committed code across local or remote refs with temporary filters", async (t) => {
  const f = fixture(t), repo = f.repository();
  const configPath = f.writeConfig(repo);
  writeFileSync(join(repo, "legacy.js"), "// TODO: replace legacy route\n");
  f.git(repo, ["add", "legacy.js"]);
  const oldEnv = { ...f.env, GIT_AUTHOR_DATE: "2020-01-01T12:00:00Z",
    GIT_COMMITTER_DATE: "2020-01-01T12:00:00Z" };
  await runGit(["-c", "commit.gpgSign=false", "-c", "user.name=Demo Older",
    "-c", "user.email=older@example.test", "commit", "--quiet", "-m", "old debt"],
  { cwd: repo, env: oldEnv });
  writeFileSync(join(repo, "recent.js"), "// FIXME: recent cleanup\n");
  f.git(repo, ["add", "recent.js"]);
  f.git(repo, ["commit", "--quiet", "-m", "recent debt"]);
  f.git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  writeFileSync(join(repo, "legacy.js"), "// TODO: dirty working-tree text\n");
  const beforeStatus = f.git(repo, ["status", "--porcelain=v1"]);
  const beforeConfig = readFileSync(configPath, "utf8");

  const invoke = async (args, cwd = repo) => {
    let stdout = "", stderr = "";
    const status = await runCli(["graveyard", ...args], { version: "0.0.0", cwd,
      env: { ...f.env, CI: "true" }, stdout: (text) => { stdout += text; },
      stderr: (text) => { stderr += text; } });
    return { status, stdout, stderr };
  };
  const normal = await invoke([]);
  assert.equal(normal.status, 0, normal.stderr);
  assert.match(normal.stdout, /Code comments \(1\)/);
  assert.match(normal.stdout, /🦖 \| \d+ days \| TODO \| main:legacy\.js:1 \| replace legacy route \| Demo Older/);
  assert.ok(!normal.stdout.includes("dirty working-tree text"));
  assert.ok(!normal.stdout.includes("recent cleanup"));

  const included = await invoke(["--filter", "includefresh=true", "--order", "newold"]);
  assert.equal(included.status, 0, included.stderr);
  assert.match(included.stdout, /Code comments \(2\)/);
  assert.ok(included.stdout.indexOf("recent cleanup") < included.stdout.indexOf("replace legacy route"));
  assert.match(included.stdout, /Oldest code comment: \d+ days \| main:legacy\.js:1/);

  const author = await invoke(["--filter", "author=OLDER", "--filter", "includefresh=true"]);
  assert.equal(author.status, 0, author.stderr);
  assert.match(author.stdout, /Code comments \(1\)/);
  assert.ok(!author.stdout.includes("recent cleanup"));

  const oneMarker = await invoke(["--markers", "FIXME", "--filter", "includefresh=true"]);
  assert.equal(oneMarker.status, 0, oneMarker.stderr);
  assert.match(oneMarker.stdout, /Code comments \(1\)/);
  assert.ok(!oneMarker.stdout.includes("replace legacy route"));

  const remote = await invoke(["--remote", "--all", "--repo", relative(f.root, repo)], f.root);
  assert.equal(remote.status, 0, remote.stderr);
  assert.match(remote.stdout, /Branches: remote\/origin\/main/);
  assert.match(remote.stdout, /origin\/main:legacy\.js:1/);
  assert.equal(readFileSync(configPath, "utf8"), beforeConfig);
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), beforeStatus);

  const destination = join(f.root, "saved.md");
  const saved = await invoke(["--save", "--repo", relative(f.root, repo),
    "--output", "./saved.md", "--filter", "includefresh=true"], f.root);
  assert.equal(saved.status, 0, saved.stderr);
  assert.match(saved.stdout, /Saved report:/);
  const markdown = readFileSync(destination, "utf8");
  assert.match(markdown, /# Graveyard — code comments/);
  assert.match(markdown, /Code comments: 2/);
  assert.match(markdown, /replace legacy route/);
  assert.match(markdown, /recent cleanup/);
  assert.ok(!markdown.includes("dirty working-tree text"));
  assert.ok(!markdown.includes("\u001b"));
  const repeat = await invoke(["--save", "--repo", relative(f.root, repo), "--output", "./saved.md"], f.root);
  assert.equal(repeat.status, 1);
  assert.match(repeat.stderr, /Report already exists/);
  assert.equal(readFileSync(destination, "utf8"), markdown);

  const missing = await invoke(["--save"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Report directory does not exist/);
  assert.ok(!existsSync(join(repo, "debt-watcher-reports")));
  mkdirSync(join(repo, "debt-watcher-reports"));
  const configured = await invoke(["--save"]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.match(configured.stdout, /Saved report:/);
  assert.equal(readFileSync(configPath, "utf8"), beforeConfig);
});

test("unsupported report modes fail before repository setup or scanning", async (t) => {
  const f = fixture(t);
  for (const [args, message] of [
    [["--summary"], /summaries are not implemented/],
    [["--save", "latest"], /latest report is not implemented/],
    [["--filter", "type=branches"], /Only type=code is available/],
  ]) {
    let stderr = "";
    const status = await runCli(["graveyard", ...args], { version: "0.0.0", cwd: f.root,
      env: { ...f.env, CI: "true" }, stderr: (text) => { stderr += text; } });
    assert.equal(status, 1);
    assert.match(stderr, message);
    assert.ok(!stderr.includes("Cannot resolve a Git working tree"));
  }
});
