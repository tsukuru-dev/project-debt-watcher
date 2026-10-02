import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildCodeReportView } from "../../dist/reports/filters.js";

const settings = JSON.parse(readFileSync(new URL("../../templates/debt-watcher.config.json", import.meta.url), "utf8"));
const position = { offset: 0, line: 1, column: 1 };

function finding(path, authoredAt, authorName, authorEmail, category, offset = 0) {
  const primary = { marker: "TODO", startOffset: offset, endOffset: offset + 4, line: 1,
    attribution: { commitId: "c".repeat(40), authoredAt, authorName, authorEmail, summary: "Add TODO" } };
  return { branch: { ref: "refs/heads/main", name: "main", commitId: "a".repeat(40), scope: "local" },
    file: { path, blobId: "b".repeat(40), size: 20, language: "javascript", mode: "100644" },
    comment: { kind: "line", raw: "// TODO", text: " TODO", start: { ...position, offset },
      end: position, contentStart: position, contentEnd: position },
    matches: [primary], primary, ageDays: 0, category };
}

const older = finding("src/z.js", "2026-01-01T08:00:00.000Z", "Alex Smith", "alex@example.test", "fossil");
const sameDayNewer = finding("src/a.js", "2026-01-01T20:00:00.000Z", "Pat Lee", "pat@example.test", "fossil");
const ageing = finding("src/c.js", "2026-08-10T12:00:00.000Z", "Alex Smith", "alex@example.test", "ageing");
const fresh = finding("src/d.js", "2026-09-20T12:00:00.000Z", "Pat Lee", "pat@example.test", "fresh");
const unscanned = [{ branch: older.branch, file: { ...older.file, path: "src/broken.js" },
  status: "unsupported", diagnostic: { message: "Unknown syntax", position } }];
const snapshot = { generatedAt: "2026-10-02T12:00:00.000Z", branches: [older.branch], backends: {},
  settings: { ...settings, showAuthors: false },
  thresholds: { mode: "custom", fresh: 30, ageing: 60, buried: 90 },
  findings: [fresh, sameDayNewer, ageing, older], unscanned, oldest: older };

test("default view excludes fresh items and counts only the displayed code findings", () => {
  const view = buildCodeReportView(snapshot);
  assert.deepEqual(view.findings, [older, sameDayNewer, ageing]);
  assert.deepEqual(view.counts, { total: 3, code: 3,
    categories: { fresh: 0, ageing: 1, buried: 0, fossil: 2 } });
  assert.equal(view.oldest, older);
  assert.equal(view.filters.includeFresh, false);
  assert.equal(view.unscanned, unscanned);
  assert.deepEqual(snapshot.findings, [fresh, sameDayNewer, ageing, older]);
});

test("temporary order and fresh inclusion change the view without changing its oldest item", () => {
  const view = buildCodeReportView(snapshot, { order: "newold", filter: { type: ["code"], includeFresh: true } });
  assert.deepEqual(view.findings, [fresh, ageing, sameDayNewer, older]);
  assert.equal(view.counts.total, 4);
  assert.equal(view.counts.categories.fresh, 1);
  assert.equal(view.oldest, older);
  assert.equal(snapshot.settings.includeFresh, false);
  assert.equal(snapshot.settings.order, "oldnew");
});

test("author filtering matches the primary blamed name or email even when author display is hidden", () => {
  for (const author of ["aLeX", "EXAMPLE.TEST"]) {
    const view = buildCodeReportView(snapshot, { filter: { author } });
    assert.deepEqual(view.findings, author === "aLeX" ? [older, ageing] : [older, sameDayNewer, ageing]);
  }
  const empty = buildCodeReportView(snapshot, { filter: { author: "nobody" } });
  assert.equal(empty.counts.total, 0);
  assert.equal(empty.oldest, undefined);
  assert.deepEqual(empty.counts.categories, { fresh: 0, ageing: 0, buried: 0, fossil: 0 });
});

test("equal timestamps have stable location ties in either display direction", () => {
  const a = finding("src/a.js", older.primary.attribution.authoredAt, "A", "a@example.test", "fossil");
  const z = finding("src/z.js", older.primary.attribution.authoredAt, "Z", "z@example.test", "fossil");
  const tied = { ...snapshot, findings: [z, a] };
  assert.deepEqual(buildCodeReportView(tied).findings, [a, z]);
  assert.deepEqual(buildCodeReportView(tied, { order: "newold" }).findings, [a, z]);
  assert.equal(buildCodeReportView(tied, { order: "newold" }).oldest, a);
});

test("unimplemented debt types are rejected rather than silently omitted", () => {
  for (const type of [["branches"], ["issues"], ["code", "branches"], []]) {
    assert.throws(() => buildCodeReportView(snapshot, { filter: { type } }), /Only type=code/);
  }
  assert.throws(() => buildCodeReportView(snapshot, { filter: { author: " " } }), /must not be empty/);
});
