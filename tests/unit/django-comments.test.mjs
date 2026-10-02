import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDjangoTemplateComments } from "../../dist/scanners/comments/django.js";

function comments(source) {
  const result = extractDjangoTemplateComments(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const entry of result.comments) {
    assert.equal(source.slice(entry.start.offset, entry.end.offset), entry.raw);
    assert.equal(source.slice(entry.contentStart.offset, entry.contentEnd.offset), entry.text);
  }
  return result.comments;
}

test("Django HTML templates extract short, block and HTML comments in source order", () => {
  const source = '<div>{# TODO short #}<!-- FIXME html -->{% comment %}\nTODO block\n{% endcomment %}</div>';
  assert.deepEqual(comments(source).map((c) => c.text), [" TODO short ", " FIXME html ", "\nTODO block\n"]);
});

test("Django syntax inside HTML tags is scanned without confusing quotes or > with tag ends", () => {
  const source = '<div title="{# TODO in attribute #}" data-x="{{ value|default:\'>\' }}">'
    + '{% if enabled %}<!-- FIXME visible -->{% endif %}</div>';
  assert.deepEqual(comments(source).map((c) => c.text), [" TODO in attribute ", " FIXME visible "]);
});

test("Django comments hide template and HTML-looking syntax inside their bodies", () => {
  const source = '{# TODO {% if broken %} <!-- hidden --> #}'
    + '{% comment %}FIXME {# hidden #} <!-- hidden --> {% if broken %}{% endcomment %}'
    + '<!-- final -->';
  assert.deepEqual(comments(source).map((c) => c.text), [
    " TODO {% if broken %} <!-- hidden --> ",
    "FIXME {# hidden #} <!-- hidden --> {% if broken %}",
    " final ",
  ]);
});

test("Django single-line comments preserve offsets and CRLF positions", () => {
  const source = '\ufeff😀\r\n{# TODO #}\r\n<!-- FIXME -->';
  const [first, second] = comments(source);
  assert.deepEqual(first.start, { offset: 5, line: 2, column: 1 });
  assert.deepEqual(first.contentStart, { offset: 7, line: 2, column: 3 });
  assert.deepEqual(second.start, { offset: 17, line: 3, column: 1 });
});

test("Django malformed or unsupported constructs never return partial comments", () => {
  const cases = [
    ["<!-- first -->{# TODO\n next #}", "invalid"],
    ["<!-- first -->{% comment %} TODO", "invalid"],
    ["<!-- first -->{% endcomment %}", "invalid"],
    ["<!-- first -->{% comment %}{% comment %}{% endcomment %}", "invalid"],
    ['<!-- first -->{% comment "TODO note" %}body{% endcomment %}', "unsupported"],
    ["<!-- first --><script>/* TODO */</script>", "unsupported"],
    ["<!-- first --><title>{# TODO #}</title>", "unsupported"],
  ];
  for (const [source, status] of cases) {
    const result = extractDjangoTemplateComments(source);
    assert.equal(result.status, status, source);
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.message);
  }
});
