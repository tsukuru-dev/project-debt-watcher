import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { fixture } from "../helpers/config-fixture.mjs";
import { createPythonCommentExtractor } from "../../dist/scanners/comments/python-tool.js";
import { discoverPythonExecutables, runPython } from "../../dist/scanners/comments/python-runtime.js";
import { pythonProbe, pythonTokenize } from "../../dist/scanners/comments/python-helper.js";

const executable = resolve("test-python", "python.exe");
const supported = { protocol: 1, compatible: true, version: [3, 14, 0] };
function runtime(outputs = [], candidates = [executable]) {
  const calls = [];
  return { calls, discover: async () => candidates, run: async (...args) => {
    calls.push(args);
    const value = outputs.shift();
    if (value instanceof Error) throw value;
    return typeof value === "string" ? value : JSON.stringify(value);
  } };
}

test("Python selects the official tool once and keeps source text out of its program", async () => {
  const fake = runtime([supported, { protocol: 1, version: [3, 14, 0], status: "ok", spans: [[1, 0, 6]] },
    { protocol: 1, version: [3, 14, 0], status: "ok", spans: [] }]);
  const selected = await createPythonCommentExtractor({}, fake);
  assert.deepEqual(selected.backend, { kind: "official", name: "python-tokenize", version: "3.14.0", executable });
  assert.equal((await selected.extract("# TODO")).comments[0].text, " TODO");
  await selected.extract('raise RuntimeError("not executed")');
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls[0][1], pythonProbe);
  assert.equal(fake.calls[1][1], pythonTokenize);
  assert.equal(fake.calls[1][2], JSON.stringify("# TODO"));
});

test("Python token columns map code points to original BOM/CRLF/CR/UTF-16 offsets", async () => {
  const source = '\ufeffx="😀" # one\r\n#two\r#';
  const fake = runtime([supported, { protocol: 1, version: [3, 14, 0], status: "ok", spans: [[1, 6, 11], [2, 0, 4], [3, 0, 1]] }]);
  const result = await (await createPythonCommentExtractor({}, fake)).extract(source);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.comments.map((c) => c.raw), ["# one", "#two", "#"]);
  assert.deepEqual(result.comments[0].start, { offset: 8, line: 1, column: 9 });
  for (const c of result.comments) assert.equal(source.slice(c.start.offset, c.end.offset), c.raw);
});

for (const unavailable of [undefined, new Error("ENOENT"), new Error("timeout"), "not JSON",
  { ...supported, compatible: false }, { ...supported, version: [2, 7, 18] },
  { ...supported, version: [3, 11, 9] }, { ...supported, version: [3, 15, 0] },
  { ...supported, protocol: 2 }]) {
  test("Python unavailability/incompatibility selects a labelled limited fallback: " + JSON.stringify(unavailable), async () => {
    const fake = runtime([unavailable], unavailable === undefined ? [] : [executable]);
    const selected = await createPythonCommentExtractor({}, fake);
    assert.equal(selected.backend.kind, "builtin");
    assert.ok(selected.backend.reason);
    assert.deepEqual((await selected.extract('x="# hidden" # real')).comments.map((c) => c.text), [" real"]);
    assert.equal((await selected.extract('f"{x}"')).status, "unsupported");
  });
}

test("Python discovery tries the next installed candidate when the first is incompatible", async () => {
  const second = resolve("another-python", "python.exe");
  const fake = runtime([{ ...supported, version: [3, 9, 0] }, supported], [executable, second]);
  assert.equal((await createPythonCommentExtractor({}, fake)).backend.executable, second);
});

test("Python 3.12 and 3.13 are eligible only after passing the capability probe", async () => {
  for (const minor of [12, 13]) {
    const fake = runtime([{ ...supported, version: [3, minor, 1] }]);
    assert.equal((await createPythonCommentExtractor({}, fake)).backend.version, `3.${minor}.1`);
  }
});

test("Python source size is bounded before official launch or fallback scanning", async () => {
  const source = "#" + "x".repeat(8 * 1024 * 1024);
  const fake = runtime([supported]);
  await assert.rejects((await createPythonCommentExtractor({}, fake)).extract(source), /8 MiB/);
  assert.equal(fake.calls.length, 1);
  await assert.rejects((await createPythonCommentExtractor({ mode: "builtin" })).extract(source), /8 MiB/);
});

test("Python explicit modes and interpreter selection provide reproducible internal controls", async () => {
  const never = { discover() { throw Error("unexpected discovery"); }, run() { throw Error("unexpected launch"); } };
  assert.equal((await createPythonCommentExtractor({ mode: "builtin" }, never)).backend.kind, "builtin");
  await assert.rejects(createPythonCommentExtractor({ mode: "official" }, runtime([], [])), /unavailable/);
  const fake = runtime([supported]);
  fake.discover = never.discover;
  assert.equal((await createPythonCommentExtractor({ executable }, fake)).backend.executable, executable);
  await assert.rejects(createPythonCommentExtractor({ executable: "python" }, never), /absolute/);
  await assert.rejects(createPythonCommentExtractor({ mode: "builtin", executable }, never), /requires/);
  await assert.rejects(createPythonCommentExtractor({ mode: "other" }, never), /Unknown/);
});

for (const status of ["invalid", "unsupported"]) {
  test("Python source diagnostic does not fall back: " + status, async () => {
    const fake = runtime([supported, { protocol: 1, version: [3, 14, 0], status, line: 2, column: 100, message: "Source problem" }]);
    const result = await (await createPythonCommentExtractor({}, fake)).extract("# before\r\nx");
    assert.equal(result.status, status);
    assert.deepEqual(result.comments, []);
    assert.deepEqual(result.diagnostic.position, { offset: 11, line: 2, column: 2 });
    assert.equal(fake.calls.length, 2);
  });
}

for (const bad of [new Error("timeout"), new Error("output limit"), "garbage", {},
  { protocol: 1, version: [3, 13, 0], status: "ok", spans: [] },
  ...[[[1, 0, 999]], [[1, 1, 6]], [[1, 0, 5]], [[0, 0, 1]], [[2, 0, 1]], [[1, -1, 6]],
    [[1, 0, 6], [1, 0, 6]], ["bad"]].map((spans) => ({ protocol: 1, version: [3, 14, 0], status: "ok", spans }))]) {
  test("Python failed/malformed extraction never becomes fallback success: " + JSON.stringify(bad), async () => {
    const fake = runtime([supported, bad]);
    const selected = await createPythonCommentExtractor({}, fake);
    await assert.rejects(selected.extract("# TODO"), /no fallback/);
    assert.equal(fake.calls.length, 2);
  });
}

test("Python executable discovery ignores relative PATH entries and Store aliases", async (t) => {
  const f = fixture(t), bin = join(f.root, "bin"), aliases = join(f.root, "WindowsApps");
  mkdirSync(bin); mkdirSync(aliases);
  const name = process.platform === "win32" ? "python.exe" : "python";
  writeFileSync(join(bin, name), "fixture only", { mode: 0o700 });
  writeFileSync(join(aliases, name), "must not select", { mode: 0o700 });
  const result = await discoverPythonExecutables({ PATH: ["", ".", "relative", aliases, bin, bin].join(delimiter) });
  assert.deepEqual(result, [join(bin, name)]);
  assert.deepEqual(await discoverPythonExecutables({}), []);
});

test("Python runner rejects launchers and relative paths before starting a process", async () => {
  await assert.rejects(runPython("python", "", "", {}), /absolute/);
  await assert.rejects(runPython(resolve("py.exe"), "", "", {}), /launcher/);
  await assert.rejects(runPython(resolve("WindowsApps", "python.exe"), "", "", {}), /alias/);
});
