import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { fixture } from "../helpers/config-fixture.mjs";
import { phpHelper } from "../../dist/scanners/comments/php-helper.js";
import { discoverPhpExecutables, runPhp } from "../../dist/scanners/comments/php-runtime.js";
import { createPhpCommentExtractor } from "../../dist/scanners/comments/php-tool.js";

const executable = resolve("test-php", process.platform === "win32" ? "php.exe" : "php");
const bytes = (source, at) => Buffer.byteLength(source.slice(0, at), "utf8");
const byteSpan = (source, kind, start, end, bodyStart, bodyEnd) =>
  [kind, ...[start, end, bodyStart, bodyEnd].map((at) => bytes(source, at))];

function reply(source) {
  const open = source.indexOf("<?php"), close = source.indexOf("?>", open) + 2;
  const line = source.includes("// line") ? "// line" : "// TODO";
  const block = source.includes("/** block */") ? "/** block */" : "/** FIXME */";
  const lineStart = source.indexOf(line), blockStart = source.indexOf(block);
  return { protocol: 1, version: "8.4.2", status: "ok",
    spans: [byteSpan(source, "line", lineStart, lineStart + line.length, lineStart + 2, lineStart + line.length),
      byteSpan(source, "block", blockStart, blockStart + block.length, blockStart + 2, blockStart + block.length - 2)],
    inline: [[0, bytes(source, open)], [bytes(source, close), bytes(source, source.length)]] };
}
function runtime({ candidates = [executable], response, error } = {}) {
  const calls = [];
  return { calls, discover: async () => candidates, run: async (path, program, input, env) => {
    calls.push({ path, program, input, env });
    if (error) throw error;
    const source = JSON.parse(input).source;
    return JSON.stringify(response ?? reply(source));
  } };
}

test("PHP selects token_get_all and maps PHP plus inline HTML comments to original offsets", async () => {
  const fake = runtime();
  const selected = await createPhpCommentExtractor({}, fake);
  assert.deepEqual(selected.backend, { kind: "official", name: "php-token-get-all", version: "8.4.2", executable });
  const source = '\ufeff<!-- before -->\r\n<?php $s = "😀"; // TODO\r\n/** FIXME */ ?>\r\n<!-- after -->';
  const result = await selected.extract(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.comments.map((item) => item.text), [" before ", " TODO", "* FIXME ", " after "]);
  assert.equal(result.comments[1].start.offset, source.indexOf("// TODO"));
  assert.equal(result.comments[1].start.line, 2);
  assert.equal(fake.calls[0].program, phpHelper);
  assert.ok(!phpHelper.includes(source));
  assert.equal(fake.calls.length, 2);
});

test("PHP unavailable or incompatible tools select a labelled built-in fallback", async () => {
  for (const fake of [runtime({ candidates: [] }), runtime({ error: Error("unavailable") }),
    runtime({ response: { ...reply("<!-- html --><?php // line\n/** block */ ?> <!-- tail -->"), version: "7.4.0" } })]) {
    const selected = await createPhpCommentExtractor({}, fake);
    assert.equal(selected.backend.kind, "builtin");
    assert.ok(selected.backend.reason);
    assert.deepEqual((await selected.extract("<?php // TODO\n")).comments.map((item) => item.text), [" TODO"]);
  }
});

test("PHP internal modes, explicit executable and source limit", async () => {
  const never = { discover() { throw Error("unexpected discovery"); }, run() { throw Error("unexpected launch"); } };
  assert.equal((await createPhpCommentExtractor({ mode: "builtin" }, never)).backend.kind, "builtin");
  await assert.rejects(createPhpCommentExtractor({ mode: "official" }, runtime({ candidates: [] })), /unavailable/);
  await assert.rejects(createPhpCommentExtractor({ executable: "php" }, never), /absolute/);
  await assert.rejects(createPhpCommentExtractor({ executable, mode: "builtin" }, never), /requires/);
  await assert.rejects(createPhpCommentExtractor({ mode: "other" }, never), /Unknown/);
  const selected = await createPhpCommentExtractor({ executable }, runtime());
  await assert.rejects(selected.extract("x".repeat(8 * 1024 * 1024 + 1)), /8 MiB/);
});

test("PHP source errors stay diagnostics; broken helper responses never silently fall back", async () => {
  const invalid = runtime();
  const selected = await createPhpCommentExtractor({}, invalid);
  invalid.run = async () => JSON.stringify({ protocol: 1, version: "8.4.2", status: "invalid", message: "syntax error" });
  const result = await selected.extract("<?php broken");
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.comments, []);

  for (const bad of ["not JSON", JSON.stringify({ protocol: 2 }),
    JSON.stringify({ protocol: 1, version: "8.5.0", status: "ok", spans: [], inline: [] }),
    JSON.stringify({ protocol: 1, version: "8.4.2", status: "ok", spans: [["line", 1, 99, 3, 99]], inline: [] })]) {
    const fake = runtime();
    const tool = await createPhpCommentExtractor({}, fake);
    fake.run = async () => bad;
    await assert.rejects(tool.extract("<?php // TODO\n"), /no fallback/);
  }
});

test("PHP discovery ignores relative PATH entries and aliases", async (t) => {
  const f = fixture(t), bin = join(f.root, "bin"), aliases = join(f.root, "WindowsApps");
  mkdirSync(bin); mkdirSync(aliases);
  const name = process.platform === "win32" ? "php.exe" : "php";
  writeFileSync(join(bin, name), "fixture only", { mode: 0o700 });
  writeFileSync(join(aliases, name), "alias", { mode: 0o700 });
  assert.deepEqual(await discoverPhpExecutables({ PATH: ["", ".", aliases, bin, bin].join(delimiter) }), [join(bin, name)]);
  await assert.rejects(runPhp("php", "", "", {}), /absolute/);
});

test("existing PHP CLI tokenizes mixed HTML and heredoc without executing source", async (t) => {
  const candidates = await discoverPhpExecutables(process.env);
  if (candidates.length === 0) return t.skip("PHP is not on PATH.");
  const selected = await createPhpCommentExtractor({ mode: "official", executable: candidates[0] });
  const source = "<!-- HTML --><?php $s = <<<'TXT'\n// hidden\nTXT;\n// TODO real\n?> <!-- after -->";
  const result = await selected.extract(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.comments.map((item) => item.text), [" HTML ", " TODO real", " after "]);
});
