import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJavaScriptComments } from "../../dist/scanners/comments/javascript.js";

function extract(source, language = "javascript") {
  const result = extractJavaScriptComments(source, language);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const comment of result.comments) {
    assert.equal(source.slice(comment.start.offset, comment.end.offset), comment.raw);
    assert.equal(source.slice(comment.contentStart.offset, comment.contentEnd.offset), comment.text);
  }
  return result.comments;
}

test("line, block, JSDoc, empty and adjacent comments retain their exact bodies", () => {
  const source = "// TODO one\n/**\n * FIXME two\n */const n = 1;/**///\n/* ordinary note */";
  const comments = extract(source);
  assert.deepEqual(comments.map((c) => [c.kind, c.text]), [
    ["line", " TODO one"], ["block", "*\n * FIXME two\n "], ["block", ""], ["line", ""], ["block", " ordinary note "],
  ]);
  assert.deepEqual(comments[0].start, { offset: 0, line: 1, column: 1 });
  assert.deepEqual(comments[0].end, { offset: 11, line: 1, column: 12 });
});

test("quoted URLs, escaped quotes, backslashes and string line continuations are not comments", () => {
  const source = String.raw`const a = "https://example.invalid/* TODO fake */";
const b = 'it\'s // not a comment';
const c = "\\\"/* still a string */";
const d = 'continued\
// still a string';
// real`;
  assert.deepEqual(extract(source).map((c) => c.text), [" real"]);
});

test("template text is ignored but expressions and nested templates contain real comments", () => {
  const source = 'const value = `// fake /* fake */ ${ /* outer */ { value: `nested ${ 1 /* inner */ }` } } end`; // real';
  assert.deepEqual(extract(source).map((c) => c.text), [" outer ", " inner ", " real"]);
  assert.deepEqual(extract('const x = `\\${ /* raw */ } \\` // raw`;').map((c) => c.text), []);
});

test("regex escapes and character classes cannot create false comments", () => {
  const source = String.raw`const a = /https?:\/\/example\/\*TODO/;
const b = /[/*]TODO[//]/gi;
const c = /[\]/]\/\*/;
const d = /=TODO\/\//;
// real`;
  assert.deepEqual(extract(source).map((c) => c.text), [" real"]);
});

test("division and division assignment leave following comments visible", () => {
  const source = "let n = 12 / 3 / 2; n /= 2; n = fn() / list[0]; n = item.value / 2; // real\n"
    + "n++ / 2; n = obj.return / 2; n = obj?.throw / 2; /* tail */";
  assert.deepEqual(extract(source).map((c) => c.text), [" real", " tail "]);
});

test("number formats do not swallow operators or mistake hex digits for decimal exponents", () => {
  const source = "const a = 0x1e+/[/*]/; const b = 1e+2 / 3; const c = .5 / 2;\n"
    + "const d = 0b101n / 2n; const e = 0o77 / 2; const f = 1_000 / 2; // real";
  assert.deepEqual(extract(source).map((c) => c.text), [" real"]);
});

test("regex literals after control conditions differ from division after calls", () => {
  const source = String.raw`if (check(value)) /[/*]/.test(value); // if
while (ready) /[//]/.test(value); /* while */
for (const value of /[/*]/) /[//]/.test(value);
for await (const value of stream) /[/*]/.test(value);
const n = check(value) / 2; // call`;
  assert.deepEqual(extract(source).map((c) => c.text), [" if", " while ", " call"]);
});

test("prefix, conditional, arrow and spread expressions can contain regex literals", () => {
  const source = String.raw`function match(x) { return /[/*]/.test(x); }
const fn = x => /[//]/.test(x);
const result = flag ? /[/*]/ : /[//]/;
const array = [.../[/*]/];
const value = !/[//]/.test('x'); // real`;
  assert.deepEqual(extract(source).map((c) => c.text), [" real"]);
});

test("break/continue labels and debugger newline boundaries permit regex statements", () => {
  // A labelled continue must keep its label on the same line; test it separately.
  assert.deepEqual(extract("while (true) { continue outer\n/[/*]/.test(x); } // real").map((c) => c.text), [" real"]);
  assert.deepEqual(extract("debugger\n/[/*]/.test(x); // real").map((c) => c.text), [" real"]);
  assert.deepEqual(extract("while (true) { break outer\n/[/*]/.test(x); } // real").map((c) => c.text), [" real"]);
  assert.deepEqual(extract("while (true) { break /* newline\n */ /[/*]/.test(x); } // real").map((c) => c.text), [" newline\n ", " real"]);
});

test("contextual of identifiers and method names are not automatically control keywords", () => {
  const source = "for (of / 2; ready; next()) { /* body */ }\n"
    + "const n = obj.if(x) / 2; const a = of / 2; // real";
  assert.deepEqual(extract(source).map((c) => c.text), [" body ", " real"]);
  assert.deepEqual(extract("const value = {}; /[/*]/.test(x); // real").map((c) => c.text), [" real"]);
});

test("TypeScript annotations, interfaces, assertions using as and type strings preserve comments", () => {
  const source = 'interface Example { /* field */ url: "https://example.invalid//"; }\n'
    + 'type Pair<T> = [T, T];\nconst value = input as Example; // actual\n'
    + 'function run<T>(x: T): T { return x; /* return */ }';
  assert.deepEqual(extract(source, "typescript").map((c) => c.text), [" field ", " actual", " return "]);
});

test("hashbangs and private fields are not debt comments", () => {
  const source = '\uFEFF#!/usr/bin/env node // TODO interpreter\nclass Example { #value = "// fake"; /* real */ }';
  assert.deepEqual(extract(source).map((c) => c.text), [" real "]);
});

test("line positions preserve BOM, CRLF, bare CR, Unicode separators and surrogate pairs", () => {
  const source = '\uFEFFconst face = "😀"; // one\r\n/* two\rthree\u2028four\u2029five */\n// end';
  const comments = extract(source);
  assert.deepEqual(comments[0].start, { offset: source.indexOf("// one"), line: 1, column: source.indexOf("// one") + 1 });
  assert.equal(comments[1].start.line, 2);
  assert.equal(comments[1].end.line, 5);
  assert.equal(comments[2].start.line, 6);
  assert.equal(comments[2].start.column, 1);
  for (const separator of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    const found = extract("// first" + separator + "// second");
    assert.equal(found[1].start.line, 2);
    assert.equal(found[1].start.column, 1);
  }
});

test("comments at EOF and block comments containing apparent nested markers are handled literally", () => {
  assert.deepEqual(extract("// EOF").map((c) => c.text), [" EOF"]);
  assert.deepEqual(extract("/* outer /* not nested // still one */").map((c) => c.text), [" outer /* not nested // still one "]);
  assert.deepEqual(extract(""), []);
  assert.deepEqual(extract("const n = 3;"), []);
});

for (const source of ["// before\n/* unfinished", '// before\n"unfinished', "// before\n`unfinished", "// before\n`value ${1",
  "// before\nconst r = /unfinished", "// before\nconst r = /[abc/", "// before\nconst x = (1;", "// before\n}", "const x = 'bad\nstring';"]) {
  test("invalid lexical structure returns a diagnostic and no partial comments: " + JSON.stringify(source), () => {
    const result = extractJavaScriptComments(source, "javascript");
    assert.equal(result.status, "invalid", JSON.stringify(result));
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.message);
    assert.ok(result.diagnostic.position.line >= 1);
  });
}

for (const [source, language] of [
  ["const x = <div>// text</div>;", "javascript"], ["const x = <T>value;", "typescript"],
  ["const fn = <T>(x: T) => x;", "typescript"], ["if (x) {} /[/*]/.test('x');", "javascript"],
  ["const x = value! / 2;", "typescript"], ["await /[/*]/;", "javascript"],
  ["const x = /[[]/;", "javascript"], ["const x = /[a&&b]/v;", "javascript"],
  ["<!-- browser comment", "javascript"], ["@decorator class X {}", "typescript"],
  [String.raw`const \u0061 = 1;`, "javascript"],
  ["type Name = string\n/[/*]/.test(x);", "typescript"],
  ["type Name = string /* new\nline */ /[/*]/.test(x);", "typescript"],
]) {
  test("uncertain syntax is explicit rather than guessed: " + source, () => {
    const result = extractJavaScriptComments("// before\n" + source, language);
    assert.equal(result.status, "unsupported", JSON.stringify(result));
    assert.deepEqual(result.comments, []);
  });
}

test("the JavaScript extractor rejects other languages, including those with separate extractors", () => {
  for (const language of ["python", "jsx", "tsx", "css", "cpp", "rust", "go", "django-template"]) {
    const result = extractJavaScriptComments("// TODO", language);
    assert.equal(result.status, "unsupported");
    assert.deepEqual(result.comments, []);
  }
});

test("deep template nesting returns a bounded diagnostic instead of overflowing the stack", () => {
  const source = "`${".repeat(140) + "1" + "}`".repeat(140);
  const result = extractJavaScriptComments(source, "javascript");
  assert.equal(result.status, "unsupported");
  assert.match(result.diagnostic.message, /nesting/);
});
