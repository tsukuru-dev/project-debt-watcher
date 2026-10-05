import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDetailedGroups } from "../../dist/reports/grouping.js";

const code = (name, email, authoredAt, category, ageDays, path) => ({
  branch: { ref: "refs/heads/main" }, file: { path }, primary: {
    line: 1, attribution: { authorName: name, authorEmail: email, authoredAt },
  }, category, ageDays,
});
const branch = (name, email, committedAt, category, ageDays, ref) => ({
  branch: { ref }, authorName: name, authorEmail: email, committedAt, category, ageDays,
});

test("author sections combine code and branches only for matching email identities", () => {
  const view = { order: "oldnew", findings: [
    code("Alex", "alex@example.test", "2020-01-01T00:00:00.000Z", "fossil", 100, "a.js"),
    code("Alex", "other@example.test", "2022-01-01T00:00:00.000Z", "buried", 70, "b.js"),
    code("", "", "2023-01-01T00:00:00.000Z", "ageing", 40, "c.js"),
  ], branchFindings: [
    branch("Alex Alias", "ALEX@example.test", "2021-01-01T00:00:00.000Z", "fossil", 90, "refs/heads/old"),
  ] };
  const groups = buildDetailedGroups(view, "author");
  assert.deepEqual(groups.map((group) => [group.label, group.findings.length]), [
    ["Alex <alex@example.test>", 2], ["Alex <other@example.test>", 1], ["Unknown", 1],
  ]);
  assert.deepEqual(groups[0].findings.map((entry) => entry.kind), ["code", "branches"]);
  assert.deepEqual(buildDetailedGroups({ ...view, order: "newold" }, "author")
    .map((group) => group.label), ["Unknown", "Alex <other@example.test>", "Alex <alex@example.test>"]);
});

test("age sections follow report order and omit empty categories", () => {
  const view = { order: "oldnew", findings: [
    code("A", "a@example.test", "2020-01-01T00:00:00.000Z", "fossil", 100, "a.js"),
    code("B", "b@example.test", "2024-01-01T00:00:00.000Z", "fresh", 2, "b.js"),
  ], branchFindings: [
    branch("A", "a@example.test", "2020-06-01T00:00:00.000Z", "fossil", 95, "refs/heads/old"),
  ] };
  assert.deepEqual(buildDetailedGroups(view, "age").map((group) => [group.label, group.findings.length]),
    [["fossil", 2], ["fresh", 1]]);
  assert.deepEqual(buildDetailedGroups({ ...view, order: "newold" }, "age")
    .map((group) => group.label), ["fresh", "fossil"]);
});
