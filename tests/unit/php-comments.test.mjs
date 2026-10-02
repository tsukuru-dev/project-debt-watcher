import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPhpComments } from "../../dist/scanners/comments/php.js";
import { languageForPath } from "../../dist/scanners/comments/languages.js";

function comments(source) {
  const result = extractPhpComments(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  for (const entry of result.comments) {
    assert.equal(source.slice(entry.start.offset, entry.end.offset), entry.raw);
    assert.equal(source.slice(entry.contentStart.offset, entry.contentEnd.offset), entry.text);
  }
  return result.comments;
}

test("PHP extensions are classified without changing plain HTML", () => {
  assert.equal(languageForPath("index.php"), "php");
  assert.equal(languageForPath("view.phtml"), "php");
  assert.equal(languageForPath("index.html"), "html");
});

test("PHP and surrounding HTML comments retain source order and positions", () => {
  const source = '\ufeff<!-- TODO html -->\r\n<?php // FIXME php\r\n# NOTE shell\r\n/* TODO block */ ?>'
    + '<!-- TODO after -->';
  const found = comments(source);
  assert.deepEqual(found.map((entry) => entry.text),
    [" TODO html ", " FIXME php", " NOTE shell", " TODO block ", " TODO after "]);
  assert.deepEqual(found.map((entry) => entry.kind), ["block", "line", "line", "block", "block"]);
  assert.equal(found[1].start.line, 2);
  assert.equal(found[2].start.line, 3);
});

test("PHP close tag ends a line comment and the following HTML is scanned", () => {
  assert.deepEqual(comments('<?php // TODO before?>\r\n<!-- FIXME after -->').map((entry) => entry.text),
    [" TODO before", " FIXME after "]);
  assert.deepEqual(comments('<?= "literal // TODO" ?> <!-- FIXME html -->').map((entry) => entry.text),
    [" FIXME html "]);
});

test("PHP strings hide comment-looking text and block comments do not close on ?>", () => {
  const source = `<?php $a = '// fake'; $b = "/* fake */ ?>"; /* TODO ?> still PHP */ // FIXME
?>`;
  assert.deepEqual(comments(source).map((entry) => entry.text), [" TODO ?> still PHP ", " FIXME"]);
  assert.deepEqual(comments('<?php #[Route("/todo")] // real\n').map((entry) => entry.text), [" real"]);
});

test("PHP-only and HTML-only files use their respective comment syntax", () => {
  assert.deepEqual(comments("<?php // TODO\n").map((entry) => entry.text), [" TODO"]);
  assert.deepEqual(comments("<!-- TODO --> // plain HTML text").map((entry) => entry.text), [" TODO "]);
  assert.deepEqual(comments("İ 😀 <?PHP // TODO\n").map((entry) => entry.text), [" TODO"]);
});

test("unsupported PHP syntax and mixed HTML contexts return no partial comments", () => {
  const cases = [
    "<!-- first --><? echo 1; ?>",
    "<!-- first --><?php echo <<<TXT\n// text\nTXT;",
    '<!-- first --><?php echo `date`; ?>',
    '<!-- first --><?php echo "{$object->name}"; ?>',
    '<!-- before <?php // TODO ?> after -->',
    '<!-- first --><script type="text/babel">/* TODO */</script>',
  ];
  for (const source of cases) {
    const result = extractPhpComments(source);
    assert.equal(result.status, "unsupported", source);
    assert.deepEqual(result.comments, []);
  }
});

test("unterminated PHP strings and block comments return invalid without partial comments", () => {
  for (const source of ['<?php // earlier\n"open', "<?php /* open", "<?php 'open\\"]) {
    const result = extractPhpComments(source);
    assert.equal(result.status, "invalid", source);
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.message);
  }
});
