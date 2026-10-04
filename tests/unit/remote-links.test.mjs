import assert from "node:assert/strict";
import { test } from "node:test";
import { commitPermalink, parseHostedRemote, sourcePermalink } from "../../dist/git/remotes.js";

const commit = "a".repeat(40);

test("GitHub and GitLab remotes yield commit-pinned links with encoded paths", () => {
  const github = parseHostedRemote("git@github.com:team/project.git");
  assert.deepEqual(github, { provider: "github", webBase: "https://github.com/team/project/" });
  assert.equal(sourcePermalink(github, commit, "src/a b#c.ts", 12),
    `https://github.com/team/project/blob/${commit}/src/a%20b%23c.ts#L12`);
  assert.equal(commitPermalink(github, commit), `https://github.com/team/project/commit/${commit}`);

  const gitlab = parseHostedRemote("ssh://git@gitlab.example.test:2222/group/sub/project.git");
  assert.deepEqual(gitlab, { provider: "gitlab", webBase: "https://gitlab.example.test/group/sub/project/" });
  assert.equal(sourcePermalink(gitlab, commit, "src/a b.ts", 7),
    `https://gitlab.example.test/group/sub/project/-/blob/${commit}/src/a%20b.ts#L7`);
  assert.equal(commitPermalink(gitlab, commit),
    `https://gitlab.example.test/group/sub/project/-/commit/${commit}`);
  assert.deepEqual(parseHostedRemote("git@git.example.test:group/project.git",
    { gitlabHost: "git.example.test" }),
  { provider: "gitlab", webBase: "https://git.example.test/group/project/" });
});

test("unsupported or unsafe remote data stays unlinked", () => {
  assert.equal(parseHostedRemote("https://example.test/team/project.git"), undefined);
  assert.equal(parseHostedRemote("file:///private/repo.git"), undefined);
  assert.equal(parseHostedRemote("https://github.com/team/project.git?token=secret"), undefined);
  assert.equal(parseHostedRemote("git@github.com:team/../project.git"), undefined);
  const remote = parseHostedRemote("https://user:secret@github.com/team/project.git");
  assert.equal(remote.webBase, "https://github.com/team/project/");
  assert.equal(sourcePermalink(remote, commit, "../secret.ts", 1), undefined);
  assert.equal(sourcePermalink(remote, commit, "src/code.ts", 0), undefined);
  assert.equal(commitPermalink(remote, "not-a-commit"), undefined);
});
