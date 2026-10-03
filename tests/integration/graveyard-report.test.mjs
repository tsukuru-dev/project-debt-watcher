import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
  const firstLatest = await invoke(["--save", "latest", "--output", "./first-latest.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(firstLatest.status, 0, firstLatest.stderr);
  assert.match(readFileSync(join(f.root, "first-latest.md"), "utf8"), /Code comments: 1/);

  const summary = await invoke(["--summary"]);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /Graveyard — summary by type/);
  assert.match(summary.stdout, /Total debt: 1/);
  assert.match(summary.stdout, /Oldest: code comment \| \d+ days \| main:legacy\.js:1/);
  assert.ok(!summary.stdout.includes("replace legacy route"));
  const filteredSummary = await invoke(["--summary", "types", "--filter", "includefresh=true"]);
  assert.equal(filteredSummary.status, 0, filteredSummary.stderr);
  assert.match(filteredSummary.stdout, /Code comments: 2/);
  const savedSummary = await invoke(["--summary", "--save", "--output", "./summary.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(savedSummary.status, 0, savedSummary.stderr);
  const summaryMarkdown = readFileSync(join(f.root, "summary.md"), "utf8");
  assert.match(summaryMarkdown, /# Graveyard — summary by type/);
  assert.match(summaryMarkdown, /Total debt: 1/);
  assert.ok(!summaryMarkdown.includes("replace legacy route"));
  const latestSummary = await invoke(["--save", "latest", "--output", "./summary-copy.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(latestSummary.status, 0, latestSummary.stderr);
  assert.equal(readFileSync(join(f.root, "summary-copy.md"), "utf8"), summaryMarkdown);

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
  const recovered = await invoke(["--save", "latest", "--output", "./recovered.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(readFileSync(join(f.root, "recovered.md"), "utf8"), /Code comments: 1/);
  mkdirSync(join(repo, "debt-watcher-reports"));
  const configured = await invoke(["--save"]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.match(configured.stdout, /Saved report:/);
  assert.equal(readFileSync(configPath, "utf8"), beforeConfig);

  const generatedPath = configured.stdout.match(/Saved report: ([^\r\n]+)/)?.[1];
  assert.ok(generatedPath);
  const generatedMarkdown = readFileSync(generatedPath, "utf8");
  unlinkSync(configPath);
  writeFileSync(join(repo, "legacy.js"), "// TODO: changed again after reporting\n");
  const latest = await invoke(["--save", "latest", "--repo", relative(f.root, repo),
    "--output", "./latest-copy.md"], f.root);
  assert.equal(latest.status, 0, latest.stderr);
  assert.match(latest.stdout, /Exported report generated .* from main .* local branches/);
  assert.equal(readFileSync(join(f.root, "latest-copy.md"), "utf8"), generatedMarkdown);
  assert.ok(!latest.stdout.includes("changed again after reporting"));

  const other = f.repository("other");
  const noSnapshot = await invoke(["--save", "latest", "--repo", relative(f.root, other),
    "--output", "./other-copy.md"], f.root);
  assert.equal(noSnapshot.status, 1);
  assert.match(noSnapshot.stderr, /No previous report exists for this repository/);
  assert.ok(!existsSync(join(f.root, "other-copy.md")));
});

test("unsupported report modes fail before repository setup or scanning", async (t) => {
  const f = fixture(t);
  for (const [args, message] of [
    [["--summary", "blame"], /Author summaries are not implemented/],
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
