import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractRustComments } from '../../dist/scanners/comments/rust.js';

function extract(source) {
  const result = extractRustComments(source);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  for (const c of result.comments) {
    assert.equal(source.slice(c.start.offset, c.end.offset), c.raw);
    assert.equal(source.slice(c.contentStart.offset, c.contentEnd.offset), c.text);
  }
  return result.comments;
}
const bodies = (source) => extract(source).map((c) => c.text);

test('Rust extracts ordinary and doc comments, including empty and EOF forms', () => {
  assert.deepEqual(bodies('// TODO\n/// FIXME\n//! HACK\n//// plain\n/** docs *//*! inner *//***/\n//'),
    [' TODO', '/ FIXME', '! HACK', '// plain', '* docs ', '! inner ', '*', '']);
  assert.deepEqual(extract('').map((c) => c.raw), []);
  assert.deepEqual(extract('let x = 1;').map((c) => c.raw), []);
});

test('Rust nested block comments are one comment and use the final matching delimiter', () => {
  const source = '/* outer /* inner /* deep */ still inner */ outside */ // after';
  const comments = extract(source);
  assert.deepEqual(comments.map((c) => c.kind), ['block', 'line']);
  assert.deepEqual(comments.map((c) => c.text), [' outer /* inner /* deep */ still inner */ outside ', ' after']);
});

test('Rust quoted and prefixed strings hide comment syntax', () => {
  const source = String.raw`let a = "// hidden \" /* hidden */"; let b = b"// hidden"; let c = c"/* hidden */"; // real`;
  assert.deepEqual(bodies(source), [' real']);
  assert.deepEqual(bodies(String.raw`let a = "\0\n\r\t\\\"\u{1F600}\x2f"; // real`), [' real']);
  assert.deepEqual(bodies('let a = "first line\n// hidden"; // outside'), [' outside']);
});

test('Rust raw, byte and C strings use their exact hash delimiters', () => {
  const source = `let a = r###"// hidden "## /* hidden */"###;
let b = br#"/* hidden */ "#;
let c = cr"// hidden";
let d = cr##"/* hidden */"##; // visible`;
  assert.deepEqual(bodies(source), [' visible']);
  assert.deepEqual(bodies('let a = r"// hidden"; let b = br"/* hidden */"; // last'), [' last']);
  assert.deepEqual(bodies(String.raw`let a = cr"\0 // still text"; // last`), [' last']);
});

test('Rust raw identifiers, lifetimes, labels and characters do not hide comments', () => {
  const source = `let r#type = '\\''; let emoji = '😀'; let x = b'/';
fn f<'a>(x: &'a str) { 'label: loop { break 'label; } } // lifetime
let x = r#match; let y = &mut r#name; // identifier`;
  assert.deepEqual(bodies(source), [' lifetime', ' identifier']);
  assert.deepEqual(bodies("let x = 'x'; let y = '\\u{1F600}'; // chars"), [' chars']);
});

test('Rust macro text stays lexical source, without expansion or execution', () => {
  const source = 'format!("// hidden {value}"); include_str!("/* hidden */"); // actual';
  assert.deepEqual(bodies(source), [' actual']);
  assert.deepEqual(bodies('macro_rules! m { () => { /* inside macro */ }; }'), [' inside macro ']);
});

test('Rust preserves UTF-16 offsets, BOM and CRLF; bare CR does not start a new line', () => {
  const source = '\ufefflet x = "😀"; // first\r\n/* second\r\nline */\r// third\r';
  const comments = extract(source);
  assert.deepEqual(comments.map((c) => c.text), [' first', ' second\r\nline ', ' third\r']);
  const first = source.indexOf('//');
  assert.deepEqual(comments[0].start, { offset: first, line: 1, column: first + 1 });
  assert.deepEqual(comments.map((c) => c.start.line), [1, 2, 3]);
  assert.equal(comments[0].end.offset, source.indexOf('\r'));
});

test('Rust supports deep nesting within its explicit bound', () => {
  const source = '/*'.repeat(128) + ' TODO ' + '*/'.repeat(128);
  assert.deepEqual(bodies(source), [source.slice(2, -2)]);
  const tooDeep = extractRustComments('// before\n' + '/*'.repeat(129) + '*/'.repeat(129));
  assert.equal(tooDeep.status, 'unsupported');
  assert.deepEqual(tooDeep.comments, []);
});

for (const source of [
  '/* unclosed', '/* outer /* inner */', '"unclosed', 'r#"unclosed', 'br"unclosed',
  "'ab'", "''", "'\\q'", "b'😀'", 'b"😀"', 'br"😀"', 'c"\\0"', 'cr"\u0000"',
  'r##name', 'r#"text"##', '"bad\rtext"', 'r"bad\rtext"', '/// bad\rtext', '/*! bad\rtext */',
  String.raw`"\xGG"`, String.raw`"\u{110000}"`, String.raw`b"\u{61}"`,
]) {
  test('Rust malformed source discards partial comments: ' + JSON.stringify(source), () => {
    const result = extractRustComments('// before\n' + source);
    assert.equal(result.status, 'invalid', JSON.stringify(result));
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.position.line >= 2);
  });
}

test('Rust rejects raw delimiters beyond the language limit', () => {
  const result = extractRustComments('r' + '#'.repeat(256) + '"text"' + '#'.repeat(256));
  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.comments, []);
});

test('Rust scanner does not validate full syntax or expand macros', () => {
  assert.deepEqual(bodies('fn ??? { // still a comment\n}'), [' still a comment']);
});
