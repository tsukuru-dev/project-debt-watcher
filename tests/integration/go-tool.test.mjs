import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGoCommentExtractor } from '../../dist/scanners/comments/go-tool.js';
import { extractGoComments } from '../../dist/scanners/comments/go.js';

test('installed go/scanner agrees with the fallback on comments and source positions', async (t) => {
  const selected = await createGoCommentExtractor();
  if (selected.backend.kind !== 'official') { t.skip(selected.backend.reason); return; }
  try {
    for (const source of ['', '\ufeffvar s = "😀/* hidden */" // one\r\n/* body\r\nsecond */',
      '//go:generate do-not-run\n//line imaginary.go:500\n// real',
      'var s = `// hidden\n/* hidden */` // real', "var r = '\\u002f' // real"]) {
      assert.deepEqual(await selected.extract(source), extractGoComments(source), JSON.stringify(source));
    }
    const malformed = await selected.extract('// before\n"unterminated');
    assert.equal(malformed.status, 'invalid');
    assert.deepEqual(malformed.comments, []);
  } finally { await selected.close(); }
});
