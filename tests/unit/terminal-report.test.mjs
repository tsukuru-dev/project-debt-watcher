import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCodeReportTerminal } from "../../dist/reports/render/terminal.js";

const position = { offset: 0, line: 1, column: 1 };
const branch = { ref: "refs/heads/main", name: "main", commitId: "a".repeat(40), scope: "local" };
const file = { path: "src/worker.js", blobId: "b".repeat(40), size: 20,
  language: "javascript", mode: "100644" };
const primary = { marker: "TODO", startOffset: 3, endOffset: 7, line: 7,
  attribution: { commitId: "c".repeat(40), authorName: "Alex Smith", authorEmail: "alex@example.test",
    authoredAt: "2026-06-01T00:00:00.000Z", summary: "Add TODO" } };
const finding = { branch, file, comment: { kind: "line", raw: "// TODO: replace old path",
  text: " TODO: replace old path", start: position, end: position,
  contentStart: position, contentEnd: position }, matches: [primary], primary,
ageDays: 124, category: "fossil" };
const view = { generatedAt: "2026-10-03T12:00:00.000Z", branches: [branch], backends: {},
  settings: { showAuthors: true }, thresholds: { mode: "custom", fresh: 30, ageing: 60, buried: 90 },
  filters: { includeFresh: false }, order: "oldnew", findings: [finding], unscanned: [],
  counts: { total: 1, code: 1, categories: { fresh: 0, ageing: 0, buried: 0, fossil: 1 } }, oldest: finding };

test("terminal report shows code totals, age, source location, comment and blamed author", () => {
  const text = renderCodeReportTerminal(view);
  assert.match(text, /^Graveyard — code comments\nGenerated: 2026-10-03T12:00:00.000Z\nBranches: local\/main/m);
  assert.match(text, /Code comments \(1\)/);
  assert.match(text, /Fresh 0 \| Ageing 0 \| Buried 0 \| Fossil 1/);
  assert.match(text, /🦖 \| 124 days \| TODO \| main:src\/worker\.js:7 \| replace old path \| Alex Smith/);
  assert.match(text, /Oldest code comment: 124 days \| main:src\/worker\.js:7/);
  assert.ok(text.endsWith("\n"));
});

test("author visibility follows saved settings, while coverage remains explicit for an empty match", () => {
  const hidden = renderCodeReportTerminal({ ...view, settings: { showAuthors: false } });
  assert.ok(!hidden.includes("Alex Smith"));
  const empty = renderCodeReportTerminal({ ...view, findings: [], oldest: undefined,
    counts: { total: 0, code: 0, categories: { fresh: 0, ageing: 0, buried: 0, fossil: 0 } },
    unscanned: [{ branch, file: { ...file, path: "src/broken.js" }, status: "unsupported",
      diagnostic: { message: "Unclosed string", position: { ...position, line: 12 } } }] });
  assert.match(empty, /No matching code comments found/);
  assert.match(empty, /Unscanned files \(1\); debt in these files is unknown/);
  assert.match(empty, /main:src\/broken\.js — unsupported: Unclosed string \(line 12\)/);
  assert.ok(!empty.includes("Oldest code comment:"));
});

test("a caller-supplied committed-source URL becomes a terminal link; unsafe URLs stay plain", () => {
  const target = "https://example.test/repo/blob/" + branch.commitId + "/src/worker.js#L7";
  const linked = renderCodeReportTerminal(view, { sourceLink: () => target });
  assert.ok(linked.includes(`\u001b]8;;${target}\u0007main:src/worker.js:7\u001b]8;;\u0007`));
  const unsafe = renderCodeReportTerminal(view, { sourceLink: () => "javascript:alert(1)" });
  assert.ok(!unsafe.includes("\u001b"));
  assert.ok(unsafe.includes("main:src/worker.js:7"));
});

test("committed control characters cannot add terminal escapes or extra report lines", () => {
  const hostile = { ...finding, file: { ...file, path: "src/\u001b[31mworker.js" },
    comment: { ...finding.comment, text: " TODO: first\nsecond\u001b]8;;bad\u0007" } };
  const text = renderCodeReportTerminal({ ...view, findings: [hostile], oldest: hostile });
  assert.ok(!text.includes("\u001b"));
  assert.match(text, /src\/ \[31mworker\.js:7 \| first second \]8;;bad/);
});
