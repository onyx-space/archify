import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../bin/preview.mjs';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-evidence-repo-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'router.js'), 'export function route(input) {\n  return input.kind;\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'store.js'), 'export const store = new Map();\n');
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'git@github.com:example/evidence-repo.git');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  const revision = git(root, 'rev-parse', 'HEAD');

  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), 'utf8'));
  diagram.meta.repository = {
    url: 'https://github.com/example/evidence-repo',
    revision,
  };
  diagram.components[0].sources = [
    { path: 'src/router.js', line: 1, end_line: 3, label: 'Request router' },
    { path: 'src/store.js', line: 1 },
  ];
  const input = path.join(root, 'diagram.architecture.json');
  fs.writeFileSync(input, JSON.stringify(diagram, null, 2));
  return { root, revision, diagram, input };
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function evidencePayload(html) {
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'verified evidence payload missing');
  return JSON.parse(match[1]);
}

test('Gitee evidence generates provider-specific revision and line links', () => {
  const data = fixture();
  data.diagram.meta.repository.url = 'https://gitee.com/example/evidence-repo';
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const output = path.join(data.root, 'gitee.html');
  for (const remote of [
    'https://gitee.com/example/evidence-repo.git/',
    'git@gitee.com:example/evidence-repo.git',
    'ssh://git@gitee.com/example/evidence-repo.git',
  ]) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.repository.href, `https://gitee.com/example/evidence-repo/tree/${data.revision}`);
    assert.equal(evidence.nodes.users[0].href, `https://gitee.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-3`);
    assert.equal(evidence.nodes.users[1].href, `https://gitee.com/example/evidence-repo/blob/${data.revision}/src/store.js#L1`);
  }
});

// Fork-restoration record for the upstream/main sync (fork main 1f1323e x upstream 50e2dcc).
// The five fork-only commits dropped by that merge were re-applied onto upstream's rewrite:
//   c3649a9 version fast-path / content-first home / fail-loud unknown command
//     preserved: archify/bin/archify.mjs:15,24,2059,2068,2122
//   b87c0b4 TOON output for validate/deliver/compare/migrate/doctor/demo
//     preserved: archify/bin/archify.mjs:739,1203,1300,1438,1447,1586,1892,2046
//   530ce3c zh-CN authoring default, preserved: archify/SKILL.md:83
//   767f51b arbitrary git hosts for repository evidence
//     host-agnostic parse: archify/renderers/shared/repository-location.mjs:28
//     self-hosted HTTP links: archify/renderers/shared/repository-evidence.mjs:108-117
//     .git suffix + owner/repo case: repository-location.mjs:30-40, repository-evidence.mjs:155
//     provider kept narrow: upstream's github/gitee enum stays at
//     archify/schemas/architecture.schema.json:33, and repository-evidence.mjs:102 rejects a
//     declared provider on a self-hosted host (upstream host-match check, no relaxed guard).
//     schema url pattern NOT reinstated: upstream moved authored-address shape checking into
//     parseRepositoryRemote (repository-evidence/url-invalid), which is host-agnostic and
//     already rejects credentials, query, fragment and dot segments. The fork regex only
//     allowed https?://host/owner/repo and would drop upstream's ssh://, git@host:path and
//     nested-namespace local-only addresses, so the code check is the equivalent restore.
//   cb9db45 authoredSlug string fix: obsolete, matching now compares the parser identity
//     string (repository-evidence.mjs:145) instead of the fork's {host,slug} object.
// One fork behavior is intentionally not restored: the fork slug match ignored the host,
// while this sync keeps upstream's strict identity (host, endpoint, path kind, owner/repo).
//
// Upstream test assertions changed by the restore (upstream -> fork, and why):
//   repository-evidence.test.mjs 'local-only rejects different hosts, paths, path case, endpoints...'
//     upstream: Team/repo vs team/repo, git@...:Team/repo vs git@...:Team/repo.git and
//       http://.../Team/repo vs http://.../Team/repo.git must reject (byte-exact case + .git).
//     fork: those three pairs removed (title drops 'path case') because the restore normalizes
//       repository-path case and one terminal .git, so the pairs now match; other cases unchanged.
//   architecture-delta.test.mjs 'portable compare retains link settings...'
//     upstream: head url .../team/Services/repo.git vs base .../Team/Services/repo.git must throw
//       'delta/repository-mismatch'.
//     fork: assert.equal(compareArchitecture(...).proofLevel, 'revision-pinned') because identity
//       is now case-insensitive; the canonical-url assertion keeps upstream's `.git` value
//       (an intermediate flip in b98f1c8 was reverted by d294ff8).
//   repository-evidence.test.mjs 'unsupported web providers...' -> 'unsupported web links...'
//     upstream: exit 1 alone per case, including `{ url: 'https://git.internal/team/repo',
//       provider: 'gitee' }`, which only passed there because self-hosted providers were accepted.
//     fork: each case asserts its exact diagnostic code, and the self-hosted-provider case is
//       removed because a declared provider is no longer accepted on a self-hosted host.
// Fix rounds: 391e908 host-agnostic parse + self-hosted links, 4190127 http for self-hosted /
// https for public forges, 08e6a48 exact diagnostic codes, b98f1c8 .git+case normalization and
// the two assertion changes above, d294ff8 .git stripped in identity and emitted links.
//
// Real internal-forge verification (CI cannot reach this host). h-machine Gitea:
// http://192.168.1.4:3000/admin/seed-hunter, revision d2676d0b9d83fcbe5905277eb2aa7ed3b6fcd9c9
//   git clone http://192.168.1.4:3000/admin/seed-hunter.git
//   (a) origin `.git` clone_url + authored browser_url -> validate exit 0 (9/9 checks)
//   (b) authored url carrying `.git` -> href emitted without `.git`
//   (c) origin /Admin/Seed-Hunter.git -> validate exit 0
// emitted href: http://192.168.1.4:3000/admin/seed-hunter/blob/<revision>/src/analyze.ts#L1-L20
// commands + raw output: /Users/onyx/code/firstmate/data/fork-sync-conflict-archify/e2e-gitea.md

test('self-hosted HTTP forges normalize clone suffixes/case and reject declared providers', () => {
  const data = fixture();
  const url = 'http://192.168.1.4:3000/admin/seed-hunter';
  for (const origin of [`${url}.git`, 'http://192.168.1.4:3000/Admin/Seed-Hunter.git']) {
    data.diagram.meta.repository = { url, revision: data.revision };
    git(data.root, 'remote', 'set-url', 'origin', origin);
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const validated = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(validated.status, 0, `${origin}: ${validated.stderr || validated.stdout}`);
    const output = path.join(data.root, 'self-hosted.html');
    const delivered = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
    const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.repository.href, `${url}/tree/${data.revision}`);
    assert.equal(evidence.nodes.users[0].href, `${url}/blob/${data.revision}/src/router.js#L1-L3`);
    assert.equal(evidence.nodes.users[1].href, `${url}/blob/${data.revision}/src/store.js#L1`);
  }
  for (const [provider, code] of [['gitea', 'schema/enum'], ['github', 'repository-evidence/provider-invalid']]) {
    data.diagram.meta.repository = { url: `${url}.git`, revision: data.revision, provider };
    git(data.root, 'remote', 'set-url', 'origin', `${url}.git`);
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const rejected = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(rejected.status, 1, provider);
    assert.ok(JSON.parse(rejected.stdout).diagnostics.some((entry) => entry.code === code), `${provider}: ${rejected.stdout}`);
  }
});

test('public forges still require canonical HTTPS without a custom port', () => {
  const data = fixture();
  for (const url of ['http://github.com/example/evidence-repo', 'https://github.com:8443/example/evidence-repo']) {
    data.diagram.meta.repository = { url, revision: data.revision };
    git(data.root, 'remote', 'set-url', 'origin', url);
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, url);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === 'repository-evidence/links-unsupported'), result.stdout);
  }
});

test('local-only evidence verifies HTTP self-hosted origins without generating links', () => {
  const data = fixture();
  data.diagram.meta.repository = {
    url: 'http://git.example.internal:3000/Platform/Services/evidence-repo',
    revision: data.revision,
    link_mode: 'local-only',
  };
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  git(data.root, 'remote', 'set-url', 'origin', data.diagram.meta.repository.url);
  // Evidence is read from the pinned commit, not from the current working file.
  fs.writeFileSync(path.join(data.root, 'src/router.js'), 'changed\n');
  const output = path.join(data.root, 'local.html');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).evidence.linkMode, 'local-only');
  const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.href, undefined);
  assert.equal(evidence.repository.linkMode, 'local-only');
  assert.equal(evidence.nodes.users[0].endLine, 3);
  assert.ok(evidence.nodes.users.every((source) => !Object.hasOwn(source, 'href')));
});

test('local-only supports nested HTTPS and Git SSH identities with bounded port equivalence', () => {
  const data = fixture();
  const output = path.join(data.root, 'portable.html');
  for (const [url, remote] of [
    ['https://git.internal/Platform/Services/repo.git', 'https://git.internal:443/Platform/Services/repo.git'],
    ['ssh://git@git.internal/Platform/Services/repo', 'ssh://git@git.internal:22/Platform/Services/repo'],
    ['ssh://git@git.internal:2222/Platform/repo.git', 'ssh://git@git.internal:2222/Platform/repo.git'],
    ['git@git.internal:Platform/repo', 'git@git.internal:Platform/repo'],
    ['git@git.internal:/Platform/repo', 'ssh://git@git.internal/Platform/repo'],
    ['http://git.internal:3000/Platform/repo.git', 'http://user:SYNTHETIC_TOKEN@git.internal:3000/Platform/repo.git'],
    ['https://git.internal/Platform/repo.git', 'https://user:SYNTHETIC_TOKEN@git.internal/Platform/repo.git'],
    ['git@git.internal:Platform/repo%41', 'git@git.internal:Platform/repo%41'],
    ['ssh://git@git.internal/Platform/repo%41', 'ssh://git@git.internal/Platform/repoA'],
  ]) {
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['render', 'architecture', data.input, output, '--repo-root', data.root]);
    assert.equal(result.status, 0, `${url}: ${result.stderr}`);
    const html = fs.readFileSync(output, 'utf8');
    assert.doesNotMatch(html, /SYNTHETIC_TOKEN/);
    assert.equal(evidencePayload(html).repository.href, undefined);
  }
});

for (const [name, url, origin] of [
  ['relative versus absolute SSH paths', 'ssh://git@git.internal/Team/repo', 'git@git.internal:Team/repo'],
  ['literal percent escapes in SCP paths', 'git@git.internal:Team/repoA', 'git@git.internal:Team/repo%41'],
]) {
  test(`local-only rejects ${name} before replacing a trusted artifact`, () => {
    const data = fixture();
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', origin);
    const output = path.join(data.root, 'trusted.html');
    fs.writeFileSync(output, 'trusted previous artifact');
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, 'different Git paths must not verify as the declared repository');
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === 'repository-evidence/origin-mismatch'));
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  });
}

test('local-only rejects different hosts, paths, endpoints and guessed prefixes', () => {
  const data = fixture();
  const output = path.join(data.root, 'trusted.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  for (const [url, remote] of [
    ['https://git.internal/Team/repo', 'https://other.internal/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/Team/other'],
    ['https://git.internal/Team/repo', 'http://git.internal/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal:8443/Team/repo'],
    ['ssh://git@git.internal:2222/Team/repo', 'ssh://git@git.internal:2223/Team/repo'],
    ['https://git.internal:2222/Team/repo', 'ssh://git@git.internal:2222/Team/repo'],
    ['https://git.internal/Team/repo', 'git@ssh-alias:Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/scm/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/Team/ignored/../repo'],
    ['https://git.internal/Team/repo', 'git@git.internal:Team/repo'],
    ['https://git.internal/Team/repo', 'ssh://git@git.internal/Team/repo'],
  ]) {
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, `${url} must differ from ${remote}`);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === 'repository-evidence/origin-mismatch'));
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  }
});

test('local-only preserves root, origin, commit, blob, path and line checks', () => {
  const data = fixture();
  data.diagram.meta.repository.url = 'http://git.internal/team/repo';
  data.diagram.meta.repository.link_mode = 'local-only';
  git(data.root, 'remote', 'set-url', 'origin', 'http://git.internal/team/repo');
  const output = path.join(data.root, 'trusted.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  const original = structuredClone(data.diagram);
  const cases = [
    ['repository-evidence/root-required', () => {}, []],
    ['repository-evidence/revision-unavailable', (diagram) => { diagram.meta.repository.revision = '0'.repeat(40); }],
    ['repository-evidence/file-missing', (diagram) => { diagram.components[0].sources = [{ path: 'src/missing.js' }]; }],
    ['repository-evidence/file-missing', (diagram) => { diagram.components[0].sources = [{ path: 'src' }]; }],
    ['repository-evidence/path-escape', (diagram) => { diagram.components[0].sources = [{ path: '../outside.js' }]; }],
    ['repository-evidence/path-escape', (diagram) => { diagram.components[0].sources = [{ path: '.git/config' }]; }],
    ['repository-evidence/line-out-of-range', (diagram) => { diagram.components[0].sources = [{ path: 'src/router.js', line: 4 }]; }],
    ['repository-evidence/line-range-invalid', (diagram) => { diagram.components[0].sources = [{ path: 'src/router.js', line: 3, end_line: 1 }]; }],
  ];
  for (const [expectedCode, change, roots = ['--repo-root', data.root]] of cases) {
    const diagram = structuredClone(original);
    change(diagram);
    fs.writeFileSync(data.input, JSON.stringify(diagram));
    const result = run(['deliver', 'architecture', data.input, output, ...roots, '--json']);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === expectedCode), result.stdout);
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  }
  fs.writeFileSync(data.input, JSON.stringify(original));
  git(data.root, 'remote', 'remove', 'origin');
  const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /must have an origin/);
});

test('unsupported web links and invalid authored addresses fail without exposing credentials', () => {
  const data = fixture();
  for (const { repository, code } of [
    { repository: { url: 'ssh://git@git.internal/team/repo' }, code: 'repository-evidence/links-unsupported' },
    { repository: { url: 'https://git.internal/Platform/Services/repo' }, code: 'repository-evidence/links-unsupported' },
    { repository: { url: 'https://gitee.com/team/repo', provider: 'github' }, code: 'repository-evidence/provider-invalid' },
    { repository: { url: 'https://user:SYNTHETIC_TOKEN@gitee.com/team/repo' }, code: 'repository-evidence/url-invalid' },
    { repository: { url: 'https://gitee.com/team/repo?token=SYNTHETIC_TOKEN' }, code: 'repository-evidence/url-invalid' },
    { repository: { url: 'https://gitee.com/team/repo#SYNTHETIC_TOKEN' }, code: 'repository-evidence/url-invalid' },
    { repository: { url: 'https://gitee.com/team/%2e%2e/repo' }, code: 'repository-evidence/url-invalid' },
    { repository: { url: 'https://gitee.com/team%2Frepo' }, code: 'repository-evidence/url-invalid' },
    { repository: { url: 'file:///tmp/repo', link_mode: 'local-only' }, code: 'repository-evidence/url-invalid' },
    { repository: { url: 'javascript:alert(1)', link_mode: 'local-only' }, code: 'repository-evidence/url-invalid' },
    { repository: { link_mode: 'local-only' }, code: 'schema/required' },
  ]) {
    data.diagram.meta.repository = { revision: data.revision, ...repository };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, JSON.stringify(repository));
    assert.ok(JSON.parse(result.stdout).diagnostics.some((entry) => entry.code === code), `${JSON.stringify(repository)}: ${result.stdout}`);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_TOKEN/);
  }
});

test('portable origin failures redact HTTP credentials and query tokens', () => {
  const data = fixture();
  data.diagram.meta.repository = { url: 'http://git.internal/Team/repo', revision: data.revision, link_mode: 'local-only' };
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  for (const origin of [
    'http://user:SYNTHETIC_TOKEN@git.internal/Team/other',
    'http://git.internal/Team/repo?token=SYNTHETIC_TOKEN',
    'https://user:SYNTHETIC_TOKEN@git.internal/Team/repo',
  ]) {
    git(data.root, 'remote', 'set-url', 'origin', origin);
    const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_TOKEN/);
  }
});

test('explicit providers retain GitHub links and encode Gitee source paths', () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.root, 'src', '中文 # router.js'), 'one\ntwo\n');
  git(data.root, 'add', 'src');
  git(data.root, 'commit', '-m', 'encoded source path');
  const revision = git(data.root, 'rev-parse', 'HEAD');
  data.diagram.components[0].sources = [{ path: 'src/中文 # router.js', line: 1, end_line: 2 }];
  for (const provider of ['github', 'gitee']) {
    data.diagram.meta.repository = { url: `https://${provider}.com/example/evidence-repo.git/`, revision, provider };
    git(data.root, 'remote', 'set-url', 'origin', `git@${provider}.com:example/evidence-repo.git`);
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const output = path.join(data.root, `${provider}.html`);
    const result = run(['render', 'architecture', data.input, output, '--repo-root', data.root]);
    assert.equal(result.status, 0, result.stderr);
    const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.nodes.users[0].href, `https://${provider}.com/example/evidence-repo/blob/${revision}/src/${encodeURIComponent('中文 # router.js')}#L1-${provider === 'github' ? 'L' : ''}2`);
  }
});

test('local-only preview and compare publish only revision-verified evidence', { timeout: 20000 }, async () => {
  const data = fixture();
  data.diagram.meta.repository.url = 'http://git.internal/Team/repo';
  data.diagram.meta.repository.link_mode = 'local-only';
  git(data.root, 'remote', 'set-url', 'origin', 'http://git.internal/Team/repo');
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const head = path.join(data.root, 'head.architecture.json');
  fs.writeFileSync(head, JSON.stringify(data.diagram));
  const compared = path.join(data.root, 'compared.html');
  const result = run(['compare', 'architecture', data.input, head, compared, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).proofLevel, 'revision-pinned');
  assert.match(fs.readFileSync(compared, 'utf8'), /local-only/);
  const preview = await startPreview({ type: 'architecture', input: data.input, output: path.join(data.root, 'preview-local.html'), repoRoot: data.root, open: false, debounceMs: 30, pollMs: 60 });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified');
    const before = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.equal(evidencePayload(before).repository.href, undefined);
    data.diagram.components[0].sources[0].line = 999;
    delete data.diagram.components[0].sources[0].end_line;
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const failed = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix');
    assert.equal(failed.revision, state.revision);
    assert.equal(await (await fetch(new URL('/artifact.html', preview.url))).text(), before);
  } finally { await preview.stop(); }
});

test('browser renders local-only sources as searchable text and web sources as links', {
  skip: process.env.ARCHIFY_CHROME ? false : 'Set ARCHIFY_CHROME to run evidence browser checks.',
  timeout: 60000,
}, async () => {
  const data = fixture();
  const browser = new ChromeVisualBrowser(findChrome());
  try {
    for (const mode of ['github', 'gitee', 'local-only']) {
      const local = mode === 'local-only';
      const url = local ? 'http://git.internal/Team/repo' : `https://${mode}.com/example/evidence-repo`;
      data.diagram.meta.repository = { url, revision: data.revision, ...(local ? { link_mode: mode } : {}) };
      git(data.root, 'remote', 'set-url', 'origin', url);
      fs.writeFileSync(data.input, JSON.stringify(data.diagram));
      const artifactPath = path.join(data.root, `${mode}.html`);
      const result = run(['deliver', 'architecture', data.input, artifactPath, '--repo-root', data.root, '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      for (const theme of ['light', 'dark']) {
        await browser.inspect({ artifactPath, width: 1440, height: 900, theme });
        const sessionId = await browser.sessionPromise;
        const response = await browser.cdp.send('Runtime.evaluate', {
          expression: `(() => {
            document.querySelector('[data-node-id="users"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const panel = document.getElementById('focus-evidence');
            const rows = [...panel.querySelectorAll('.semantic-passport-source')];
            const input = document.getElementById('node-finder-input');
            input.value = 'src/router.js';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return {
              visible: !panel.hidden,
              links: rows.filter(row => row.tagName === 'A').map(row => row.getAttribute('href')),
              paths: rows.map(row => row.querySelector('small').textContent),
              locations: rows.map(row => row.querySelector('code').textContent),
              repositoryHref: document.getElementById('focus-repository').getAttribute('href'),
              scope: panel.title,
              beacon: !!document.querySelector('[data-node-id="users"] [data-source-evidence-beacon]'),
              invalidLinks: [...panel.querySelectorAll('a[href]')].some(a => /undefined|javascript:/.test(a.getAttribute('href'))),
              search: document.getElementById('node-finder-results').textContent
            };
          })()`, returnByValue: true,
        }, sessionId);
        assert.equal(response.exceptionDetails, undefined);
        const observed = response.result.value;
        assert.equal(observed.visible, true);
        assert.equal(observed.beacon, true);
        assert.equal(observed.invalidLinks, false);
        assert.deepEqual(observed.paths, ['src/router.js', 'src/store.js']);
        assert.match(observed.scope, /local Git/);
        assert.match(observed.search, /Users/);
        assert.equal(observed.links.length, local ? 0 : 2);
        assert.equal(observed.locations[0], local ? 'L1–3' : 'L1–3 ↗');
        assert.equal(observed.repositoryHref, local ? null : `${url}/tree/${data.revision}`);
      }
    }
  } finally { await browser.close(); }
});

test('repository evidence accepts canonical HTTPS and common SSH remotes', () => {
  const data = fixture();
  const output = path.join(data.root, 'remote-form.html');
  for (const remote of [
    'https://github.com/example/evidence-repo.git/',
    'https://x-access-token:not-a-real-token@github.com/example/evidence-repo.git',
    'https://oauth2:not-a-real-token@github.com/example/evidence-repo',
    'git@github.com:example/evidence-repo.git',
    'ssh://git@github.com/example/evidence-repo.git',
  ]) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 0, `${remote}: ${result.stderr || result.stdout}`);
  }
});

async function waitForState(url, predicate, timeoutMs = 12000) {
  const started = Date.now();
  let latest;
  while (Date.now() - started < timeoutMs) {
    latest = await (await fetch(new URL('/state', url))).json();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(`preview did not settle; latest state: ${JSON.stringify(latest)}`);
}

test('repository evidence is revision-verified, receipt-backed, searchable, and export-clean', () => {
  const data = fixture();
  const output = path.join(data.root, 'verified.html');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.evidence, {
    verified: true,
    repository: 'https://github.com/example/evidence-repo',
    revision: data.revision,
    references: 2,
  });

  const html = fs.readFileSync(output, 'utf8');
  const evidence = evidencePayload(html);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.shortRevision, data.revision.slice(0, 7));
  assert.equal(evidence.nodes.users.length, 2);
  assert.equal(evidence.nodes.users[0].href, `https://github.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-L3`);
  assert.match(html, /Verified source/);
  assert.match(html, /Archify\.sourceEvidence = \(function \(\)/);
  assert.match(html, /var sourceSearch = sources\.map/);
  assert.match(html, /renderSourceEvidence\(id\)/);
  assert.match(html, /referrerPolicy = 'no-referrer'/);
  assert.match(html, /classList\.add\('source-evidence-beacon'\)/);
  assert.match(html, /text\.textContent = viewerText\('viewer\.passport\.sourceMarker'\) \+ ' ' \+ count/);
  assert.match(html, /Archify\.sourceEvidence\.installBeacons\(\)/);
  assert.match(html, /querySelectorAll\('\[data-source-evidence-beacon\]'\)/);
  assert.match(html, /data-source-evidence-original-label/);

  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  assert.doesNotMatch(svg, /src\/router\.js|github\.com\/example\/evidence-repo|source-evidence/);
});

test('repository evidence is opt-in and never appears in ordinary artifacts', () => {
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-no-evidence-')), 'plain.html');
  const input = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const result = run(['render', 'architecture', input, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.doesNotMatch(html, /id="archify-source-evidence-data"/);
  assert.match(html, /id="focus-evidence" hidden/);
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  assert.doesNotMatch(svg, /source-evidence-beacon|data-source-evidence-count/);
});


test('origin-mismatch diagnostics redact HTTPS remote userinfo', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  git(data.root, 'remote', 'set-url', 'origin', 'https://user:not-a-real-token@github.com/example/other-repo.git');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /not-a-real-token/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /not-a-real-token/);
  assert.match(diagnostic.evidence.localOrigin, /^https:\/\/REDACTED@github\.com\/example\/other-repo\.git$/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('origin-mismatch diagnostics redact HTTP remote userinfo', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  git(data.root, 'remote', 'set-url', 'origin', 'http://user:FAKE_SECRET@github.com/example/other');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /FAKE_SECRET/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /FAKE_SECRET/);
  assert.match(diagnostic.evidence.localOrigin, /^http:\/\/REDACTED@github\.com\/example\/other$/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('validate accepts credentialed HTTPS remotes and redacts mismatch diagnostics', () => {
  const data = fixture();
  git(data.root, 'remote', 'set-url', 'origin', 'https://x-access-token:not-a-real-token@github.com/example/evidence-repo.git');
  let result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);

  git(data.root, 'remote', 'set-url', 'origin', 'https://user:VALIDATE_SECRET@github.com/example/other-repo.git');
  result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /VALIDATE_SECRET/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /VALIDATE_SECRET/);
  assert.doesNotMatch(result.stderr, /VALIDATE_SECRET/);
  assert.match(diagnostic.evidence.localOrigin, /^https:\/\/REDACTED@github\.com\/example\/other-repo\.git$/);
});

test('preview accepts credentialed HTTPS remotes and redacts mismatch diagnostics', { timeout: 20000 }, async () => {
  const data = fixture();
  const output = path.join(data.root, 'preview-credential.html');
  git(data.root, 'remote', 'set-url', 'origin', 'https://oauth2:not-a-real-token@github.com/example/evidence-repo');
  const matched = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(matched.url, (candidate) => candidate.status === 'verified');
    assert.equal(state.revision, 1);
    const html = await (await fetch(new URL('/artifact.html', matched.url))).text();
    assert.equal(evidencePayload(html).repository.revision, data.revision);
  } finally {
    await matched.stop();
  }

  git(data.root, 'remote', 'set-url', 'origin', 'https://user:PREVIEW_SECRET@github.com/example/other-repo.git');
  const mismatched = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(mismatched.url, (candidate) => candidate.status === 'needs-fix');
    assert.equal(state.failure?.stage, 'render');
    assert.match(state.failure?.message || '', /repository-evidence\/origin-mismatch/);
    assert.doesNotMatch(JSON.stringify(state), /PREVIEW_SECRET/);
  } finally {
    await mismatched.stop();
  }
});

test('evidence fails closed without a root, on wrong origin, missing blobs, or impossible lines', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');

  let result = run(['deliver', 'architecture', data.input, output, '--json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).stage, 'render');
  assert.match(JSON.parse(result.stdout).error, /Pass --repo-root/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');

  git(data.root, 'remote', 'set-url', 'origin', 'https://github.com/example/other-repo.git');
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /does not match/);
  git(data.root, 'remote', 'set-url', 'origin', 'git@github.com:example/evidence-repo.git');

  data.diagram.components[0].sources = [{ path: '../outside.js' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /must stay inside the repository/);

  data.diagram.components[0].sources = [{ path: 'src/router.js\n' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /repo-relative POSIX path/);

  data.diagram.components[0].sources = [{ path: 'src/missing.js' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /does not identify a file/);

  data.diagram.components[0].sources = [{ path: 'src/router.js', line: 99 }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /requests line 99/);

  data.diagram.components[0].sources = [{ path: 'src/router.js', line: 4 }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /has 3 lines/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('--repo-root stays bounded to architecture and schema limits evidence shape', () => {
  const data = fixture();
  let result = run(['render', 'workflow', path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'), '--repo-root', data.root]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /architecture diagrams only/);

  data.diagram.components[0].sources = [
    { path: 'src/router.js' },
    { path: 'src/router.js' },
    { path: 'src/router.js' },
    { path: 'src/router.js' },
  ];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['validate', 'architecture', data.input, '--repo-root', data.root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must NOT have more than 3 items/);
});

test('live preview forwards repo-root and publishes only verified evidence', { timeout: 20000 }, async () => {
  const data = fixture();
  const output = path.join(data.root, 'preview.html');
  const preview = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified');
    assert.equal(state.revision, 1);
    const html = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.equal(evidencePayload(html).repository.revision, data.revision);
  } finally {
    await preview.stop();
  }
});
