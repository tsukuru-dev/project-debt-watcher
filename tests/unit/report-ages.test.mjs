import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ageInDays, categoryForAge, resolveAgeThresholds } from "../../dist/reports/ages.js";
import { buildCodeFindings } from "../../dist/reports/build.js";

const template = JSON.parse(readFileSync(new URL("../../templates/debt-watcher.config.json", import.meta.url), "utf8"));
const { ageing: _ageing, buried: _buried, ...automatic } = template;

test("age counts complete elapsed days and clamps future dates to zero", () => {
  const now = new Date("2026-10-02T12:00:00.000Z");
  assert.equal(ageInDays("2026-10-01T12:00:00.000Z", now), 1);
  assert.equal(ageInDays("2026-10-01T12:00:00.001Z", now), 0);
  assert.equal(ageInDays("2026-10-03T12:00:00.000Z", now), 0);
  assert.equal(ageInDays("2026-09-01T12:00:00+01:00", now), 31);
});

test("invalid timestamps cannot silently become zero-aged findings", () => {
  assert.throws(() => ageInDays("not a date", new Date()), /invalid date/);
  assert.throws(() => ageInDays("2026-01-01", new Date("invalid")), /invalid date/);
});

test("custom age thresholds include their upper bounds and fossil starts above buried", () => {
  const thresholds = resolveAgeThresholds({ ...template, fresh: 30, ageing: 60, buried: 120 }, 200);
  assert.deepEqual(thresholds, { mode: "custom", fresh: 30, ageing: 60, buried: 120 });
  for (const [age, category] of [[0, "fresh"], [30, "fresh"], [31, "ageing"],
    [60, "ageing"], [61, "buried"], [120, "buried"], [121, "fossil"]]) {
    assert.equal(categoryForAge(age, thresholds), category, `age ${age}`);
  }
  assert.throws(() => categoryForAge(-1, thresholds), /non-negative/);
});

test("the supplied template uses fixed 30, 60 and 90 day boundaries", () => {
  const thresholds = resolveAgeThresholds(template, 200);
  assert.deepEqual(thresholds, { mode: "custom", fresh: 30, ageing: 60, buried: 90 });
  for (const [age, category] of [[30, "fresh"], [31, "ageing"], [60, "ageing"],
    [61, "buried"], [90, "buried"], [91, "fossil"]]) {
    assert.equal(categoryForAge(age, thresholds), category, `age ${age}`);
  }
});

test("automatic thresholds divide the non-fresh range through the oldest finding", () => {
  const thresholds = resolveAgeThresholds(automatic, 120);
  assert.deepEqual(thresholds, { mode: "automatic", fresh: 30, ageing: 60, buried: 90 });
  assert.equal(categoryForAge(120, thresholds), "fossil");
  const empty = resolveAgeThresholds(automatic, 0);
  assert.equal(categoryForAge(30, empty), "fresh");
  assert.equal(categoryForAge(31, empty), "fossil");
});

test("a flagged comment is one finding aged by its oldest blamed marker; coverage remains visible", () => {
  const branch = { ref: "refs/heads/main", name: "main", commitId: "a".repeat(40), scope: "local" };
  const file = { path: "src/a.js", blobId: "b".repeat(40), size: 40, language: "javascript", mode: "100644" };
  const pos = { offset: 0, line: 1, column: 1 };
  const comment = { kind: "block", raw: "/* TODO FIXME */", text: " TODO FIXME ", start: pos,
    end: pos, contentStart: pos, contentEnd: pos };
  const marker = (name, date, author) => ({ marker: name, startOffset: 0, endOffset: name.length,
    line: 1, attribution: { commitId: "c".repeat(40), authorName: author,
      authorEmail: author + "@example.test", authoredAt: date, summary: "Add comment" } });
  const newer = marker("TODO", "2026-09-20T12:00:00.000Z", "Newer");
  const older = marker("FIXME", "2026-08-01T12:00:00.000Z", "Older");
  const scan = { branches: [{ branch, files: [
    { file, status: "ok", findings: [{ comment, matches: [newer, older] }] },
    { file: { ...file, path: "src/large.js" }, status: "skipped", reason: "too-large" },
    { file: { ...file, path: "src/broken.js" }, status: "invalid",
      diagnostic: { message: "Unclosed string", position: pos } },
  ] }], backends: { javascript: { kind: "builtin", name: "test", version: "1" } } };
  const result = buildCodeFindings(scan, template, new Date("2026-10-02T12:00:00.000Z"));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].primary.attribution.authorName, "Older");
  assert.equal(result.findings[0].ageDays, 62);
  assert.equal(result.findings[0].category, "buried");
  assert.equal(result.oldest, result.findings[0]);
  assert.deepEqual(result.unscanned.map((item) => item.status), ["skipped", "invalid"]);
  assert.deepEqual(result.backends, scan.backends);
  assert.equal(scan.branches[0].files[0].findings[0].matches.length, 2);
});
