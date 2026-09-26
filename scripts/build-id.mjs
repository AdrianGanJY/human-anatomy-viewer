/**
 * THE BUILD IDENTITY, WRITTEN ONCE PER BUILD — L34.
 *
 * usage: node scripts/build-id.mjs        (run by deploy.ps1 BEFORE `vite build`)
 *
 * WHAT THIS REPLACES, and why the replacement is the point of the increment.
 *
 * `SITE_BUILD` used to be a HAND-EDITED string literal in `workers/snap/wrangler.toml`. It is part
 * of the renderer's R2 cache key, so a render-path edit that forgot to move it served the PREVIOUS
 * build's pictures for the new build — at HTTP 200, with a plausible-looking picture, for as long as
 * the cache lived. That happened once for real (`p2` while the site had shipped P3 and P3r), and the
 * answer at the time was a tripwire in `deploy.ps1`: refuse the deploy if any file on a `renderPaths`
 * list is newer than the last commit that touched the toml. That guard then cost three "own commit"
 * SITE_BUILD bumps in L31 alone, each one an argued essay about whether a plate could have moved.
 *
 * The tripwire exists because the id could be forgotten. Derive the id and it cannot be:
 *
 *   git short hash, plus a digest of the uncommitted change when the tree is dirty
 *
 * Every commit is a new id, so every deploy retires exactly the pictures that a different commit
 * drew. A dirty tree gets its own id too, so a local `wrangler dev` render cannot land under the key
 * a committed build will later claim.
 *
 * ⚠️ THE COST IS STATED, NOT HIDDEN: the id now moves on EVERY commit, so every deploy is a cold
 * first render for each plate — where the hand-edited literal could deliberately stay put across a
 * commit that provably did not change a picture. That trade is taken on purpose. The old direction
 * failed silently (a wrong picture at 200); this one fails expensively and visibly (a slower first
 * render), and `plate-goldens.mjs compare` still proves the picture did not change.
 *
 * Deterministic and offline: two `git` reads and one file write. It writes the file only when the
 * contents would change, so it never touches the mtime of an unchanged build.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'worker', 'build-id.mjs');

/**
 * ⚠️ `maxBuffer` IS LOAD-BEARING, AND ITS ABSENCE WAS A REAL DEFECT — codex round 2, HIGH 2 (open).
 *
 * `execFileSync` defaults to a 1 MiB output buffer and THROWS `ENOBUFS` above it. With the previous
 * blanket `catch` that returned `dev`, codex executed the consequence: two *different* multi-megabyte
 * dirty trees both produced `SITE_BUILD = "dev"`, so the second deploy was served the first one's
 * pictures, and the page-build guard could not tell them apart either because both reported `dev`.
 * A failure that answers with a WEAKER identity is worse than no answer at all.
 */
const git = (args) => execFileSync('git', args, {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 512 * 1024 * 1024,
}).toString().trim();

/**
 * ══ THE ID, AS A PURE FUNCTION OF FACTS ABOUT THE TREE ═════════════════════════════════════════
 *
 * Separated from the git calls so `test/build-id.test.mjs` can execute it: codex round 2's test gap
 * was that the previous rows compared two already-different ID STRINGS, which proves the hash function
 * works and says nothing about whether two different TREES produce different ids.
 *
 *   clean tree  -> `<short hash>`
 *   dirty tree  -> `<short hash>-<10 hex>` where the digest covers
 *                    · the porcelain status (which paths are added / modified / deleted / untracked)
 *                    · the tracked diff against HEAD (their CONTENTS)
 *                    · `git hash-object` of every UNTRACKED file (their contents too — codex round 2
 *                      correctly refused to accept "untracked contents" as an acceptable residual)
 *   no git      -> `dev`, and `deploy.ps1` REFUSES to deploy it, with or without -AllowDirty.
 *
 * ⚠️ THE ONE REMAINING RESIDUAL, NAMED PRECISELY: gitignored files. `public/i18n/` and `public/api/`
 * are ignored yet copied into `dist`, so they are build inputs this digest does not read. They are
 * however DERIVED — `build-zh`, `build-pinyin` and `build-index` regenerate them deterministically
 * from committed inputs on every run of `deploy.ps1`, before the build — so the commit does determine
 * them. That is an argument, not a measurement, and it is the reason a dirty deploy needs an explicit
 * flag while a clean one does not.
 */
export function deriveId({ hash, status, diff, untracked }) {
  if (!hash) return 'dev';
  if (!status) return hash;
  const digest = createHash('sha256')
    .update(`${status}\n--diff--\n${diff || ''}\n--untracked--\n${untracked || ''}`)
    .digest('hex').slice(0, 10);
  return `${hash}-${digest}`;
}

/**
 * The tree's facts, or `null` when this is not a git checkout at all.
 *
 * ⚠️ FAIL CLOSED INSIDE A REPOSITORY — codex round 2. Only `rev-parse` is allowed to decide "there is
 * no git here"; once it has succeeded, a LATER git failure throws, because at that point the tree
 * demonstrably has a history and an error means we cannot identify it. Answering `dev` there is the
 * behaviour that collapsed two different trees onto one cache identity.
 */
export function readGitFacts() {
  let hash;
  try {
    hash = git(['rev-parse', '--short', 'HEAD']);
  } catch {
    return null; // a tarball, or a review snapshot: nothing to name
  }
  // `--porcelain` over the whole tree: an uncommitted edit ANYWHERE can change the bundle, so the
  // dirty flag is not scoped to a path list. Scoping it would re-create the renderPaths guess this
  // increment deletes.
  // `-uall` lists untracked FILES individually rather than collapsing them into a directory entry —
  // which matters twice: a directory is more informative when expanded, and `git hash-object` below
  // cannot digest a directory path.
  // ⚠️ `core.quotepath=false` — stand-in round 3, MEDIUM. Porcelain OCTAL-ESCAPES a non-ASCII path
  // (`?? "\344\270\255\346\226\207.md"`), and `git hash-object` below is then handed a path that does
  // not exist: executed, it aborts `npm run build` outright. On a project whose whole point is 中文
  // vocabulary, an untracked `笔记.md` is not exotic. This prints real UTF-8 paths instead.
  const status = git(['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall']);
  if (!status) return { hash, status: '', diff: '', untracked: '' };
  const diff = git(['diff', 'HEAD']);
  // The untracked paths, and then their CONTENT hashes. `hash-object` is git's own content digest, so
  // this is exact and costs one process for the whole set.
  const paths = status.split('\n')
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3).replace(/^"|"$/g, ''));
  let untracked = '';
  if (paths.length) {
    const hashes = git(['hash-object', '--', ...paths]).split('\n');
    untracked = paths.map((p, i) => `${hashes[i] || 'unreadable'} ${p}`).join('\n');
  }
  return { hash, status, diff, untracked };
}

/**
 * `main` is behind an entry-point check so `test/build-id.test.mjs` can import `deriveId` and
 * `readGitFacts` WITHOUT the import writing a file as a side effect. (`deploy.ps1`, `npm run build`
 * and the cache-key test all invoke it as a script, which is the path that writes.)
 */
export function main() {
  const facts = readGitFacts();
  const id = facts ? deriveId(facts) : 'dev';
  const body = bodyFor(id);
  mkdirSync(dirname(OUT), { recursive: true });
  let existing = null;
  try { existing = readFileSync(OUT, 'utf8'); } catch { /* first run */ }
  if (existing !== body) writeFileSync(OUT, body);
  console.log(`build id: ${id}${existing === body ? ' (unchanged)' : ''}`);
  return id;
}

const bodyFor = (id) => `/**
 * GENERATED by scripts/build-id.mjs — DO NOT EDIT, and do not hand-bump it.
 *
 * This is the renderer's cache-key salt and the string Settings -> About prints. It is the git short
 * hash of the tree this artefact was built from; a dirty tree gets a second segment that is a digest
 * of the uncommitted change itself, so two different dirty states are two different ids. See
 * scripts/build-id.mjs for why it is derived rather than written down.
 */
export const SITE_BUILD = ${JSON.stringify(id)};
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
