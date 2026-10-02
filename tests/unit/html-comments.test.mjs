import assert from "node:assert/strict";
import { test } from "node:test";
import { extractHtmlComments } from "../../dist/scanners/comments/html.js";
import { languageForPath } from "../../dist/scanners/comments/languages.js";

function comments(source) {
  const result = extractHtmlComments(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const entry of result.comments) {
    assert.equal(source.slice(entry.start.offset, entry.end.offset), entry.raw);
    assert.equal(source.slice(entry.contentStart.offset, entry.contentEnd.offset), entry.text);
  }
  return result.comments;
}

test("plain HTML and Django templates have distinct classifications", () => {
  assert.equal(languageForPath("pages/index.html"), "html");
  assert.equal(languageForPath("pages/index.htm"), "html");
  assert.equal(languageForPath("pages/index.djhtml"), "django-template");
  assert.equal(languageForPath("pages/index.django"), "django-template");
});

test("HTML extracts only actual comments and preserves source positions", () => {
  const source = '\ufeff<div title="<!-- hidden -->">😀</div>\r\n<!-- TODO one\r\nFIXME two --><!-- -->';
  const [first, second] = comments(source);
  assert.deepEqual([first.text, second.text], [" TODO one\r\nFIXME two ", " "]);
  assert.equal(first.start.line, 2);
  assert.equal(first.start.column, 1);
  assert.equal(second.start.offset, first.end.offset);
  assert.deepEqual(comments("<!DOCTYPE html><p>&lt;!-- text --&gt;</p>"), []);
});

test("HTML comments in attributes and raw-text elements are not reported", () => {
  assert.deepEqual(comments('<div data-x="<!-- fake -->">x</div><!-- real -->').map((c) => c.text), [" real "]);
  assert.deepEqual(comments('<TITLE><!-- fake --></title><textarea><!-- hidden --></textarea><!-- real -->')
    .map((c) => c.text), [" real "]);
  assert.deepEqual(comments('<plaintext><!-- hidden -->').map((c) => c.text), []);
});

test("plain style elements return CSS comments with positions in the HTML source", () => {
  const source = '<!-- first -->\r\n<style type="text/css" media="screen">p::before { content: "/* fake */"; }\r\n/* TODO CSS */</style><!-- last -->';
  const found = comments(source);
  assert.deepEqual(found.map((entry) => entry.text), [" first ", " TODO CSS ", " last "]);
  assert.deepEqual(found.map((entry) => entry.start.offset), [
    source.indexOf("<!-- first"), source.indexOf("/* TODO"), source.indexOf("<!-- last"),
  ]);
  assert.equal(found[1].start.line, 3);
});

test("script comments are extracted but strings and non-JavaScript data are not", () => {
  const source = '<!-- first --><script type="module">const text = "// fake"; // TODO JS\n'
    + 'const regex = /[/*]/; /* FIXME JS */</script>'
    + '<script type="application/json">{"note":"// fake /* fake */"}</script><!-- last -->';
  const found = comments(source);
  assert.deepEqual(found.map((entry) => entry.text), [" first ", " TODO JS", " FIXME JS ", " last "]);
  assert.equal(found[1].start.offset, source.indexOf("// TODO JS"));
  assert.equal(found[2].start.offset, source.indexOf("/* FIXME JS */"));
});

test("HTML reports unsupported embedded or template syntax instead of partial results", () => {
  for (const source of [
    "<!-- first --><script/><!-- TODO after -->",
    "<!-- first --><script type=\"text/babel\">/* TODO */</script>",
    "<!-- first --><style type=\"text/less\">/* TODO */</style>",
    "<!-- first -->{% comment %}TODO{% endcomment %}",
    "<!-- first -->{# TODO #}",
    '<div title="{# TODO #}"><!-- later --></div>',
    "<!-- first --><?php // TODO ?>",
    "<!-- first --><![CDATA[TODO]]>",
  ]) {
    const result = extractHtmlComments(source);
    assert.equal(result.status, "unsupported", source);
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.message);
  }
});

test("HTML reports malformed comments and tags without partial results", () => {
  for (const source of ["<!-- first --><!-- unfinished", '<p title="unfinished', "<!-- first --><div",
    "<!-- first --><style>/* unfinished</style>", "<!-- first --><style>p { color: red; }",
    "<!-- first --><script>/* unfinished</script>"]) {
    const result = extractHtmlComments(source);
    assert.equal(result.status, "invalid", source);
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.position.offset >= 0);
  }
});
