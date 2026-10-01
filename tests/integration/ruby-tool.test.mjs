import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture } from '../helpers/config-fixture.mjs';
import { createRubyCommentExtractor } from '../../dist/scanners/comments/ruby-tool.js';
import { extractRubyComments } from '../../dist/scanners/comments/ruby.js';
import { listSourceFiles, readSourceFile } from '../../dist/git/files.js';
import { selectBranches } from '../../dist/git/branches.js';

const detected = createRubyCommentExtractor();
async function official(t) {
  const extractor = await detected;
  if (extractor.backend.kind !== 'official') { t.skip(extractor.backend.reason); return; }
  return extractor;
}

test('installed Ripper agrees with Ruby fallback on supported comments and original positions', async (t) => {
  const extractor = await official(t); if (!extractor) return;
  for (const source of ['', '\ufeffx="😀" # note\r\n# last', '=begin tag\r\nbody\r\n=end suffix\r\n# end',
    '# note\n__END__\n# data', 'x = "# hidden" # real', '# coding: utf-8\n# TODO']) {
    assert.deepEqual(await extractor.extract(source), extractRubyComments(source), JSON.stringify(source));
  }
});

test('installed Ripper distinguishes interpolation comments from regex, percent and heredoc text', async (t) => {
  const extractor = await official(t); if (!extractor) return;
  const source = 'x = "#{1 # inner\n}"\ny = /#hidden/\nz = %q{# hidden}\na = <<~TEXT\n# hidden\nTEXT\n# outside';
  const result = await extractor.extract(source);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.deepEqual(result.comments.map((c) => c.text), [' inner', ' outside']);
  const invalid = await extractor.extract('# prior\nx = "unfinished');
  assert.equal(invalid.status, 'invalid');
  assert.deepEqual(invalid.comments, []);
});

test('installed Ripper does not execute source, BEGIN blocks, requires or RUBYOPT startup hooks', async (t) => {
  const extractor = await official(t); if (!extractor) return;
  const f = fixture(t), marker = join(f.root, 'executed.txt'), hook = join(f.root, 'hook.rb');
  const payload = `File.write(${JSON.stringify(marker.replaceAll('\\', '/'))}, 'BAD')`;
  writeFileSync(hook, payload);
  const isolated = await createRubyCommentExtractor({ mode: 'official', executable: extractor.backend.executable,
    env: { ...process.env, RUBYOPT: `-r${hook}`, RUBYLIB: f.root, BUNDLE_GEMFILE: join(f.root, 'Gemfile') } });
  const result = await isolated.extract(`BEGIN { ${payload} }\n${payload}\nrequire 'missing_project_library'\n# real`);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(existsSync(marker), false);
});

test('Ruby source selection and fallback scan committed files without executing project files', async (t) => {
  const f = fixture(t), repo = f.repository(), context = { cwd: repo, env: f.env };
  for (const name of ['main.rb', 'Gemfile', 'Rakefile']) writeFileSync(join(repo, name), '# TODO committed\n');
  f.git(repo, ['add', '.']); f.git(repo, ['commit', '--quiet', '-m', 'Ruby source']);
  const [branch] = await selectBranches(context);
  writeFileSync(join(repo, 'main.rb'), '# dirty');
  const before = f.git(repo, ['status', '--porcelain=v1']);
  const extractor = await createRubyCommentExtractor({ mode: 'builtin' });
  const files = await listSourceFiles(branch.commitId, context);
  assert.equal(files.length, 3);
  for (const file of files) {
    assert.equal(file.language, 'ruby');
    const saved = await readSourceFile(file, context);
    assert.equal(saved.kind, 'text');
    assert.deepEqual((await extractor.extract(saved.text)).comments.map((c) => c.text), [' TODO committed']);
  }
  assert.equal(f.git(repo, ['status', '--porcelain=v1']), before);
  assert.equal(readFileSync(join(repo, 'main.rb'), 'utf8'), '# dirty');
});
