import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCodeReportTerminal, renderCombinedReportTerminal, renderGroupedReportTerminal } from "../../dist/reports/render/terminal.js";

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
  assert.match(text, /^Graveyard — code comments\nGenerated: 2026-10-03T12:00:00.000Z\nBranches scanned: local\/main\nGroup: type\nFilters: includefresh=false\nOrder: oldnew/m);
  assert.match(text, /Code comments \(1\)/);
  assert.match(text, /Fresh 0 \| Ageing 0 \| Buried 0 \| Fossil 1/);
  assert.match(text, /🦖 \| 124 days \| TODO \| main:src\/worker\.js:7 \| replace old path \| Alex Smith/);
  assert.match(text, /Oldest: CODE · 124d · TODO · replace old path · main:src\/worker\.js:7/);
  assert.ok(text.endsWith("\n"));
});

test("detailed CLI rows align ages, markers, descriptions, and trailing metadata", () => {
  const younger = { ...finding, ageDays: 42, category: "ageing",
    primary: { ...primary, marker: "HACK", line: 9 },
    comment: { ...finding.comment, text: " HACK: fix later" } };
  const combined = { ...view, findings: [{ ...finding, ageDays: 1204 }, younger], branchFindings: [],
    counts: { total: 2, code: 2, branches: 0,
      categories: { fresh: 0, ageing: 1, buried: 0, fossil: 1 } },
    oldest: { kind: "code", finding } };
  const output = renderCombinedReportTerminal(combined);
  const [oldRow, youngRow] = output.split("\n").filter((line) => line.includes("TODO") || line.includes("HACK"));
  assert.match(output, /^🪦  PROJECT GRAVEYARD\nGenerated: 2026-10-03T12:00:00.000Z\nBranches scanned: local\/main\nGroup: type\nFilters: includefresh=false\nOrder: oldnew\n\nCODE DEBT +2\n─+/u);
  const codeHeading = output.split("\n").find((line) => line.startsWith("CODE DEBT"));
  assert.equal(codeHeading.length, 48);
  assert.ok(oldRow && youngRow);
  assert.equal(oldRow.indexOf("d  "), youngRow.indexOf("d  "));
  assert.equal(oldRow.indexOf("TODO"), youngRow.indexOf("HACK"));
  assert.equal(oldRow.indexOf("  ·  main:"), youngRow.indexOf("  ·  main:"));
  assert.match(oldRow, /1,204d/);
  assert.match(youngRow, /42d/);
  assert.match(output, /STALE BRANCHES +0\n─+\nNo matching stale branches found\./u);
  const branchHeading = output.split("\n").find((line) => line.startsWith("STALE BRANCHES"));
  assert.equal(branchHeading.length, 48);
  assert.match(output, /TOTAL : 2\n\nCODE : 2  ·  BRANCHES : 0\nAGES  🌱 0  💀 1  🪦 0  🦖 1\n\nOldest:/);
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
  assert.match(empty, /Oldest: none/);
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

test("author section headings strip control characters from Git identities", () => {
  const combined = { ...view, branchFindings: [],
    counts: { ...view.counts, branches: 0 }, oldest: { kind: "code", finding } };
  const output = renderGroupedReportTerminal(combined,
    [{ identity: "author", label: "\u001b[31mAlex", findings: [{ kind: "code", finding }] }], "author");
  assert.ok(!output.includes("\u001b"));
  assert.match(output, /\[31MALEX \(1\)/);
});
