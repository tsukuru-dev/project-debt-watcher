import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseClosingLine } from "../../dist/reports/messages.js";

const base = {
  counts: { total: 0, code: 0, branches: 0,
    categories: { fresh: 0, ageing: 0, buried: 0, fossil: 0 } },
  oldest: undefined,
  unscanned: [],
};

test("closing lines reflect displayed debt and avoid claiming unscanned files are clear", () => {
  assert.equal(chooseClosingLine(base, () => 0), "Nothing surfaced in this view today.");
  assert.equal(chooseClosingLine({ ...base, unscanned: [{}] }, () => 0),
    "Some corners of the graveyard remain unexplored.");

  const old = { ...base, counts: { ...base.counts, total: 1, code: 1,
    categories: { ...base.counts.categories, fossil: 1 } },
  oldest: { kind: "code", finding: { ageDays: 400 } } };
  assert.equal(chooseClosingLine(old, () => 0), "It's probably not temporary anymore.");
  assert.equal(chooseClosingLine(old, () => 4), "That one has survived more than one spring clean.");

  const branches = { ...base, counts: { ...base.counts, total: 2, branches: 2,
    categories: { ...base.counts.categories, ageing: 2 } } };
  assert.equal(chooseClosingLine(branches, () => 0), "These branches have started paying rent.");
  assert.equal(chooseClosingLine({ ...branches, counts: { ...branches.counts, branches: 0, code: 2 } },
    () => 0), "Future you has left the chat.");
});
