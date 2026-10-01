import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { fixture } from "../helpers/config-fixture.mjs";
import { createRubyCommentExtractor } from "../../dist/scanners/comments/ruby-tool.js";
import { discoverRubyExecutables, runRuby } from "../../dist/scanners/comments/ruby-runtime.js";
import { rubyHelper } from "../../dist/scanners/comments/ruby-helper.js";

const executable = resolve("test-ruby", "ruby.exe");
const supported = { protocol: 1, compatible: true, status: "ok", version: "3.4.1" };
const ok = (spans) => ({ protocol: 1, version: "3.4.1", status: "ok", spans });
function runtime(outputs, candidates = [executable]) {
  const calls = [];
  return { calls, discover: async () => candidates, run: async (...args) => {
    calls.push(args); const value = outputs.shift();
    if (value instanceof Error) throw value;
    return typeof value === "string" ? value : JSON.stringify(value);
  } };
}

test("Ruby official extraction converts byte offsets to original UTF-16 and preserves block bodies", async () => {
  const source = '\ufeffx="😀" # hi\r\n=begin\r\nbody\r\n=end\r\n';
  const clean = source.slice(1), bytes = (at) => Buffer.byteLength(clean.slice(0, at));
  const start = clean.indexOf('#'), lineEnd = clean.indexOf('\r');
  const block = clean.indexOf('=begin'), bodyStart = clean.indexOf('body'), bodyEnd = clean.indexOf('=end');
  const fake = runtime([supported, ok([['line', bytes(start), bytes(lineEnd), bytes(start + 1), bytes(lineEnd)],
    ['block', bytes(block), bytes(bodyEnd + 4), bytes(bodyStart), bytes(bodyEnd)]])]);
  const extractor = await createRubyCommentExtractor({}, fake);
  const result = await extractor.extract(source);
  assert.equal(extractor.backend.kind, "official");
  assert.equal(result.status, "ok");
  assert.deepEqual(result.comments.map((c) => c.text), [' hi', 'body\r\n']);
  assert.deepEqual(result.comments[0].start, { offset: 8, line: 1, column: 9 });
  assert.equal(fake.calls[0][1], rubyHelper);
  assert.deepEqual(JSON.parse(fake.calls[1][2]), { source: clean });
});

for (const unavailable of [new Error("ENOENT"), new Error("timeout"), "bad JSON", { ...supported, compatible: false },
  { ...supported, version: "2.7.0" }, { ...supported, version: "4.0.0" }, { ...supported, protocol: 2 }]) {
  test("Ruby incompatible/unavailable probe chooses the labelled fallback: " + JSON.stringify(unavailable), async () => {
    const extractor = await createRubyCommentExtractor({}, runtime([unavailable]));
    assert.equal(extractor.backend.kind, "builtin");
    assert.ok(extractor.backend.reason);
    assert.equal((await extractor.extract('# TODO')).comments[0].text, ' TODO');
    assert.equal((await extractor.extract('%q{hidden}')).status, 'unsupported');
  });
}

test("Ruby explicit modes, absent PATH tools and absolute executable selection", async () => {
  assert.equal((await createRubyCommentExtractor({}, runtime([], []))).backend.kind, 'builtin');
  await assert.rejects(createRubyCommentExtractor({ mode: 'official' }, runtime([], [])), /unavailable/);
  const never = { discover() { throw Error('unexpected discovery'); }, run() { throw Error('unexpected launch'); } };
  assert.equal((await createRubyCommentExtractor({ mode: 'builtin' }, never)).backend.kind, 'builtin');
  const fake = runtime([supported]); fake.discover = never.discover;
  assert.equal((await createRubyCommentExtractor({ executable }, fake)).backend.executable, executable);
  await assert.rejects(createRubyCommentExtractor({ executable: 'ruby' }, never), /absolute/);
  await assert.rejects(createRubyCommentExtractor({ mode: 'other' }, never), /Unknown/);
});

test("Ruby syntax errors remain diagnostics and do not trigger fallback", async () => {
  const fake = runtime([supported, { ...ok([]), status: 'invalid', message: 'syntax error' }]);
  const result = await (await createRubyCommentExtractor({}, fake)).extract('# prior\nx =');
  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.comments, []);
  assert.equal(fake.calls.length, 2);
});

for (const bad of [new Error('timeout'), 'invalid JSON', {}, { ...ok([]), version: '3.3.0' },
  ok([['line', 0, 900, 1, 900]]), ok([['line', 0, 5, 1, 5]]), ok([['line', 0, 6, 1, 6], ['line', 0, 6, 1, 6]]),
  ok([['block', 0, 6, 1, 6]]), ok([['line', 0.5, 6, 1, 6]])]) {
  test("Ruby broken extraction never silently falls back: " + JSON.stringify(bad), async () => {
    const fake = runtime([supported, bad]);
    await assert.rejects((await createRubyCommentExtractor({}, fake)).extract('# TODO'), /no fallback/);
  });
}

test("Ruby rejects positions inside a UTF-8 character", async () => {
  const fake = runtime([supported, ok([['line', 1, 7, 2, 7]])]);
  await assert.rejects((await createRubyCommentExtractor({}, fake)).extract('😀# x'), /no fallback/);
});

test("Ruby source restrictions and size limits run before invoking Ripper", async () => {
  const fake = runtime([supported]);
  const extractor = await createRubyCommentExtractor({}, fake);
  assert.equal((await extractor.extract('# coding: latin-1')).status, 'unsupported');
  await assert.rejects(extractor.extract('x'.repeat(8 * 1024 * 1024 + 1)), /8 MiB/);
  assert.equal(fake.calls.length, 1);
});

test("Ruby discovery skips relative paths and aliases and only selects existing files", async (t) => {
  const f = fixture(t), bin = join(f.root, 'bin'), aliases = join(f.root, 'WindowsApps');
  mkdirSync(bin); mkdirSync(aliases);
  const name = process.platform === 'win32' ? 'ruby.exe' : 'ruby';
  writeFileSync(join(bin, name), 'fixture only', { mode: 0o700 });
  writeFileSync(join(aliases, name), 'not selected', { mode: 0o700 });
  assert.deepEqual(await discoverRubyExecutables({ PATH: ['', '.', aliases, bin, bin].join(delimiter) }), [join(bin, name)]);
  await assert.rejects(runRuby('ruby', '', '', {}), /absolute/);
});
