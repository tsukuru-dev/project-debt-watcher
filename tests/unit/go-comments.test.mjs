import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractGoComments } from '../../dist/scanners/comments/go.js';

function extract(source) {
  const result = extractGoComments(source);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  for (const c of result.comments) {
    assert.equal(source.slice(c.start.offset, c.end.offset), c.raw);
    assert.equal(source.slice(c.contentStart.offset, c.contentEnd.offset), c.text);
  }
  return result.comments;
}
const bodies = (source) => extract(source).map((c) => c.text);

test('Go extracts line, block, empty, adjacent and EOF comments', () => {
  assert.deepEqual(bodies('// first\n/**//* second *///last'), [' first', '', ' second ', 'last']);
  assert.deepEqual(bodies(''), []);
  assert.deepEqual(bodies('package main\n'), []);
  assert.deepEqual(bodies('//'), ['']);
  assert.deepEqual(extract('/* first\nsecond */').map((c) => c.kind), ['block']);
});

test('Go blocks do not nest and comment contents never open strings', () => {
  assert.deepEqual(bodies('/* outer /* inner */ // after\n'), [' outer /* inner ', ' after']);
  assert.deepEqual(bodies('/* " \' ` // */\n// " \' ` /*'), [' " \' ` // ', ' " \' ` /*']);
});

test('Go strings hide comment delimiters and preserve escaped-quote boundaries', () => {
  assert.deepEqual(bodies(String.raw`var s = "https://host/* hidden */\"// still hidden" // actual
var t = "\\" /* outside */`), [' actual', ' outside ']);
  assert.deepEqual(bodies('var n = 6 / 2; n /= 2 // division'), [' division']);
});

test('Go raw strings hide comments across lines and do not escape backticks', () => {
  assert.deepEqual(bodies('var s = `// hidden\r\n/* hidden */ " \' \\` // outside'), [' outside']);
  assert.deepEqual(bodies('var s = `\\`/* outside */'), [' outside ']);
  assert.deepEqual(bodies('type T struct { F string `json:"//field"` } // field'), [' field']);
});

test('Go runes count Unicode code points and escapes as single characters', () => {
  const literals = ["'/'", "'\"'", "'😀'", String.raw`'\''`, String.raw`'\\'`,
    String.raw`'\377'`, String.raw`'\xff'`, String.raw`'\u002f'`, String.raw`'\U0010FFFF'`, "'\r'"];
  for (const literal of literals) assert.deepEqual(bodies(literal + ' // real'), [' real'], literal);
});

test('Go interpreted escapes do not create source comment delimiters', () => {
  assert.deepEqual(bodies(String.raw`"\a\b\f\n\r\t\v\000\377\x2f\u002f\U0001f600" // real`), [' real']);
});

test('Go counts LF only and preserves original comment text and positions', () => {
  const source = '\ufeffvar s = "😀" // one\r\n/* two\r\nthree */\r// four\u2028\u2029\f\r// same line';
  const comments = extract(source);
  assert.deepEqual(comments.map((c) => c.text), [' one', ' two\r\nthree ', ' four\u2028\u2029\f\r// same line']);
  const first = source.indexOf('//');
  assert.deepEqual(comments[0].start, { offset: first, line: 1, column: first + 1 });
  assert.equal(comments[0].end.offset, source.indexOf('\r'));
  assert.deepEqual(comments.map((c) => c.start.line), [1, 2, 3]);
  assert.equal(comments[2].start.column, 10);
  assert.deepEqual(bodies('// CR at EOF\r'), [' CR at EOF\r']);
  assert.deepEqual(bodies('// backslash\\\n// next'), [' backslash\\', ' next']);
});

test('Go directives and cgo preambles remain inert comments at physical positions', () => {
  const source = '//go:generate do-not-run\n//line imaginary.go:900\n//go:build linux\n/* #include <stdio.h> */\nimport "C"\n// actual';
  const comments = extract(source);
  assert.deepEqual(comments.map((c) => c.start.line), [1, 2, 3, 4, 6]);
  assert.deepEqual(comments.map((c) => c.text), ['go:generate do-not-run', 'line imaginary.go:900', 'go:build linux', ' #include <stdio.h> ', ' actual']);
});

for (const source of [
  '/* open', '`open', '"open', "'open", '"line\nbreak"', '"continued\\\nline"', "''", "'ab'", "'e\u0301'",
  String.raw`"\q"`, String.raw`"\'"`, String.raw`'\"'`, String.raw`'\12'`, String.raw`'\400'`,
  String.raw`"\x0"`, String.raw`"\xgg"`, String.raw`"\uD800"`, String.raw`"\U00110000"`,
  '\0', '"\0"', '// \0', '`\0`', '// \ufeff', '"\ud800"', '/*\udfff*/',
]) {
  test('Go malformed source discards partial comments: ' + JSON.stringify(source), () => {
    const result = extractGoComments('// before\n' + source);
    assert.equal(result.status, 'invalid', JSON.stringify(result));
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.position.offset >= 10);
    assert.ok(result.diagnostic.position.offset <= source.length + 10);
    assert.equal(result.diagnostic.position.line, 2);
  });
}

test('Go scanner does not validate the whole program grammar', () => {
  assert.deepEqual(bodies('package ??? // still a comment'), [' still a comment']);
});
