import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fixture } from '../helpers/config-fixture.mjs';
import { extractGoComments } from '../../dist/scanners/comments/go.js';
import { goHelper } from '../../dist/scanners/comments/go-helper.js';
import { createGoCommentExtractor } from '../../dist/scanners/comments/go-tool.js';
import { discoverGoExecutables } from '../../dist/scanners/comments/go-runtime.js';

const executable = resolve('test-go', process.platform === 'win32' ? 'go.exe' : 'go');
const utf8 = (source, offset) => Buffer.byteLength(source.slice(0, offset), 'utf8');
function reply(source, version = 'go1.27.1') {
  const result = extractGoComments(source);
  if (result.status !== 'ok') return { protocol: 1, version, status: 'invalid', offset: utf8(source, result.diagnostic.position.offset), message: result.diagnostic.message };
  return { protocol: 1, version, status: 'ok', spans: result.comments.map((c) =>
    [c.kind, utf8(source, c.start.offset), utf8(source, c.end.offset)]) };
}
function runtime({ version = 'go1.27.1', badProbe, badResponse, candidates = [executable] } = {}) {
  const calls = [], closed = [];
  return { calls, closed, discover: async () => candidates, prepare: async (path, program, env) => {
    calls.push({ type: 'prepare', path, program, env });
    return { async run(input) {
      const source = JSON.parse(input).source;
      calls.push({ type: 'run', source });
      const isProbe = calls.filter((c) => c.type === 'run').length === 1;
      return JSON.stringify(isProbe ? badProbe ?? reply(source, version) : badResponse ?? reply(source, version));
    }, async close() { closed.push(path); } };
  } };
}

test('Go selects the official scanner once and keeps committed source out of its program', async () => {
  const fake = runtime();
  const selected = await createGoCommentExtractor({}, fake);
  assert.deepEqual(selected.backend, { kind: 'official', name: 'go-scanner', version: 'go1.27.1', executable });
  const source = '\ufeffvar s = "😀// hidden" // real\r\n/* block\r\nbody */';
  assert.deepEqual(await selected.extract(source), extractGoComments(source));
  assert.deepEqual(await selected.extract(''), { status: 'ok', comments: [] });
  assert.equal(fake.calls[0].program, goHelper);
  assert.ok(!fake.calls[0].program.includes(source));
  assert.equal(fake.calls.filter((c) => c.type === 'prepare').length, 1);
  await selected.close();
  assert.deepEqual(fake.closed, [executable]);
});

for (const badProbe of [{}, { ...reply('// x'), version: 'go1.19.0' },
  { ...reply('// x'), version: 'go1.28.0' }, { ...reply('// x'), protocol: 2 },
  { ...reply('// x'), spans: [] }]) {
  test('Go incompatible probe selects labelled fallback and closes helper: ' + JSON.stringify(badProbe), async () => {
    const fake = runtime({ badProbe });
    const selected = await createGoCommentExtractor({}, fake);
    assert.equal(selected.backend.kind, 'builtin');
    assert.ok(selected.backend.reason);
    assert.deepEqual(fake.closed, [executable]);
    assert.deepEqual((await selected.extract('// real')).comments.map((c) => c.text), [' real']);
    await selected.close();
  });
}

test('Go explicit modes, source limit, missing runtime and interpreter selection', async () => {
  const never = { discover() { throw Error('unexpected discovery'); }, prepare() { throw Error('unexpected build'); } };
  assert.equal((await createGoCommentExtractor({ mode: 'builtin' }, never)).backend.kind, 'builtin');
  await assert.rejects(createGoCommentExtractor({ mode: 'official' }, runtime({ candidates: [] })), /unavailable/);
  await assert.rejects(createGoCommentExtractor({ executable: 'go' }, never), /absolute/);
  await assert.rejects(createGoCommentExtractor({ executable, mode: 'builtin' }, never), /requires/);
  await assert.rejects(createGoCommentExtractor({ mode: 'other' }, never), /Unknown/);
  const selected = await createGoCommentExtractor({ executable }, runtime());
  assert.equal(selected.backend.executable, executable);
  await assert.rejects(selected.extract('#'.repeat(8 * 1024 * 1024 + 1)), /8 MiB/);
  await selected.close();
});

test('Go source diagnostics prevent official launch and no partial comments escape', async () => {
  const fake = runtime();
  const selected = await createGoCommentExtractor({}, fake);
  const calls = fake.calls.length;
  const result = await selected.extract('// before\n"\u0000"');
  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.comments, []);
  assert.equal(fake.calls.length, calls);
  await selected.close();
});

for (const badResponse of [{}, { protocol: 1, status: 'ok', version: 'go1.27.1', spans: [['line', 0, 99]] },
  { protocol: 1, status: 'ok', version: 'go1.27.1', spans: [['line', 1, 7]] },
  { protocol: 1, status: 'ok', version: 'go1.27.1', spans: [['line', 0, 7], ['line', 0, 7]] },
  { protocol: 1, status: 'ok', version: 'go1.26.0', spans: [] },
  { protocol: 1, status: 'invalid', version: 'go1.27.1', offset: 999, message: 'bad' }]) {
  test('Go malformed helper output fails without fallback: ' + JSON.stringify(badResponse), async () => {
    const selected = await createGoCommentExtractor({}, runtime({ badResponse }));
    await assert.rejects(selected.extract('// real'), /no fallback/);
    await selected.close();
  });
}

test('Go official syntax errors return a source diagnostic with no partial comments', async () => {
  const selected = await createGoCommentExtractor({}, runtime());
  const result = await selected.extract('// before\n"unfinished');
  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.comments, []);
  assert.equal(result.diagnostic.position.line, 2);
  const first = await selected.extract('"unterminated');
  assert.equal(first.status, 'invalid');
  assert.equal(first.diagnostic.position.offset, 0);
  await selected.close();
});

test('Go executable discovery ignores relative paths and Windows aliases', async (t) => {
  const f = fixture(t), bin = join(f.root, 'bin'), aliases = join(f.root, 'WindowsApps');
  mkdirSync(bin); mkdirSync(aliases);
  const name = process.platform === 'win32' ? 'go.exe' : 'go';
  writeFileSync(join(bin, name), '', { mode: 0o700 });
  writeFileSync(join(aliases, name), '', { mode: 0o700 });
  assert.deepEqual(await discoverGoExecutables({ PATH: ['relative', aliases, bin, bin].join(delimiter) }), [join(bin, name)]);
});
