import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPythonComments } from "../../dist/scanners/comments/python.js";
import { pythonInterpolationCases } from "../helpers/python-interpolation-cases.mjs";

function extract(source) {
  const result = extractPythonComments(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const c of result.comments) {
    assert.equal(c.kind, "line");
    assert.equal(source.slice(c.start.offset, c.end.offset), c.raw);
    assert.equal(source.slice(c.contentStart.offset, c.contentEnd.offset), c.text);
  }
  return result.comments;
}
const bodies = (source) => extract(source).map((c) => c.text);

test("Python extracts full-line, inline, empty and EOF comments without matching markers yet", () => {
  assert.deepEqual(bodies("# TODO one\nx = 1 # FIXME two\n#\n## ordinary"), [" TODO one", " FIXME two", "", "# ordinary"]);
  assert.deepEqual(extract(""), []);
  assert.deepEqual(extract("x = 1"), []);
});

test("Python shebangs, encoding cookies and type comments are comments", () => {
  assert.deepEqual(bodies("#!/usr/bin/env python3\n# coding: utf-8\nx = 1 # type: ignore"),
    ["!/usr/bin/env python3", " coding: utf-8", " type: ignore"]);
});

test("Python strings, escaped quotes, backslash parity and adjacent literals hide hashes", () => {
  assert.deepEqual(bodies(String.raw`x = 'it\'s # hidden' "# adjacent"
y = "\\\"# hidden"; z = "\\" # real
v = "\x23 \u0023 \N{NUMBER SIGN}" # other`), [" real", " other"]);
});

test("Python triple-quoted strings and docstrings are not block comments", () => {
  const source = `"""# module docstring
one " and two "" do not end it
"""
def fn():
    '''# function docstring
    "# hidden"
    '''
    return 1 # real`;
  assert.deepEqual(bodies(source), [" real"]);
  assert.deepEqual(bodies(String.raw`"""escaped \""" # still hidden
end""" # outside`), [" outside"]);
  assert.deepEqual(bodies(`""""""# after empty triple\n''# after empty short`), [" after empty triple", " after empty short"]);
});

for (const prefix of ["r", "R", "u", "U", "b", "B", "br", "Br", "bR", "BR", "rb", "Rb", "rB", "RB"]) {
  test("Python string prefix hides hashes: " + prefix, () => {
    for (const delimiter of ['"', "'", '"""', "'''"]) {
      assert.deepEqual(bodies(`${prefix}${delimiter}# hidden${delimiter} # real`), [" real"]);
    }
  });
}

test("Python raw strings still recognise escaped quotes and even trailing backslashes", () => {
  assert.deepEqual(bodies(String.raw`r"\"# hidden" # one
rb'\'# hidden' # two
r"\\" # three`), [" one", " two", " three"]);
});

for (const ending of ["\n", "\r", "\r\n"]) {
  test("Python physical line ending: " + JSON.stringify(ending), () => {
    assert.deepEqual(bodies('# first\\' + ending + '# second'), [" first\\", " second"]);
    assert.deepEqual(bodies('x = 1 + \\' + ending + ' 2 # real'), [" real"]);
    for (const prefix of ["", "r", "b", "br"]) {
      assert.deepEqual(bodies(prefix + '"continued\\' + ending + '# hidden" # real'), [" real"]);
      assert.deepEqual(bodies(prefix + '"""multiline' + ending + '# hidden""" # real'), [" real"]);
    }
  });
}

test("Python comments in implicitly continued expressions remain visible", () => {
  assert.deepEqual(bodies('items = [\n "# string", # real\n 2, # another\n]\n'), [" real", " another"]);
});

test("Python consumes full names without mistaking suffixes or separated names for prefixes", () => {
  for (const name of ["offer", "left", "αf", "name1f", "f ", "f\n", "t\t", "rf "]) {
    // Grammar validation is outside the lexer: names followed by plain strings stay plain.
    assert.deepEqual(bodies(`${name}"# hidden" # real`), [" real"]);
  }
  assert.deepEqual(bodies('# f"fake prefix"\n"f\\\"# hidden"'), [' f"fake prefix"']);
});

test("Python does not treat C-style comment symbols as comments", () => {
  assert.deepEqual(bodies("x = 4 // 2 # floor division\n/* ordinary tokens */"), [" floor division"]);
});

test("Python source positions preserve BOM, Unicode, CRLF and raw text", () => {
  const source = '\ufeffx = "😀" # one\r\n#two\r#three\n#';
  const comments = extract(source);
  const start = source.indexOf("#");
  assert.deepEqual(comments[0].start, { offset: start, line: 1, column: start + 1 });
  assert.deepEqual(comments[0].contentStart, { offset: start + 1, line: 1, column: start + 2 });
  assert.deepEqual(comments[0].end, { offset: source.indexOf("\r"), line: 1, column: source.indexOf("\r") + 1 });
  assert.deepEqual(comments.map((c) => c.start.line), [1, 2, 3, 4]);
  assert.equal(comments[3].end.offset, source.length);
  assert.deepEqual(comments[3].contentStart, comments[3].contentEnd);
  assert.equal(extract('# one\f\u2028\u2029# still same comment')[0].end.line, 1);
  assert.deepEqual(bodies('"\f\u2028\u2029# hidden" # real'), [" real"]);
});

for (const prefix of ["f", "F", "fr", "fR", "Fr", "FR", "rf", "rF", "Rf", "RF", "t", "T", "tr", "tR", "Tr", "TR", "rt", "rT", "Rt", "RT"]) {
  test("Python interpolation prefix supports expression comments: " + prefix, () => {
    for (const delimiter of ['"', "'", '"""', "'''"]) {
      assert.deepEqual(bodies(`# before\n${prefix}${delimiter}# literal {value # real expression comment\n}${delimiter}`),
        [' before', ' real expression comment']);
    }
  });
}

for (const { name, source, comments } of pythonInterpolationCases) {
  test('Python fallback interpolation: ' + name, () => {
    const extracted = extract(source);
    assert.deepEqual(extracted.map((c) => c.text), comments);
    for (const c of extracted) {
      const precedingLines = source.slice(0, c.start.offset).split(/\r\n|\r|\n/u);
      assert.equal(c.start.line, precedingLines.length);
      assert.equal(c.start.column, precedingLines.at(-1).length + 1);
    }
  });
}

for (const source of [
  'f"{}"', 'f"{ # no expression\n}"', 'f"{!r}"', 'f"{:x}"', 'f"{=}"', 'f"single }"',
  'f"{value"', 'f"{value # missing close}"', 'f"{(value]}"', 'f"{value!}"', 'f"{value!q}"',
  'f"{value!rr}"', 'f"{value!r!s}"', 'f"{value=other}"', 'f"{value:x"', 'f"{value:x\n}"',
  't"{value:{width}"', 'f"text\nmore"', String.raw`f"\N{}"`, String.raw`f"\N{unclosed"`,
]) {
  test('Python malformed interpolation discards partial comments: ' + JSON.stringify(source), () => {
    const result = extractPythonComments('# before\n' + source);
    assert.equal(result.status, 'invalid', JSON.stringify(result));
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.position.offset >= 9);
    assert.ok(result.diagnostic.position.offset <= source.length + 9);
  });
}

test('Python nested interpolation is bounded without throwing or retaining partial comments', () => {
  let nested = 'value';
  for (let i = 0; i < 140; i++) nested = 'f"{' + nested + '}"';
  const result = extractPythonComments('# before\n' + nested);
  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.comments, []);
  assert.match(result.diagnostic.message, /nesting/);
  assert.equal(extractPythonComments('f"{' + '('.repeat(129) + 'value' + ')'.repeat(129) + '}"').status, 'unsupported');
});

for (const source of ['"open', "'open", '"""open', "'''open", '"bad\nline"', '"bad\rline"',
  String.raw`r"odd\"`, String.raw`b'odd\'`, '"last\\', "\\", "x = 1 \\ # invalid", "x = 1 \\ \n", "\0", '"\0"', "# \0"]) {
  test("Python lexical errors discard partial comments: " + JSON.stringify(source), () => {
    const result = extractPythonComments("# before\n" + source);
    assert.equal(result.status, "invalid", JSON.stringify(result));
    assert.deepEqual(result.comments, []);
    assert.equal(result.diagnostic.position.line, 2);
    assert.ok(result.diagnostic.message.length > 0);
  });
}

test("Python UTF-8 cookies are accepted and active other encodings are explicit", () => {
  for (const name of ["utf-8", "UTF-8", "utf8", "utf_8"]) {
    assert.equal(extractPythonComments(`\ufeff# coding=${name}\n# real`).status, "ok");
  }
  for (const first of ["", "#!/usr/bin/python\n", " \t\f\r\n"]) {
    const result = extractPythonComments(first + "# coding: latin-1\n# real");
    assert.equal(result.status, "unsupported");
    assert.deepEqual(result.comments, []);
  }
  assert.equal(extractPythonComments("# coding: utf-8\n# coding: latin-1").status, "ok");
  for (const source of ["# note\u2028coding: latin-1", "# note\u2029\n# coding: latin-1"]) {
    assert.equal(extractPythonComments(source).status, "unsupported");
  }
  for (const source of ['x = 1\n# coding: latin-1', '# one\n# two\n# coding: latin-1', 'x = "coding: latin-1"']) {
    assert.equal(extractPythonComments(source).status, "ok");
  }
});

test("Python extraction neither executes code nor validates the full grammar", () => {
  assert.deepEqual(bodies('raise RuntimeError("must not run")\nimport missing_module\nif ??? # still a comment'), [" still a comment"]);
  assert.equal(extractPythonComments('`old_python2` # note').status, "unsupported");
});
