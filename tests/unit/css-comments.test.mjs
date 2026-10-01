import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCssComments } from "../../dist/scanners/comments/css.js";

function extract(source) {
  const result = extractCssComments(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const c of result.comments) {
    assert.equal(c.kind, "block");
    assert.equal(source.slice(c.start.offset, c.end.offset), c.raw);
    assert.equal(source.slice(c.contentStart.offset, c.contentEnd.offset), c.text);
  }
  return result.comments;
}
const bodies = (source) => extract(source).map((c) => c.text);

test("CSS preserves empty, adjacent, multiline and ordinary block comments", () => {
  assert.deepEqual(bodies('/**//* TODO one */a { color: red; /*\n FIXME two\n */ }/* note */'),
    ["", " TODO one ", "\n FIXME two\n ", " note "]);
  assert.deepEqual(extract(""), []);
  assert.deepEqual(extract("a { color: red }"), []);
});

test("CSS comments do not nest and quotes/escapes inside them have no special meaning", () => {
  assert.deepEqual(bodies(String.raw`/* outer /* inner */ tail */ /* " ' \ */`),
    [" outer /* inner ", String.raw` " ' \ `]);
});

test("CSS strings and escaped quotes contain no comments", () => {
  assert.deepEqual(bodies(String.raw`a { content: "/* TODO fake */"; other: 'it\'s /* fake */';
    x: "\\\"/* still string */"; y: "\22 /* escaped quote */"; } /* real */`), [" real "]);
});

for (const newline of ["\n", "\r\n", "\r", "\f"]) {
  test("CSS strings accept escaped line continuation: " + JSON.stringify(newline), () => {
    assert.deepEqual(bodies('a { content: "before\\' + newline + '/* hidden */" }/* real */'), [" real "]);
    assert.deepEqual(bodies('a { content: "\\22' + newline + '/* hidden */" }/* real */'), [" real "]);
  });
}

test("CSS does not borrow JavaScript's // comments or template syntax", () => {
  assert.deepEqual(bodies('// TODO not a comment\n`/* actual CSS comment */` # TODO'), [" actual CSS comment "]);
});

for (const spelling of ["url", "URL", "uRl", String.raw`\75rl`, String.raw`u\72 l`, String.raw`\000075rl`, String.raw`\u\r\l`]) {
  test("unquoted URL content is not a comment: " + spelling, () => {
    assert.deepEqual(bodies(`a { background: ${spelling}(https://example.invalid/*TODO*/image.svg); }/* real */`), [" real "]);
    assert.deepEqual(bodies(`${spelling}(/*TODO*/) /* real */`), [" real "]);
  });
}

test("CSS URL escapes, data URLs and whitespace preserve token boundaries", () => {
  assert.deepEqual(bodies(String.raw`url(data:image/svg+xml;base64,AAAA/*fake*/)
    url(path\)/*fake*/.png) url(path\29 /*fake*/.png) url(\(\"\')
    url(  path.png  ) url() url( ) /* real */`), [" real "]);
});

test("quoted URLs skip strings and preserve comments after the string", () => {
  assert.deepEqual(bodies(`url( \t\n"/* hidden */" /* real */) url('https://host//hidden')/* end */`), [" real ", " end "]);
});

test("identifier, hash, at-keyword and dimension boundaries do not invent URL tokens", () => {
  for (const prefix of ["myurl", "--url", "-url", "url2", "éurl", "😀url", "#url", "#1url", "@url",
    "1url", "-1url", "+.2url", "1e3url", String.raw`1\75rl`, String.raw`#\75rl`, String.raw`@\75rl`]) {
    assert.deepEqual(bodies(`${prefix}(/* real */)`), [" real "], prefix);
  }
  assert.deepEqual(bodies("url (/* separate */) url/**/(/* separate too */)"), [" separate ", "", " separate too "]);
  assert.deepEqual(bodies("1%url(/*hidden*/) +url(/*hidden*/) .url(/*hidden*/)"), []);
});

test("CSS escaped punctuation cannot create comment delimiters or function parentheses", () => {
  assert.deepEqual(bodies(String.raw`\/\*TODO\*/ \2f *TODO*/ url\(/* real */) \"/* another */`), [" real ", " another "]);
  assert.deepEqual(bodies(String.raw`\000075rl(/*hidden*/) \0000750rl(/* real */)`), [" real "]);
});

test("CSS legacy wrappers leave their contents available for tokenization", () => {
  assert.deepEqual(bodies("<!--url(/*hidden*/)/* real */-->url(/*hidden*/)"), [" real "]);
});

test("CSS Unicode whitespace is not treated as ASCII URL whitespace", () => {
  assert.deepEqual(bodies('url(path\u00a0/*hidden*/) url(path\u2028/*hidden*/)'), []);
  assert.deepEqual(bodies('\u2028url(/*hidden*/)'), []);
  assert.deepEqual(bodies('"\u2028/*hidden*/\u2029"/* real */'), [" real "]);
});

test("CSS replacement characters preserve boundaries without rewriting original text", () => {
  for (const value of ["\0", "\ud800", String.raw`\0 `, String.raw`\d800 `, String.raw`\110000 `]) {
    assert.deepEqual(bodies(`${value}url(/* real */)`), [" real "]);
  }
  assert.deepEqual(bodies("url(path\0/*hidden*/)"), []);
});

test("CSS positions preserve BOM, UTF-16 columns, CRLF and form feed", () => {
  const source = '\ufeff😀{}\r\n/*a\rb\fc\nd*/\f/*last*/';
  const [first, last] = extract(source);
  assert.deepEqual(first.start, { offset: 7, line: 2, column: 1 });
  assert.deepEqual(first.contentStart, { offset: 9, line: 2, column: 3 });
  assert.deepEqual(first.contentEnd, { offset: 16, line: 5, column: 2 });
  assert.deepEqual(first.end, { offset: 18, line: 5, column: 4 });
  assert.deepEqual(last.start, { offset: 19, line: 6, column: 1 });
  assert.deepEqual(extract("😀/*x*/")[0].start, { offset: 2, line: 1, column: 3 });
});

for (const source of ["/* open", '"open', "'open", '"bad\nstring"', '"bad\rstring"', '"bad\fstring"',
  "url(open", "url(open   ", "url(a b)", 'url(a"b)', "url(a(b)", "url(a\u0007b)", "url(a\u007fb)",
  "url(a\\\nb)", "url(a\\)", "url(/*hidden*/'bad')", "\\", "\\\n", '"trailing\\']) {
  test("CSS lexical errors return a diagnostic without partial results: " + JSON.stringify(source), () => {
    const result = extractCssComments("/* before */\r\n" + source);
    assert.equal(result.status, "invalid", JSON.stringify(result));
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.message.length > 0);
    assert.equal(result.diagnostic.position.line, 2);
    assert.ok(result.diagnostic.position.offset >= 14);
  });
}

test("CSS extraction is lexical, not declaration or brace validation", () => {
  assert.deepEqual(bodies("a { made-up-property: ???; /* real */"), [" real "]);
});
