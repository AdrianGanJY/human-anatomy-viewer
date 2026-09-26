/**
 * THE BUILD ID, AS A FUNCTION OF THE TREE — L34, codex round 2 HIGH 2.
 *
 * Round 1's rows passed two already-different ID STRINGS into `snapCacheKey` and asserted the keys
 * differed. codex round 2 named that for what it is: proof that sha256 works, and no evidence at all
 * that two different TREES produce two different ids. That is the claim the deleted deploy tripwire
 * used to stand in for, so it is the claim that has to be executed.
 *
 * `scripts/build-id.mjs` therefore exports `deriveId(facts)` — a pure function of the git facts — and
 * these rows drive it directly. They also cover the two holes codex found in the round-1 fix:
 *
 *   · a git command that FAILS inside a repository must not collapse to `dev` (with the old blanket
 *     catch, two different multi-megabyte dirty trees both produced `dev` because `execFileSync`
 *     threw ENOBUFS at its 1 MiB default — so the second deploy served the first one's pictures, and
 *     the page-build guard could not tell them apart either);
 *   · the CONTENTS of untracked files must be part of the identity, not an accepted residual.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveId } from '../scripts/build-id.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'scripts', 'build-id.mjs'), 'utf8');

const clean = { hash: 'abc1234', status: '', diff: '', untracked: '' };

test('a clean tree is named by its commit and nothing else', () => {
  assert.equal(deriveId(clean), 'abc1234');
});

test('no git at all is `dev` — and deploy.ps1 refuses to ship it', () => {
  assert.equal(deriveId({ hash: '', status: '', diff: '', untracked: '' }), 'dev');
  const deploy = readFileSync(join(ROOT, 'deploy.ps1'), 'utf8');
  assert.match(deploy, /buildId -eq 'dev'/,
    'deploy.ps1 must refuse a `dev` build id outright — with or without -AllowDirty (codex round 2)');
});

test('TWO DIFFERENT DIRTY TREES produce two different ids', () => {
  const a = deriveId({ hash: 'abc1234', status: ' M app/scene.tsx', diff: '@@ -1 +1 @@\n-a\n+b', untracked: '' });
  const b = deriveId({ hash: 'abc1234', status: ' M app/scene.tsx', diff: '@@ -1 +1 @@\n-a\n+c', untracked: '' });
  assert.notEqual(a, b, 'the second dirty deploy would be served the first one\'s cached pictures');
  assert.notEqual(a, clean.hash);
  assert.match(a, /^abc1234-[0-9a-f]{10}$/);
});

test('the same dirty tree produces the SAME id — the cache still works within one build', () => {
  const facts = { hash: 'abc1234', status: ' M app/scene.tsx', diff: '@@ -1 +1 @@\n-a\n+b', untracked: '' };
  assert.equal(deriveId(facts), deriveId({ ...facts }));
});

test('a different set of CHANGED PATHS is a different id even with the same diff text', () => {
  const a = deriveId({ hash: 'abc1234', status: ' M app/scene.tsx', diff: 'X', untracked: '' });
  const b = deriveId({ hash: 'abc1234', status: ' M app/page.tsx', diff: 'X', untracked: '' });
  assert.notEqual(a, b);
});

/**
 * ⚠️ UNTRACKED CONTENTS ARE PART OF THE IDENTITY — codex round 2 refused to accept them as a residual,
 * correctly: a new file is a build input like any other. `readGitFacts` feeds `git hash-object` of every
 * untracked path into the digest.
 */
test('two trees differing only INSIDE the same untracked file are two different ids', () => {
  const a = deriveId({ hash: 'abc1234', status: '?? app/new.ts', diff: '', untracked: 'aaaaaaa app/new.ts' });
  const b = deriveId({ hash: 'abc1234', status: '?? app/new.ts', diff: '', untracked: 'bbbbbbb app/new.ts' });
  assert.notEqual(a, b);
});

test('the generator reads untracked CONTENTS, lists untracked files individually, and buffers a big diff', () => {
  assert.match(SRC, /'hash-object'/, 'untracked contents are not in the digest');
  assert.match(SRC, /'-uall'/, 'untracked files must be listed individually — hash-object cannot digest a directory');
  assert.match(SRC, /maxBuffer/, 'a diff over 1 MiB would throw ENOBUFS and collapse the id to `dev`');
});

/**
 * ⚠️ FAIL CLOSED INSIDE A REPOSITORY. Only `rev-parse` may conclude "there is no git here". Once it has
 * succeeded the tree demonstrably has a history, and a later git error means we cannot identify it —
 * answering `dev` there is exactly the collapse codex executed.
 */
test('only rev-parse may answer `dev`; a later git failure is not swallowed', () => {
  const fn = /export function readGitFacts\(\)[\s\S]*?\n}/.exec(SRC);
  assert.ok(fn, 'readGitFacts is no longer a named export this test can read');
  const body = fn[0];
  const catches = body.match(/catch/g) ?? [];
  assert.equal(catches.length, 1,
    'readGitFacts has more than one catch — a git failure after rev-parse must propagate, not degrade '
    + 'the build identity (codex round 2, HIGH 2)');
  assert.match(body, /return null; \/\/ a tarball/, 'the single catch must be the rev-parse one');
});
