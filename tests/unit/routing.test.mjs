import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../../dist/program.js";

async function invoke(args) {
  const calls = [];
  let stdout = "";
  let stderr = "";
  const handlers = Object.fromEntries(
    ["graveyard", "config", "init"].map((command) => [
      command, (options) => { calls.push({ command, options }); },
    ]),
  );
  const status = await runCli(args, {
    version: "1.2.3",
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    handlers,
  });
  return { status, stdout, stderr, calls };
}

const routes = [
  [["graveyard"], "graveyard", {}],
  [["config"], "config", {}],
  [["init", "--repo", "../other project"], "init", { repo: "../other project" }],
  [["init", "--dry-run", "--repo", "../other project"], "init", { dryRun: true, repo: "../other project" }],
  [["graveyard", "--summary"], "graveyard", { summary: "types" }],
  [["graveyard", "--summary", "types"], "graveyard", { summary: "types" }],
  [["graveyard", "--save", "--summary", "blame", "--filter", "includefresh=false"],
    "graveyard", { save: true, summary: "blame", filter: { includeFresh: false } }],
  [["graveyard", "--summary", "--save"], "graveyard", { summary: "types", save: true }],
  [["graveyard", "--save", "latest", "--repo", "../other", "--output", "./reports/a.md"],
    "graveyard", { save: "latest", repo: "../other", output: "./reports/a.md" }],
  [["graveyard", "--remote", "--all", "--order", "newold", "--fresh", "60",
    "--markers", "TO DO,FIXME", "--filter", "type=code,branches", "--filter", "author=Alex Smith"],
    "graveyard", { remote: true, all: true, order: "newold", fresh: 60, markers: ["TO DO", "FIXME"],
      filter: { type: ["code", "branches"], author: "Alex Smith" } }],
  [["graveyard", "--fresh", "0", "--ageing", "60", "--buried", "120"],
    "graveyard", { fresh: 0, ageing: 60, buried: 120 }],
  [["config", "--set", "fresh=30", "ageing=60", "buried=120"],
    "config", { set: ["fresh=30", "ageing=60", "buried=120"] }],
  [["config", "--add", "markers=TO DO,FIXME"], "config", { add: "markers=TO DO,FIXME" }],
  [["config", "--remove", "markers=HACK"], "config", { remove: "markers=HACK" }],
  [["config", "--list"], "config", { list: true }],
  [["config", "--list", "markers"], "config", { list: "markers" }],
  [["--global", "config", "--set", "fresh=60"], "config", { global: true, set: ["fresh=60"] }],
  [["config", "--global", "--list"], "config", { global: true, list: true }],
  [["--repo", "../other", "--global", "config", "--copy-from", "repo"],
    "config", { global: true, repo: "../other", copyFrom: "repo" }],
  [["config", "--copy-from", "global", "--repo", "../other"],
    "config", { repo: "../other", copyFrom: "global" }],
];

for (const [args, command, options] of routes) {
  test(`routes: ${args.join(" ")}`, async () => {
    const result = await invoke(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.calls, [{ command, options }]);
  });
}

for (const args of [[], ["--help"], ["-h"], ["--version"], ["-V"],
  ["graveyard", "--help"], ["config", "--help"], ["init", "--help"], ["help", "config"],
  ["--global", "config", "--help"]]) {
  test(`help/version never dispatch: ${args.join(" ") || "no arguments"}`, async () => {
    const result = await invoke(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.calls, []);
    assert.match(result.stdout, args.some((arg) => ["--version", "-V"].includes(arg))
      ? /^1\.2\.3\n$/ : /Usage: debt-watcher/);
  });
}

const invalid = [
  [["unknown"], /unknown command/],
  [["graveyard", "save"], /too many arguments/],
  [["config", "set", "fresh=60"], /too many arguments/],
  [["graveyard", "--blame"], /unknown option/],
  [["graveyard", "--fossil", "365"], /unknown option/],
  [["graveyard", "--include-fresh"], /unknown option/],
  [["config", "--setup"], /unknown option/],
  [["init", "--summary"], /unknown option/],
  [["graveyard", "--global"], /only valid with the config/],
  [["--global", "init"], /only valid with the config/],
  [["config", "--global", "--repo", "../other", "--list"], /requires config --copy-from repo/],
  [["config", "--copy-from", "repo"], /use --copy-from global/],
  [["--global", "config", "--copy-from", "global"], /use --copy-from repo/],
  [["graveyard", "--summary", "authors"], /Allowed choices/],
  [["graveyard", "--save", "new"], /Allowed choices/],
  [["graveyard", "--save", "report.md"], /Allowed choices/],
  [["graveyard", "--order", "reverse"], /Allowed choices/],
  [["graveyard", "--output", "./report.md"], /requires --save/],
  [["graveyard", "--repo"], /argument missing/],
  [["graveyard", "--repo", " "], /must not be empty/],
  [["graveyard", "--fresh", "-1"], /whole number/],
  [["graveyard", "--fresh", "60days"], /whole number/],
  [["graveyard", "--fresh", "1.5"], /whole number/],
  [["graveyard", "--fresh", "9007199254740992"], /whole number/],
  [["graveyard", "--filter", "author="], /non-empty/],
  [["graveyard", "--filter", "unknown=value"], /Unknown filter/],
  [["graveyard", "--filter", "type=banana"], /Debt types/],
  [["graveyard", "--filter", "includefresh=yes"], /must be true or false/],
  [["graveyard", "--filter", "author=Alex", "--filter", "author=Pat"], /Duplicate filter/],
  [["graveyard", "--filter", "includefresh=false", "--filter", "includefresh=true"], /Duplicate filter/],
  [["graveyard", "--markers", "TODO,,FIXME"], /empty entries/],
  [["config", "--set", "fresh"], /key=value/],
  [["config", "--set", "fresh="], /non-empty/],
  [["config", "--set", "fresh=30", "fresh=60"], /Duplicate setting/],
  [["config", "--add", "fresh=30"], /only markers/],
  [["config", "--remove", "markers=TODO,"], /empty entries/],
];

for (const [args, pattern] of invalid) {
  test(`rejects: ${args.join(" ")}`, async () => {
    const result = await invoke(args);
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, pattern);
    assert.equal(result.stderr.match(/error:/g)?.length, 1, "Print each error only once");
  });
}

for (const change of [["--summary"], ["--order", "oldnew"], ["--filter", "includefresh=false"],
  ["--fresh", "60"], ["--ageing", "60"], ["--buried", "120"],
  ["--markers", "TODO"], ["--remote"], ["--all"]]) {
  test(`latest snapshot rejects ${change[0]}`, async () => {
    const result = await invoke(["graveyard", "--save", "latest", ...change]);
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
    assert.match(result.stderr, /--save latest cannot be combined/);
  });
}

const actions = [["--set", "fresh=60"], ["--add", "markers=TODO"],
  ["--remove", "markers=HACK"], ["--list"], ["--copy-from", "global"]];
for (let first = 0; first < actions.length; first++) {
  for (let second = first + 1; second < actions.length; second++) {
    test(`config actions conflict: ${actions[first][0]} and ${actions[second][0]}`, async () => {
      const result = await invoke(["config", ...actions[first], ...actions[second]]);
      assert.equal(result.status, 1);
      assert.deepEqual(result.calls, []);
      assert.match(result.stderr, /cannot be used with/);
    });
  }
}

test("scope options without a command show usage and fail without dispatch", async () => {
  const result = await invoke(["--global"]);
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, []);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Usage: debt-watcher/);
});

test("waits for async handlers and reports their failures without a stack trace", async () => {
  let stderr = "";
  const status = await runCli(["init"], {
    version: "1.2.3",
    stderr: (text) => { stderr += text; },
    handlers: { init: async () => { await Promise.resolve(); throw new Error("Example failure"); } },
  });
  assert.equal(status, 1);
  assert.equal(stderr, "error: Example failure\n");
});
