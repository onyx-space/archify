# overlay — this fork's local capability layer

`main` in `onyx-space/archify` tracks `tt-a1i/archify` exactly. Nothing in this
fork is carried as a code divergence on the mainline any more; every local
capability lives here as a patch that is applied on demand. After the
2026-09-15 merge of upstream `30fd463`, `git diff upstream/main..main --stat`
lists only files under `overlay/`.

That is deliberate. Through 2026-09 the fork carried its own commits on `main`,
and each upstream sync produced the same three-way conflicts in
`archify/renderers/shared/repository-evidence.mjs`,
`archify/renderers/shared/generated-validators.mjs` and
`archify/schemas/architecture.schema.json` — with the standing risk of dropping a
local capability silently while resolving them.

```
git fetch upstream && git merge upstream/main   # no conflicts: main == upstream
bash overlay/apply.sh                          # re-apply the local capabilities
```

## Capability inventory

| Patch | Capability | Origin |
| --- | --- | --- |
| `0001-self-hosted-forge-repository-evidence.patch` | Repository evidence for self-hosted forges: host-agnostic remote parsing, `.git`-suffix and owner/repo case normalization, `http://` web source links for self-hosted hosts while public forges (`github.com`, `gitee.com`) still require HTTPS on the standard endpoint, `link_mode: local-only` preserved | fork `767f51b` + `cb9db45`, reconstructed on upstream's `repository-location.mjs` rewrite (PR #354) and extended with the self-hosted HTTP rule |
| `0002-axi-toon-cli-output.patch` | TOON-shaped `validate` / `deliver` / `compare` / `migrate` / `doctor` / `demo` output, version fast-path, content-first home, fail-loud unknown command | fork `c3649a9` + `b87c0b4` |
| `0003-skill-default-zh-cn-authoring.patch` | This fork defaults to zh-CN authoring in `archify/SKILL.md` | fork `530ce3c` |

`apply.sh` applies them in filename order and rolls back on failure.

## What applying the overlay does *not* do

* **`archify.zip` is not patched, and the canonical-archive gate cannot pass on
  a patched tree.** The archive stays upstream's published artifact. The
  patches rewrite files that are packaged into it (`archify/bin/archify.mjs`,
  `archify/SKILL.md`, `archify/references/authoring-contract.md`,
  `archify/renderers/shared/*`), while `archify.zip` keeps upstream's bytes, so
  `archify/test/release-package-gates.test.mjs`'s "archive build is
  byte-for-byte reproducible" case — a fresh build must byte-equal the
  committed archive — is false by design. That is accepted as a known
  overlay-form deviation: this fork does not re-sign upstream's release
  artifact, and rebuilding needs Node 22 (`scripts/build-zip.sh` rejects every
  other Node major because the ZIP bytes are toolchain-bound). Concrete check,
  no Node 22 needed — the committed archive still embeds the pre-patch file:

  ```sh
  unzip -p archify.zip archify/bin/archify.mjs | shasum -a 256
  # 13f0f1ea8f3da1b090360c848079a877752bec1554e26c57377573673dd687d8 (unpatched)
  shasum -a 256 archify/bin/archify.mjs
  # 6a75d9fa55c4d3f1ee83b17290329bc998986de168777db5b455674673767e67 (patched)
  ```

  Everything else the overlay affects is green on a patched tree; see
  `## Verification`.
* After a manual `scripts/build-zip.sh` rebuild,
  `archify/test/cursor-onboarding.test.mjs` — which runs the *packaged* CLI —
  still asserts upstream's `Archify is ready.` while the AXI overlay prints
  `status: ready`; that assertion then needs updating too.
* Two upstream CI jobs are baseline-only and cannot pass on this fork regardless
  of the overlay: `published-update-manifest` (the fork publishes no GitHub
  Release, so `releases/latest` is a 404) and `zip-freshness` on a patched tree.

## Upstream test assertions the overlay rewrites

The patches keep upstream's test files except where a restored capability
changes the expected outcome. Each entry is upstream → overlay → reason.

* `archify/test/repository-evidence.test.mjs`, `local-only rejects different
  hosts, paths, path case, endpoints and guessed prefixes` → `local-only rejects
  different hosts, paths, endpoints and guessed prefixes`: upstream required
  `Team/repo` vs `team/repo`, `git@…:Team/repo` vs `git@…:Team/repo.git` and
  `http://…/Team/repo` vs `http://…/Team/repo.git` to be rejected as different
  identities; the overlay removes those three pairs because the restored
  normalization folds repository-path case and one terminal `.git`, so they now
  match.
* `archify/test/architecture-delta.test.mjs`, `portable compare retains link
  settings…`: upstream expected `compareArchitecture(base, head)` to throw
  `delta/repository-mismatch` for `…/team/Services/repo.git` vs
  `…/Team/Services/repo.git`; the overlay asserts `proofLevel ===
  'revision-pinned'` because repository identity is case-insensitive after the
  restore.
* `archify/test/repository-evidence.test.mjs`, `unsupported web providers and
  invalid authored addresses fail without exposing credentials` → `unsupported
  web links and invalid authored addresses fail without exposing credentials`:
  upstream asserted exit 1 per case; the overlay asserts the exact diagnostic
  code per case, drops upstream's plain `{ url:
  'https://git.internal/team/repo' }` case (the restored self-hosted HTTP(S)
  rule now emits a web source link for it), and adds
  `ssh://git@git.internal/team/repo` and
  `https://git.internal/Platform/Services/repo` (both
  `repository-evidence/links-unsupported`) plus `{ url:
  'https://git.internal/team/repo', provider: 'gitee' }`
  (`repository-evidence/provider-invalid`).
* `archify/test/cli.test.mjs`, `cli: doctor …` and `cli: demo …`: upstream
  matched `[ok] <label>` / `[missing] <label>` / `[invalid] <label>` /
  `Archify is ready.`, `Demo ready: <path>`, `Next: open the HTML in your
  browser`; the overlay matches `ok,<label>` / `missing,<label>` /
  `invalid,<label>` / `status: ready`, `output: <path>`, `next: open the HTML in
  a browser` — the restored TOON output (fork `b87c0b4`).
* `archify/test/output-path.test.mjs`, `doctor reports a missing output-path
  safety runtime in an installed skill`: upstream matched `[missing] Output path
  safety runtime`; the overlay matches `missing,Output path safety runtime`
  (same restored TOON output).
* `archify/test/cursor-onboarding.test.mjs`: **not touched by the overlay
  patches.** A patched tree keeps upstream's `/Archify is ready\./`; only after
  a `scripts/build-zip.sh` rebuild does the packaged CLI print `status: ready`
  and that assertion need updating (see the `archify.zip` note above).

## Verification

`overlay/apply.sh` was verified by applying it to a clean `upstream/main`
checkout and running the repository-evidence tests. The counter-check keeps the
overlay's test file and reverts only the two implementation files the patch
changes, then reruns those tests:

```sh
bash overlay/apply.sh
git checkout upstream/main -- archify/renderers/shared/repository-location.mjs \
  archify/renderers/shared/repository-evidence.mjs
node --test archify/test/repository-evidence.test.mjs   # self-hosted-forge test fails
```

On the patched tree the four test files the overlay rewrites are green:

```sh
node --test archify/test/repository-evidence.test.mjs \
  archify/test/architecture-delta.test.mjs \
  archify/test/cli.test.mjs \
  archify/test/output-path.test.mjs
# tests 118 | pass 117 | fail 0 | skipped 1
```

The rest of the suite is not run here: `release-package-gates.test.mjs`'s
canonical-archive cases need Node 22 and `scripts/build-zip.sh` refuses every
other Node major, so on this machine they are skipped rather than exercised (see
the `archify.zip` note above). CI on Node 22 is the gate for the rest.

Commands, raw output and the real internal-Gitea end-to-end run are recorded in
the fork-sync report (`data/fork-sync-conflict-archify/report.md` in the
`firstmate` home).
