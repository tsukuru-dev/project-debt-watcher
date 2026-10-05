import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveReportSettings } from "../../dist/reports/settings.js";

const saved = JSON.parse(readFileSync(new URL("../../templates/debt-finder.config.json", import.meta.url), "utf8"));

test("fresh-only override selects automatic bands without editing saved settings", () => {
  const effective = resolveReportSettings(saved, { fresh: 45, markers: ["TO DO"],
    order: "newold", filter: { includeFresh: true } });
  assert.equal(effective.fresh, 45);
  assert.equal(Object.hasOwn(effective, "ageing"), false);
  assert.equal(Object.hasOwn(effective, "buried"), false);
  assert.deepEqual(effective.markers, ["TO DO"]);
  assert.equal(effective.includeFresh, true);
  assert.equal(effective.order, "newold");
  assert.deepEqual([saved.fresh, saved.ageing, saved.buried, saved.includeFresh], [30, 60, 90, false]);
});

test("explicit age-band overrides merge and validate against saved values", () => {
  const effective = resolveReportSettings(saved, { fresh: 45, ageing: 75, buried: 120 });
  assert.deepEqual([effective.fresh, effective.ageing, effective.buried], [45, 75, 120]);
  assert.throws(() => resolveReportSettings(saved, { fresh: 45, ageing: 90 }), /increase strictly/);
  assert.throws(() => resolveReportSettings(saved, { markers: ["// TODO"] }), /comment delimiters/);
});
