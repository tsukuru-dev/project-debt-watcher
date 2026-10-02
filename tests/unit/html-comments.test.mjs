import assert from "node:assert/strict";
import { test } from "node:test";
import { extractHtmlComments } from "../../dist/scanners/comments/html.js";
import { languageForPath } from "../../dist/scanners/comments/languages.js";

function comments(source) {
  const result = extractHtmlComments(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const entry of result.comments) {
    assert.equal(entry.kind, "block");
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

test("HTML reports unsupported embedded or template syntax instead of partial results", () => {
  for (const source of [
    "<!-- first --><script>// TODO</script>",
    "<!-- first --><style>/* TODO */</style>",
    "<!-- first --><script/><!-- TODO after -->",
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
  for (const source of ["<!-- first --><!-- unfinished", '<p title="unfinished', "<!-- first --><div"]) {
    const result = extractHtmlComments(source);
    assert.equal(result.status, "invalid", source);
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.position.offset >= 0);
  }
});
