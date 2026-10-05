import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
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
  assert.match(normal.stdout, /^🪦  PROJECT GRAVEYARD\nGenerated: .+\nBranches scanned: local\/main\nGroup: type\nFilters: includefresh=false\nOrder: oldnew\n/m);
  assert.match(normal.stdout, /CODE DEBT +1\n─+/);
  assert.match(normal.stdout, /🦖\s+[\d,]+d\s+TODO\s+replace legacy route\s+·\s+main:legacy\.js:1\s+·\s+Demo Older/);
  assert.ok(!normal.stdout.includes("dirty working-tree text"));
  assert.ok(!normal.stdout.includes("recent cleanup"));
  const normalClosingLine = normal.stdout.trimEnd().split("\n").at(-1);
  assert.ok(normalClosingLine && normalClosingLine.endsWith("."));
  const firstLatest = await invoke(["--save", "latest", "--output", "./first-latest.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(firstLatest.status, 0, firstLatest.stderr);
  assert.match(readFileSync(join(f.root, "first-latest.md"), "utf8"), /Code comments: 1/);
  assert.ok(readFileSync(join(f.root, "first-latest.md"), "utf8").includes(`*${normalClosingLine}*`));

  const byType = await invoke(["--group", "type"]);
  assert.equal(byType.status, 0, byType.stderr);
  assert.match(byType.stdout, /🪦  PROJECT GRAVEYARD/);
  assert.match(byType.stdout, /CODE DEBT +1\n─+/);
  const byAuthor = await invoke(["--group", "author", "--filter", "includefresh=true"]);
  assert.equal(byAuthor.status, 0, byAuthor.stderr);
  assert.match(byAuthor.stdout, /🪦  PROJECT GRAVEYARD — BY AUTHOR/);
  assert.match(byAuthor.stdout, /DEMO OLDER <OLDER@EXAMPLE\.TEST> \(1\)/);
  assert.match(byAuthor.stdout, /DEBT FINDER TESTS <TESTS@EXAMPLE\.INVALID> \(2\)/);
  assert.match(byAuthor.stdout, /Group: author\nFilters: includefresh=true/);
  assert.match(byAuthor.stdout, /Oldest: Demo Older <older@example\.test> · CODE · [\d,]+d · TODO/);
  assert.match(byAuthor.stdout, /[\d,]+d\s+CODE TODO/);
  assert.match(byAuthor.stdout, /[\d,]+d\s+BRANCH main/);
  const byAge = await invoke(["--group", "age", "--filter", "includefresh=true"]);
  assert.equal(byAge.status, 0, byAge.stderr);
  assert.match(byAge.stdout, /🪦  PROJECT GRAVEYARD — BY AGE/);
  assert.ok(byAge.stdout.indexOf("FOSSIL (1)") < byAge.stdout.indexOf("FRESH (2)"));
  const savedGrouped = await invoke(["--group", "author", "--filter", "includefresh=true",
    "--save", "--output", "./grouped.md", "--repo", relative(f.root, repo)], f.root);
  assert.equal(savedGrouped.status, 0, savedGrouped.stderr);
  const groupedMarkdown = readFileSync(join(f.root, "grouped.md"), "utf8");
  assert.match(groupedMarkdown, /# Graveyard — project debt grouped by author/);
  assert.match(groupedMarkdown, /\| Code \| TODO \|/);
  assert.match(groupedMarkdown, /\| Branch \| [a-f0-9]{40} \|/);
  const latestGrouped = await invoke(["--save", "latest", "--output", "./grouped-copy.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(latestGrouped.status, 0, latestGrouped.stderr);
  assert.equal(readFileSync(join(f.root, "grouped-copy.md"), "utf8"), groupedMarkdown);

  const summary = await invoke(["--summary"]);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /SUMMARY BY TYPE/);
  assert.match(summary.stdout, /TOTAL\s+1/);
  assert.match(summary.stdout, /Oldest: CODE · [\d,]+d · TODO · replace legacy route · main:legacy\.js:1/);
  assert.match(summary.stdout, /Summary: type\nFilters: includefresh=false/);
  const filteredSummary = await invoke(["--summary", "types", "--filter", "includefresh=true"]);
  assert.equal(filteredSummary.status, 0, filteredSummary.stderr);
  assert.match(filteredSummary.stdout, /CODE DEBT\s+2/);
  const savedSummary = await invoke(["--summary", "--save", "--output", "./summary.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(savedSummary.status, 0, savedSummary.stderr);
  const summaryMarkdown = readFileSync(join(f.root, "summary.md"), "utf8");
  assert.match(summaryMarkdown, /# Graveyard — summary by type/);
  assert.match(summaryMarkdown, /Total debt: 1/);
  assert.match(summaryMarkdown, /Oldest: CODE · \d+ days · TODO · replace legacy route · main:legacy\.js:1/);
  assert.ok(!summaryMarkdown.includes("| Age | Days |"));
  assert.ok(summaryMarkdown.includes(`*${savedSummary.stdout.trimEnd().split("\n").at(-2)}*`));
  const latestSummary = await invoke(["--save", "latest", "--output", "./summary-copy.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(latestSummary.status, 0, latestSummary.stderr);
  assert.equal(readFileSync(join(f.root, "summary-copy.md"), "utf8"), summaryMarkdown);
  const blameSummary = await invoke(["--summary", "blame", "--filter", "includefresh=true"]);
  assert.equal(blameSummary.status, 0, blameSummary.stderr);
  assert.match(blameSummary.stdout, /SUMMARY BY AUTHOR/);
  assert.match(blameSummary.stdout, /TOTAL 3/);
  assert.match(blameSummary.stdout, /Demo Older <older@example\.test>\s+1\s+·/);
  assert.match(blameSummary.stdout, /Debt Finder tests <tests@example\.invalid>\s+2\s+·/);
  assert.match(blameSummary.stdout, /Oldest: Demo Older <older@example\.test> · CODE · [\d,]+d · TODO/);
  const savedBlame = await invoke(["--summary", "blame", "--save", "--output", "./blame.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(savedBlame.status, 0, savedBlame.stderr);
  const blameMarkdown = readFileSync(join(f.root, "blame.md"), "utf8");
  assert.match(blameMarkdown, /# Graveyard — summary by author/);
  assert.match(blameMarkdown, /Demo Older &lt;older@example\.test&gt;/);
  assert.match(blameMarkdown, /Oldest: Demo Older &lt;older@example\.test&gt; · CODE · \d+ days · TODO/);
  assert.ok(!blameMarkdown.includes("| Age | Days |"));
  assert.ok(blameMarkdown.includes(`*${savedBlame.stdout.trimEnd().split("\n").at(-2)}*`));
  const latestBlame = await invoke(["--save", "latest", "--output", "./blame-copy.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(latestBlame.status, 0, latestBlame.stderr);
  assert.equal(readFileSync(join(f.root, "blame-copy.md"), "utf8"), blameMarkdown);

  const included = await invoke(["--filter", "includefresh=true", "--order", "newold"]);
  assert.equal(included.status, 0, included.stderr);
  assert.match(included.stdout, /TOTAL : 3\n\nCODE : 2  ·  BRANCHES : 1\nAGES /);
  assert.ok(included.stdout.indexOf("recent cleanup") < included.stdout.indexOf("replace legacy route"));
  assert.match(included.stdout, /Oldest: CODE · [\d,]+d · TODO · replace legacy route · main:legacy\.js:1/);

  const author = await invoke(["--filter", "author=OLDER", "--filter", "includefresh=true"]);
  assert.equal(author.status, 0, author.stderr);
  assert.match(author.stdout, /Filters: author=OLDER · includefresh=true/);
  assert.match(author.stdout, /CODE : 1/);
  assert.ok(!author.stdout.includes("recent cleanup"));

  const oneMarker = await invoke(["--markers", "FIXME", "--filter", "includefresh=true"]);
  assert.equal(oneMarker.status, 0, oneMarker.stderr);
  assert.match(oneMarker.stdout, /CODE : 1/);
  assert.ok(!oneMarker.stdout.includes("replace legacy route"));

  const remote = await invoke(["--remote", "--all", "--repo", relative(f.root, repo)], f.root);
  assert.equal(remote.status, 0, remote.stderr);
  assert.match(remote.stdout, /Branches scanned: remote\/origin\/main/);
  assert.match(remote.stdout, /origin\/main:legacy\.js:1/);
  assert.equal(readFileSync(configPath, "utf8"), beforeConfig);
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), beforeStatus);

  const destination = join(f.root, "saved.md");
  const saved = await invoke(["--save", "--repo", relative(f.root, repo),
    "--output", "./saved.md", "--filter", "includefresh=true"], f.root);
  assert.equal(saved.status, 0, saved.stderr);
  assert.match(saved.stdout, /Saved report:/);
  const markdown = readFileSync(destination, "utf8");
  assert.match(markdown, /# Graveyard — project debt/);
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
  assert.ok(!existsSync(join(repo, "debt-finder-reports")));
  const recovered = await invoke(["--save", "latest", "--output", "./recovered.md",
    "--repo", relative(f.root, repo)], f.root);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(readFileSync(join(f.root, "recovered.md"), "utf8"), /Code comments: 1/);
  mkdirSync(join(repo, "debt-finder-reports"));
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
    [["--filter", "type=issues"], /Only code and branches are available/],
  ]) {
    let stderr = "";
    const status = await runCli(["graveyard", ...args], { version: "0.0.0", cwd: f.root,
      env: { ...f.env, CI: "true" }, stderr: (text) => { stderr += text; } });
    assert.equal(status, 1);
    assert.match(stderr, message);
    assert.ok(!stderr.includes("Cannot resolve a Git working tree"));
  }
});

test("graveyard includes stale local and remote branches in reports and summaries", async (t) => {
  const f = fixture(t), repo = f.repository();
  f.writeConfig(repo);
  writeFileSync(join(repo, "plain.txt"), "old branch\n");
  f.git(repo, ["add", "plain.txt"]);
  await runGit(["-c", "commit.gpgSign=false", "-c", "user.name=Old Branch Author",
    "-c", "user.email=old-branch@example.test", "commit", "--quiet", "-m", "old branch"],
  { cwd: repo, env: { ...f.env, GIT_AUTHOR_DATE: "2020-01-01T12:00:00Z",
    GIT_COMMITTER_DATE: "2020-01-01T12:00:00Z" } });
  const oldCommit = f.git(repo, ["rev-parse", "HEAD"]);
  f.git(repo, ["branch", "legacy"]);
  f.git(repo, ["update-ref", "refs/remotes/origin/legacy", oldCommit]);
  writeFileSync(join(repo, "plain.txt"), "recent branch\n");
  f.git(repo, ["add", "plain.txt"]);
  f.git(repo, ["commit", "--quiet", "-m", "recent branch"]);

  const normal = await f.invoke(["graveyard"], repo);
  assert.equal(normal.status, 0, normal.stderr);
  assert.match(normal.stdout, /TOTAL : 1\n\nCODE : 0  ·  BRANCHES : 1\nAGES /);
  assert.match(normal.stdout, /CODE DEBT/);
  assert.match(normal.stdout, /STALE BRANCHES/);
  assert.match(normal.stdout, /legacy/);
  assert.match(normal.stdout, /Oldest: BRANCH · [\d,]+d · legacy · [a-f0-9]{10}/);
  assert.ok(!normal.stdout.includes("recent branch"));

  const codeOnly = await f.invoke(["graveyard", "--filter", "type=code"], repo);
  assert.equal(codeOnly.status, 0, codeOnly.stderr);
  assert.match(codeOnly.stdout, /TOTAL : 0/);
  const branchOnly = await f.invoke(["graveyard", "--filter", "type=branches",
    "--filter", "author=old-branch@example.test"], repo);
  assert.equal(branchOnly.status, 0, branchOnly.stderr);
  assert.match(branchOnly.stdout, /TOTAL : 1/);
  const wrongAuthor = await f.invoke(["graveyard", "--filter", "type=branches",
    "--filter", "author=nobody"], repo);
  assert.equal(wrongAuthor.status, 0, wrongAuthor.stderr);
  assert.match(wrongAuthor.stdout, /TOTAL : 0/);

  const types = await f.invoke(["graveyard", "--summary"], repo);
  assert.equal(types.status, 0, types.stderr);
  assert.match(types.stdout, /STALE BRANCHES\s+1/);
  assert.match(types.stdout, /Oldest: BRANCH · [\d,]+d · legacy · [a-f0-9]{10}/);
  const authors = await f.invoke(["graveyard", "--summary", "blame"], repo);
  assert.equal(authors.status, 0, authors.stderr);
  assert.match(authors.stdout, /Old Branch Author <old-branch@example\.test> \(branches\)\s+1\s+·/);

  const saved = await f.invoke(["graveyard", "--save", "--output", "./branch-report.md"], repo);
  assert.equal(saved.status, 0, saved.stderr);
  const markdown = readFileSync(join(repo, "branch-report.md"), "utf8");
  assert.match(markdown, /Stale branches: 1/);
  assert.match(markdown, /\| legacy \| Old Branch Author \|/);

  const remote = await f.invoke(["graveyard", "--remote"], repo);
  assert.equal(remote.status, 0, remote.stderr);
  assert.match(remote.stdout, /BRANCHES : 1/);
  assert.match(remote.stdout, /origin\/legacy/);
});

test("graveyard links exact code lines and branch commits for matching hosted remotes", async (t) => {
  const f = fixture(t), repo = f.repository();
  f.writeConfig(repo);
  writeFileSync(join(repo, "old code.js"), "// TODO: old code\n");
  f.git(repo, ["add", "old code.js"]);
  await runGit(["-c", "commit.gpgSign=false", "-c", "user.name=Link Author",
    "-c", "user.email=links@example.test", "commit", "--quiet", "-m", "old code"],
    { cwd: repo, env: { ...f.env, GIT_AUTHOR_DATE: "2020-01-01T12:00:00Z",
      GIT_COMMITTER_DATE: "2020-01-01T12:00:00Z" } });
  const commit = f.git(repo, ["rev-parse", "HEAD"]);
  f.git(repo, ["remote", "add", "origin", "git@github.com:example/debt-finder.git"]);
  const local = await f.invoke(["graveyard", "--save", "--output", "./linked.md"], repo,
    { ...f.env, TERM_PROGRAM: "vscode" });
  assert.equal(local.status, 0, local.stderr);
  const editorLink = `vscode://file${pathToFileURL(join(repo, "old code.js")).pathname}:1:1`;
  assert.ok(local.stdout.includes(`\u001b]8;;${editorLink}\u0007main:old code.js:1\u001b]8;;\u0007`));
  assert.ok(local.stdout.includes(`\u001b]8;;https://github.com/example/debt-finder/commit/${commit}\u0007${commit.slice(0, 10)}\u001b]8;;\u0007`));
  const markdown = readFileSync(join(repo, "linked.md"), "utf8");
  assert.ok(markdown.includes(`[main:old code.js:1](https://github.com/example/debt-finder/blob/${commit}/old%20code.js#L1)`));
  assert.ok(markdown.includes(`[${commit}](https://github.com/example/debt-finder/commit/${commit})`));
  const latest = await f.invoke(["graveyard", "--save", "latest", "--output", "./linked-copy.md"], repo);
  assert.equal(latest.status, 0, latest.stderr);
  assert.equal(readFileSync(join(repo, "linked-copy.md"), "utf8"), markdown);

  f.git(repo, ["remote", "add", "upstream", "git@gitlab.example.test:group/project.git"]);
  f.git(repo, ["update-ref", "refs/remotes/upstream/main", commit]);
  writeFileSync(join(repo, "old code.js"), "// TODO: changed locally\n");
  const remote = await f.invoke(["graveyard", "--remote"], repo);
  assert.equal(remote.status, 0, remote.stderr);
  assert.ok(remote.stdout.includes(`https://gitlab.example.test/group/project/-/blob/${commit}/old%20code.js#L1`));
  assert.ok(remote.stdout.includes(`https://gitlab.example.test/group/project/-/commit/${commit}`));
  assert.ok(!remote.stdout.includes("https://github.com/example/debt-finder/blob/"));

  f.git(repo, ["remote", "set-url", "origin", "https://example.test/team/project.git"]);
  const unsupported = await f.invoke(["graveyard"], repo);
  assert.equal(unsupported.status, 0, unsupported.stderr);
  assert.ok(!unsupported.stdout.includes("\u001b]8;;"));
  assert.match(unsupported.stdout, /main:old code\.js:1/);
});
