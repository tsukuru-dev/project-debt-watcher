import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "../helpers/config-fixture.mjs";
import { createPythonCommentExtractor } from "../../dist/scanners/comments/python-tool.js";
import { extractPythonComments } from "../../dist/scanners/comments/python.js";
import { listSourceFiles, readSourceFile } from "../../dist/git/files.js";
import { selectBranches } from "../../dist/git/branches.js";

// Optional system integration: never download Python just to run a test.
const detected = createPythonCommentExtractor();
async function official(t) {
  const extractor = await detected;
  if (extractor.backend.kind !== "official") { t.skip(extractor.backend.reason); return; }
  return extractor;
}

test("installed Python agrees with the fallback on supported syntax and original positions", async (t) => {
  const extractor = await official(t); if (!extractor) return;
  for (const source of ["", '\ufeffx = "😀# hidden" # TODO\r\n#last',
    '"""# docstring\rnot debt"""\rx = rb"# raw"\r# real',
    '#!/usr/bin/python\n# coding: utf-8\nx = 1 # type: ignore',
    'x = "# string"\n# one\f\u2028\u2029# same physical line',
    'x = 1 + \\\r\n 2 # continued']) {
    assert.deepEqual(await extractor.extract(source), extractPythonComments(source), JSON.stringify(source));
  }
});

test("official Python extracts f-string expression comments, not literal text or format specifiers", async (t) => {
  const extractor = await official(t); if (!extractor) return;
  const source = 'x = f"""# literal {value # TODO expression\n} {number:#06x} {f"{other # nested\n}"}"""\n# outside';
  const result = await extractor.extract(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.comments.map((c) => c.text), [" TODO expression", " nested", " outside"]);
});

test("official Python handles template-string comments when the installed version supports them", async (t) => {
  const extractor = await official(t); if (!extractor) return;
  const result = await extractor.extract('x = t"{value # TODO template\n}"');
  if (Number(extractor.backend.version.split(".")[1]) >= 14) {
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(result.comments.map((c) => c.text), [" TODO template"]);
  } else assert.equal(result.status, "invalid");
});

test("official Python rejects malformed sources without retaining earlier comments", async (t) => {
  const extractor = await official(t); if (!extractor) return;
  for (const bad of ['"open', "x = (", "if ???", "\0", "x = f\"{1 # missing close\"", "x = '\\xZ0'"]) {
    const result = await extractor.extract("# before\n" + bad);
    assert.equal(result.status, "invalid", JSON.stringify(result));
    assert.deepEqual(result.comments, []);
    assert.ok(result.diagnostic.position.offset <= bad.length + 9);
  }
  assert.equal((await extractor.extract("# coding: latin-1\n# note")).status, "unsupported");
});

test("official Python does not import project modules, load startup hooks or execute scanned code", async (t) => {
  const extractor = await official(t); if (!extractor) return;
  const f = fixture(t), marker = join(f.root, "executed.txt");
  const payload = `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('BAD')\n`;
  for (const file of ["sitecustomize.py", "usercustomize.py", "tokenize.py", "ast.py"]) writeFileSync(join(f.root, file), payload);
  const isolated = await createPythonCommentExtractor({ executable: extractor.backend.executable, mode: "official",
    env: { ...process.env, PYTHONPATH: f.root, PYTHONSTARTUP: join(f.root, "sitecustomize.py"), PYTHONHOME: f.root } });
  const result = await isolated.extract(payload + "raise RuntimeError('not executed')\n# TODO real");
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(join(f.root, "__pycache__")), false);
});

test("official Python uses committed Git source rather than the working file", async (t) => {
  const extractor = await official(t); if (!extractor) return;
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  writeFileSync(join(repo, "main.py"), 'x = f"{value # TODO committed\n}"');
  f.git(repo, ["add", "main.py"]); f.git(repo, ["commit", "--quiet", "-m", "Python source"]);
  const [branch] = await selectBranches(context);
  writeFileSync(join(repo, "main.py"), "# dirty\n");
  const before = f.git(repo, ["status", "--porcelain=v1"]);
  const [file] = await listSourceFiles(branch.commitId, context);
  const saved = await readSourceFile(file, context);
  assert.equal(saved.kind, "text");
  const result = await extractor.extract(saved.text);
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.comments.map((c) => c.text), [" TODO committed"]);
  assert.equal(f.git(repo, ["status", "--porcelain=v1"]), before);
});
