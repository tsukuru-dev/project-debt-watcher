import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCComments } from "../../dist/scanners/comments/c.js";
import { languageForPath } from "../../dist/scanners/comments/languages.js";

function comments(source, language = "cpp") {
  const result = extractCComments(source, language);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const entry of result.comments) {
    assert.equal(source.slice(entry.start.offset, entry.end.offset), entry.raw);
    assert.equal(source.slice(entry.contentStart.offset, entry.contentEnd.offset), entry.text);
  }
  return result.comments;
}

test("C and C++ source classification remains distinct", () => {
  assert.equal(languageForPath("main.c"), "c");
  assert.equal(languageForPath("main.cpp"), "cpp");
  assert.equal(languageForPath("main.h"), "cpp");
});

test("C/C++ finds line and block comments but ignores quoted text", () => {
  const source = '\ufeffconst char *s = "/* hidden */";\r\n// TODO first\r\nchar c = \'/\'; /* FIXME block */';
  const found = comments(source, "c");
  assert.deepEqual(found.map((entry) => entry.text), [" TODO first", " FIXME block "]);
  assert.deepEqual(found[0].start, { offset: source.indexOf("// TODO"), line: 2, column: 1 });
  assert.equal(found[1].start.line, 3);
});

test("C++ raw strings hide comment-looking text across lines and delimiter quotes", () => {
  const source = 'auto x = u8R"tag(// hidden\n/* hidden */\n" still text)tag"; // TODO real\n'
    + 'auto y = R"(/* hidden */)"; /* FIXME real */';
  assert.deepEqual(comments(source).map((entry) => entry.text), [" TODO real", " FIXME real "]);
});

test("include header names are not scanned as comments", () => {
  assert.deepEqual(comments('#include <vector>\n#include "my/header.h"\n// TODO').map((entry) => entry.text),
    [" TODO"]);
  const result = extractCComments('#include <foo/*bar*/>\n// TODO', "cpp");
  assert.equal(result.status, "unsupported");
  assert.deepEqual(result.comments, []);
});

test("C/C++ uncertain preprocessing and malformed literals never return partial comments", () => {
  for (const [source, status] of [
    ["/* first */\\\n// continued", "unsupported"],
    ["/* first */??/", "unsupported"],
    ["/* first */\n#include MACRO", "unsupported"],
    ["/* first */\n#if __has_include(<foo/*bar*/>)", "unsupported"],
    ["/* first */\nimport <foo/*bar*/>;", "unsupported"],
    ['/* first */R"bad(unterminated', "invalid"],
    ['/* first */"unterminated', "invalid"],
    ["/* first */ /* unterminated", "invalid"],
  ]) {
    const result = extractCComments(source, "cpp");
    assert.equal(result.status, status, source);
    assert.deepEqual(result.comments, []);
  }
});
