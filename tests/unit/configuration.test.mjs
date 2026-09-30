import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateConfiguration } from "../../dist/config/validate.js";

const template = JSON.parse(readFileSync(new URL("../../templates/debt-watcher.config.json", import.meta.url), "utf8"));

test("default template is valid and uses the agreed 30-day freshness threshold", () => {
  const result = validateConfiguration(template);
  assert.equal(result.fresh, 30);
  assert.equal(result.includeFresh, false);
  assert.equal(result.showAuthors, true);
  assert.equal(result.order, "oldnew");
  assert.equal(result.reportDirectory, "./debt-watcher-reports");
  for (const key of ["ageing", "buried", "fossil"]) assert.equal(Object.hasOwn(result, key), false);
});

test("validation preserves saved values and optional metadata without normalising or adding defaults", () => {
  const document = Object.freeze({ ...template, fresh: 15, markers: Object.freeze(["TO DO", "TODO, later"]),
    reportDirectory: "./my reports", $schema: "./local-schema.json", metadata: Object.freeze({ team: "tools" }) });
  const before = JSON.stringify(document);
  assert.strictEqual(validateConfiguration(document), document);
  assert.equal(JSON.stringify(document), before);
});

test("a complete custom set is valid; freshness is an independent inclusion threshold", () => {
  const custom = { ...template, fresh: 90, ageing: 60, buried: 120, fossil: 365 };
  assert.deepEqual(validateConfiguration(custom), custom);
});

test("zero days and an empty marker list are valid explicit settings", () => {
  assert.deepEqual(validateConfiguration({ ...template, fresh: 0, markers: [] }), { ...template, fresh: 0, markers: [] });
});

for (const value of [null, [], "config", 30]) {
  test(`rejects non-object configuration: ${JSON.stringify(value)}`, () => {
    assert.throws(() => validateConfiguration(value), /JSON object/);
  });
}

const invalid = [
  [{ fresh: undefined }, /fresh/],
  [{ fresh: "30" }, /fresh/],
  [{ fresh: -1 }, /fresh/],
  [{ fresh: 1.5 }, /fresh/],
  [{ fresh: NaN }, /fresh/],
  [{ fresh: Number.MAX_SAFE_INTEGER + 1 }, /fresh/],
  [{ includeFresh: "false" }, /includeFresh/],
  [{ includeFresh: undefined }, /includeFresh/],
  [{ showAuthors: 1 }, /showAuthors/],
  [{ order: "reverse" }, /order/],
  [{ reportDirectory: " " }, /reportDirectory/],
  [{ reportDirectory: "bad\0path" }, /reportDirectory/],
  [{ reportDirectory: 30 }, /reportDirectory/],
  [{ markers: "TODO" }, /markers/],
  [{ markers: [""] }, /non-empty/],
  [{ markers: [" "] }, /non-empty/],
  [{ markers: [42] }, /string/],
  [{ markers: [" TODO "] }, /surrounding whitespace/],
  [{ markers: ["TODO", "TODO"] }, /duplicate/],
  [{ ageing: 60 }, /together/],
  [{ ageing: 60, buried: 120 }, /together/],
  [{ ageing: 60, buried: 60, fossil: 365 }, /increase strictly/],
  [{ ageing: 120, buried: 60, fossil: 365 }, /increase strictly/],
  [{ ageing: 60, buried: 365, fossil: 120 }, /increase strictly/],
  [{ ageing: "60", buried: 120, fossil: 365 }, /ageing/],
  [{ ageing: 60, buried: -1, fossil: 365 }, /buried/],
  [{ ageing: 60, buried: 120, fossil: null }, /fossil/],
  [{ include_fresh: true }, /Unknown configuration key 'include_fresh'/],
  [{ metadata: [] }, /metadata/],
  [{ $schema: 123 }, /\$schema/],
];
for (const [changes, message] of invalid) {
  test(`invalid saved settings: ${JSON.stringify(changes)}`, () => {
    assert.throws(() => validateConfiguration({ ...template, ...changes }), message);
  });
}

for (const marker of ["// TODO", "# TODO", "/* TODO */", "<!-- TODO -->", "{# TODO #}", "{/* TODO */}"]) {
  test(`rejects a comment-delimited marker: ${marker}`, () => {
    assert.throws(() => validateConfiguration({ ...template, markers: [marker] }), /comment delimiters/);
  });
}

test("all required settings are validated, rather than silently filled from the template", () => {
  assert.throws(() => validateConfiguration({}), (error) => {
    for (const key of ["fresh", "markers", "includeFresh", "showAuthors", "order", "reportDirectory"]) {
      assert.ok(error.message.includes(key));
    }
    return true;
  });
});
