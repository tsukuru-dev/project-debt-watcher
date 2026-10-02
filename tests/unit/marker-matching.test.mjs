import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJavaScriptComments } from "../../dist/scanners/comments/javascript.js";
import { extractDjangoTemplateComments } from "../../dist/scanners/comments/django.js";
import { matchCommentMarkers } from "../../dist/scanners/comments/markers.js";

test("matches only extracted comments and keeps one finding per comment", () => {
  const source = 'const text = "TODO fake"; // TODO first FIXME second TODO again\n'
    + '/* ordinary */ /* FIXME block */';
  const result = matchCommentMarkers(extractJavaScriptComments(source, "javascript"), ["TODO", "FIXME"]);
  assert.equal(result.status, "ok");
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings[0].matches.map(({ marker }) => marker), ["TODO", "FIXME", "TODO"]);
  assert.deepEqual(result.findings[1].matches.map(({ marker }) => marker), ["FIXME"]);
  for (const finding of result.findings) {
    for (const match of finding.matches) {
      assert.equal(source.slice(match.startOffset, match.endOffset), match.marker);
      assert.ok(match.startOffset >= finding.comment.contentStart.offset);
      assert.ok(match.endOffset <= finding.comment.contentEnd.offset);
    }
  }
});

test("matching is case-sensitive, literal, and respects word boundaries", () => {
  const source = "// todo TODOLIST XTODO TODO: TO DO! TODO_FIXME TODO+FIXME\n";
  const result = matchCommentMarkers(extractJavaScriptComments(source, "javascript"), ["TODO", "TO DO", "TODO+FIXME"]);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.findings[0].matches.map(({ marker }) => marker), ["TODO", "TO DO", "TODO+FIXME"]);
  assert.equal(source.slice(result.findings[0].matches[0].startOffset, result.findings[0].matches[0].endOffset), "TODO");
});

test("literal markers can contain punctuation without regex interpretation", () => {
  const source = "// A+B (draft) [check] TODO?\n";
  const result = matchCommentMarkers(extractJavaScriptComments(source, "javascript"), ["A+B", "(draft)", "[check]", "TODO?"]);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.findings[0].matches.map(({ marker }) => marker), ["A+B", "(draft)", "[check]", "TODO?"]);
});

test("Unicode letters at marker boundaries do not create false matches", () => {
  const source = "// 𐐀TODO TODO𐐀 TODO\n";
  const result = matchCommentMarkers(extractJavaScriptComments(source, "javascript"), ["TODO"]);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.findings[0].matches.map((match) => match.startOffset), [source.lastIndexOf("TODO")]);
});

test("marker positions work inside multiline template comments", () => {
  const source = "{% comment %}\nordinary\nTODO later\n{% endcomment %}";
  const result = matchCommentMarkers(extractDjangoTemplateComments(source), ["TODO"]);
  assert.equal(result.status, "ok");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].matches[0].startOffset, source.indexOf("TODO"));
});

test("empty marker lists yield no findings; failed extraction cannot leak partial matches", () => {
  const source = "// TODO\n/* unfinished";
  const good = matchCommentMarkers(extractJavaScriptComments("// TODO", "javascript"), []);
  assert.deepEqual(good, { status: "ok", findings: [] });
  const failed = matchCommentMarkers(extractJavaScriptComments(source, "javascript"), ["TODO"]);
  assert.equal(failed.status, "invalid");
  assert.deepEqual(failed.findings, []);
  assert.ok(failed.diagnostic.message);
});

test("invalid marker lists fail before matching", () => {
  const comments = extractJavaScriptComments("// TODO", "javascript");
  assert.throws(() => matchCommentMarkers(comments, ["", "TODO"]), /non-empty/);
  assert.throws(() => matchCommentMarkers(comments, ["TODO", "TODO"]), /duplicate/);
});
