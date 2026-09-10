/**
 * scripts/commit-run.sh against real git: a bare "remote" and a working clone.
 *
 * The two guarantees it must hold together — a failed run commits its ledger
 * line, AND a failed run never changes the archive — are only meaningful when
 * both are checked on the same failed run, so that is how the first test is
 * built: a run that half-wrote an edition, then failed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../scripts/commit-run.sh', import.meta.url).pathname;
const ATTRIBUTES = new URL('../.gitattributes', import.meta.url).pathname;

// Isolate from whatever global git config the machine has (signing, hooks,
// default branch) — the test must mean the same thing on a laptop and a runner.
const GIT_ENV = {
  PATH: process.env.PATH ?? '',
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root: string, path: string, content: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A remote holding one good published day, and a fresh clone of it. */
function setup(): { remote: string; work: string; base: string } {
  const base = mkdtempSync(join(tmpdir(), 'rd-commit-'));
  const remote = join(base, 'remote.git');
  const seed = join(base, 'seed');
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(base, 'init', '-q', '-b', 'main', seed);
  write(seed, 'archive/2026-09-09.html', 'GOOD EDITION\n');
  write(seed, 'archive/2026-09-09.json', '{"day":"2026-09-09"}\n');
  write(seed, 'index.html', 'INDEX\n');
  write(seed, 'state/seen.json', '{"entries":1}\n');
  write(seed, 'state/runs.jsonl', '{"runId":"2026-09-09","outcome":"published"}\n');
  writeFileSync(join(seed, '.gitattributes'), readFileSync(ATTRIBUTES, 'utf8'));
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', 'origin', 'main');
  const work = join(base, 'work');
  git(base, 'clone', '-q', remote, work);
  return { remote, work, base };
}

function commitRun(work: string, env: Record<string, string>): number | null {
  return spawnSync('bash', [SCRIPT], { cwd: work, encoding: 'utf8', env: { ...GIT_ENV, DAY: '2026-09-10', ...env } })
    .status;
}

const onRemote = (remote: string, path: string): string =>
  spawnSync('git', ['--git-dir', remote, 'show', `main:${path}`], { encoding: 'utf8', env: GIT_ENV }).stdout;
const changedOnRemote = (remote: string): string[] =>
  git(remote, 'diff', '--name-only', 'main~1', 'main').split('\n').filter(Boolean).sort();
const ledgerLine = (outcome: string): string => `${JSON.stringify({ runId: '2026-09-10', outcome })}\n`;

test('a FAILED run commits its ledger line and nothing else — the good archive survives', () => {
  const { remote, work } = setup();
  // The run got partway through writing an edition, then failed.
  write(work, 'archive/2026-09-09.html', 'HALF-WRITTEN\n');
  write(work, 'archive/2026-09-10.html', 'PARTIAL\n');
  write(work, 'index.html', 'BROKEN INDEX\n');
  write(work, 'state/seen.json', '{"entries":"corrupt"');
  appendFileSync(join(work, 'state/runs.jsonl'), ledgerLine('aborted'));

  assert.equal(commitRun(work, { PUBLISH: 'false', OUTCOME: 'aborted' }), 0);

  assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'ledger: 2026-09-10 aborted');
  assert.deepEqual(changedOnRemote(remote), ['state/runs.jsonl'], 'only the ledger moved');
  assert.equal(onRemote(remote, 'archive/2026-09-09.html'), 'GOOD EDITION\n');
  assert.equal(onRemote(remote, 'index.html'), 'INDEX\n');
  assert.equal(onRemote(remote, 'state/seen.json'), '{"entries":1}\n');
  assert.equal(onRemote(remote, 'archive/2026-09-10.html'), '', 'the partial page never reached main');
  assert.match(onRemote(remote, 'state/runs.jsonl'), /"outcome":"aborted"/);
  // And the working tree is clean of the partial output too.
  assert.equal(existsSync(join(work, 'archive/2026-09-10.html')), false);
});

test('a SKIPPED run commits its ledger line', () => {
  const { remote, work } = setup();
  appendFileSync(join(work, 'state/runs.jsonl'), ledgerLine('skipped'));
  assert.equal(commitRun(work, { PUBLISH: 'false', OUTCOME: 'skipped' }), 0);
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'ledger: 2026-09-10 skipped');
  assert.deepEqual(changedOnRemote(remote), ['state/runs.jsonl']);
});

test('a PUBLISHED run commits the edition together with its ledger line', () => {
  const { remote, work } = setup();
  write(work, 'archive/2026-09-10.html', 'NEW EDITION\n');
  write(work, 'archive/2026-09-10.json', '{"day":"2026-09-10"}\n');
  write(work, 'index.html', 'INDEX 2\n');
  write(work, 'state/seen.json', '{"entries":2}\n');
  appendFileSync(join(work, 'state/runs.jsonl'), ledgerLine('published'));
  assert.equal(commitRun(work, { PUBLISH: 'true' }), 0);
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'digest: 2026-09-10');
  assert.deepEqual(changedOnRemote(remote), [
    'archive/2026-09-10.html',
    'archive/2026-09-10.json',
    'index.html',
    'state/runs.jsonl',
    'state/seen.json',
  ]);
});

test('a run with no ledger line fails loudly instead of committing nothing quietly', () => {
  const { remote, work } = setup();
  const before = git(remote, 'rev-parse', 'main');
  assert.notEqual(commitRun(work, { PUBLISH: 'false', OUTCOME: 'aborted' }), 0);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
});

test('two runs appending to the ledger at once both survive the push race', () => {
  const { remote, work, base } = setup();
  // Someone else's ledger line lands on main first.
  const other = join(base, 'other');
  git(base, 'clone', '-q', remote, other);
  appendFileSync(join(other, 'state/runs.jsonl'), `${JSON.stringify({ runId: 'other', outcome: 'skipped' })}\n`);
  git(other, 'commit', '-q', '-am', 'ledger: other');
  git(other, 'push', '-q', 'origin', 'main');

  appendFileSync(join(work, 'state/runs.jsonl'), ledgerLine('aborted'));
  assert.equal(commitRun(work, { PUBLISH: 'false', OUTCOME: 'aborted' }), 0);

  const lines = onRemote(remote, 'state/runs.jsonl').trim().split('\n');
  assert.equal(lines.length, 3, 'seed + the other run + this run');
  for (const l of lines) JSON.parse(l); // every line still valid JSON — no conflict markers
  assert.ok(lines.some((l) => l.includes('"runId":"other"')));
  assert.ok(lines.some((l) => l.includes('"outcome":"aborted"')));
});
