import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyConfigurationEdit, parseConfigurationEdit } from "../../dist/config/actions.js";

const template = JSON.parse(readFileSync(new URL("../../templates/debt-finder.config.json", import.meta.url), "utf8"));
const { ageing: _ageing, buried: _buried, ...automatic } = template;
const custom = { ...template, ageing: 60, buried: 120 };
const set = (document, ...assignments) => applyConfigurationEdit(document,
  parseConfigurationEdit({ action: "set", assignments }));

test("fresh alone selects automatic bands even when the saved freshness value is unchanged", () => {
  const original = Object.freeze({ ...custom, $schema: "./schema.json", metadata: { team: "tools" } });
  const result = set(original, "fresh=30");
  assert.equal(result.changed, true);
  assert.match(result.message, /automatic age bands/);
  assert.deepEqual(result.document, { ...automatic, $schema: "./schema.json", metadata: { team: "tools" } });
  assert.equal(original.ageing, 60);
});

test("custom bands are merged and validated together, not one assignment at a time", () => {
  assert.throws(() => set(custom, "ageing=150"), /increase strictly/);
  const result = set(custom, "ageing=150", "buried=200", "fresh=45");
  assert.deepEqual(result.document, { ...custom, fresh: 45, ageing: 150, buried: 200 });
  assert.throws(() => set(automatic, "fresh=45", "ageing=60"), /together/);
  assert.deepEqual(set(template, "ageing=60", "buried=120").document, custom);
});

test("settings without fresh preserve custom bands and do not mutate the input", () => {
  const original = structuredClone(custom);
  const result = set(custom, "includeFresh=true", "showAuthors=false", "order=newold");
  assert.deepEqual(result.document, { ...custom, includeFresh: true, showAuthors: false, order: "newold" });
  assert.deepEqual(custom, original);
  assert.equal(set(custom, "fresh=30", "ageing=60").changed, false);
});

test("marker edits preserve internal spaces and case; add/remove requests are idempotent", () => {
  const current = { ...template, markers: ["TODO", "TEMP", "TODO, later"] };
  const added = applyConfigurationEdit(current,
    parseConfigurationEdit({ action: "add", assignment: "markers= TODO, TO DO,TO DO,todo " }));
  assert.deepEqual(added.document.markers, ["TODO", "TEMP", "TODO, later", "TO DO", "todo"]);
  const removed = applyConfigurationEdit(added.document,
    parseConfigurationEdit({ action: "remove", assignment: "markers=TEMP,TEMP,ABSENT" }));
  assert.deepEqual(removed.document.markers, ["TODO", "TODO, later", "TO DO", "todo"]);
  assert.deepEqual(set(current, "markers= FIXME,TO DO ").document.markers, ["FIXME", "TO DO"]);
  assert.deepEqual(current.markers, ["TODO", "TEMP", "TODO, later"]);
});

test("quoted path values retain spaces, backslashes and additional equals signs", () => {
  const path = "C:\\Users\\A Person\\reports=latest";
  assert.equal(set(template, "reportDirectory=" + path).document.reportDirectory, path);
});

const invalidAssignments = [
  ["fresh=-1", /whole number/],
  ["fresh=1.5", /whole number/],
  ["fresh=1e2", /whole number/],
  ["fresh=9007199254740992", /whole number/],
  ["includeFresh=1", /true or false/],
  ["showAuthors=False", /true or false/],
  ["order=random", /oldnew/],
  ["markers=TODO,,FIXME", /non-empty/],
  ["markers=TODO,TODO", /duplicate/],
  ["markers=// TODO", /comment delimiters/],
  ["reportDirectory=bad\0path", /reportDirectory/],
  ["include_fresh=true", /Unknown configuration key/],
  ["metadata=replace", /Unknown configuration key/],
  ["__proto__=replace", /Unknown configuration key/],
  ["fresh", /key=value/],
  ["fresh= ", /non-empty/],
];
for (const [assignment, message] of invalidAssignments) {
  test("rejects invalid edit: " + JSON.stringify(assignment), () => {
    assert.throws(() => set(template, assignment), message);
  });
}

test("duplicate settings and invalid marker removals fail before editing", () => {
  assert.throws(() => set(template, "fresh=30", "fresh=60"), /Duplicate setting/);
  assert.throws(() => parseConfigurationEdit({ action: "remove", assignment: "markers=// TODO" }), /comment delimiters/);
  assert.throws(() => parseConfigurationEdit({ action: "add", assignment: "fresh=60" }), /only markers/);
});
