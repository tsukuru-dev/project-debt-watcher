import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRubyComments } from "../../dist/scanners/comments/ruby.js";
import { languageForPath } from "../../dist/scanners/comments/languages.js";

function extract(source) {
  const result = extractRubyComments(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const c of result.comments) {
    assert.equal(source.slice(c.start.offset, c.end.offset), c.raw);
    assert.equal(source.slice(c.contentStart.offset, c.contentEnd.offset), c.text);
  }
  return result.comments;
}
const bodies = (source) => extract(source).map((c) => c.text);

test("Ruby ordinary comments include shebangs, magic comments, empty and EOF comments", () => {
  assert.deepEqual(bodies('#!/usr/bin/ruby\n# coding: utf-8\nx = 1 # TODO\n#'), ['!/usr/bin/ruby', ' coding: utf-8', ' TODO', '']);
  assert.deepEqual(extract(""), []);
});

test("Ruby quoted multiline text, escaped quotes and single-quoted interpolation are not comments", () => {
  assert.deepEqual(bodies(String.raw`x = "\"# hidden"
y = '#{not code} \'# hidden'
z = "multiline
# hidden" # real
s = "\#{not interpolation}" # end`), [" real", " end"]);
});

test("Ruby block comments start at column one and retain their body", () => {
  const source = '=begin tag\r\n# TODO body\r\n=begin nested text\r\n=end suffix\r\n# after';
  const comments = extract(source);
  assert.deepEqual(comments.map((c) => [c.kind, c.text]), [["block", "# TODO body\r\n=begin nested text\r\n"], ["line", " after"]]);
  assert.equal(comments[0].start.column, 1);
  assert.equal(comments[0].contentStart.line, 2);
  assert.deepEqual(bodies("=begin\n=end"), [""]);
  assert.deepEqual(bodies('x = "=begin\n# hidden\n=end" # real'), [" real"]);
  assert.equal(extractRubyComments("=beginning\n# real").comments[0].text, " real");
});

test("Ruby data after an exact __END__ line is not scanned", () => {
  assert.deepEqual(bodies('# before\n__END__\n# not code\n"unterminated'), [" before"]);
  assert.deepEqual(bodies('x = "__END__"\n__END__extra\n# real'), [" real"]);
  assert.deepEqual(bodies('__END__'), []);
});

test("Ruby preserves UTF-16 offsets, BOM and CRLF; Unicode separators do not end comments", () => {
  const comments = extract('\ufeffx="😀" # note\r\n#last\u2028same');
  assert.deepEqual(comments[0].start, { offset: 8, line: 1, column: 9 });
  assert.equal(comments[0].raw, "# note");
  assert.equal(comments[1].start.line, 2);
  assert.equal(comments[1].text, "last\u2028same");
  assert.deepEqual(bodies('\ufeff=begin\nbody\n=end'), ['body\n']);
});

test("Ruby continuation backslashes do not extend comments", () => {
  assert.deepEqual(bodies('x = 1 + \\\r\n 2 # real\\\n# next'), [' real\\', ' next']);
});

for (const source of ['x = "#{1 # real\n}"', 'x = "#@name"', 'x = "#$name"', 'x = /#regex/',
  'x = %q{#hidden}', 'x = <<TEXT\n#hidden\nTEXT', 'x = ?#', 'x = `echo hello`', "x = $'",
  String.raw`x = "\C-"# hidden"`, 'x = 4 / 2', 'x = 4 % 2', 'array << 1', 'valid?',
  '# coding: latin-1\n# note', '#!/usr/bin/ruby\n# encoding: ascii-8bit', '# bare\rline', '#\0']) {
  test("Ruby fallback reports unsupported syntax: " + JSON.stringify(source), () => {
    const result = extractRubyComments(source);
    assert.equal(result.status, "unsupported", JSON.stringify(result));
    assert.deepEqual(result.comments, []);
  });
}

for (const source of ['"open', "'open", '=begin\nbody', 'x = \\ # invalid']) {
  test("Ruby malformed lexical structure discards partial comments: " + source, () => {
    const result = extractRubyComments('# before\n' + source);
    assert.equal(result.status, "invalid");
    assert.deepEqual(result.comments, []);
    assert.equal(result.diagnostic.position.line, 2);
  });
}

test("Ruby file classification covers common source and project files but not ERB", () => {
  for (const path of ['lib/example.rb', 'TASK.RB', 'build.rake', 'thing.gemspec', 'nested/Gemfile', 'Rakefile']) {
    assert.equal(languageForPath(path), "ruby");
  }
  for (const path of ['Gemfile.lock', 'view.erb', 'view.html.erb']) assert.equal(languageForPath(path), undefined);
});
