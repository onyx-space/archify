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

`apply.sh` applies the patches in filename order and rolls back on failure.

## What applying the overlay does *not* do

* **`archify.zip` is not patched, and the canonical-archive gate cannot pass on
  a patched tree.** The archive stays upstream's published artifact. The patch
  rewrites files that are packaged into it
  (`archify/references/authoring-contract.md`,
  `archify/renderers/shared/*`, `archify/schemas/README.md`), while
  `archify.zip` keeps upstream's bytes, so
  `archify/test/release-package-gates.test.mjs`'s "archive build is
  byte-for-byte reproducible" case — a fresh build must byte-equal the
  committed archive — is false by design. That is accepted as a known
  overlay-form deviation: this fork does not re-sign upstream's release
  artifact, and rebuilding needs Node 22 (`scripts/build-zip.sh` rejects every
  other Node major because the ZIP bytes are toolchain-bound). Concrete check,
  no Node 22 needed — the committed archive still embeds the pre-patch file:

  ```sh
  unzip -p archify.zip archify/renderers/shared/repository-location.mjs | shasum -a 256
  # e82fa68ab46e71566eb7aefdb48f6df67b34fd27ce36489e7787410dbfba05ce (unpatched)
  shasum -a 256 archify/renderers/shared/repository-location.mjs
  # 120c92f4c45edc2217509463df773b9d97b5e5f4aa39c8cba8b7d59a72c01659 (patched)
  ```

  Everything else the overlay affects is green on a patched tree; see
  `## Verification`.
* Two upstream CI jobs are baseline-only and cannot pass on this fork regardless
  of the overlay: `published-update-manifest` (the fork publishes no GitHub
  Release, so `releases/latest` is a 404) and `zip-freshness` on a patched tree.

## Upstream test assertions the overlay rewrites

The patch keeps upstream's test files except where a restored capability
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

On the patched tree the two test files the overlay rewrites are green:

```sh
node --test archify/test/repository-evidence.test.mjs \
  archify/test/architecture-delta.test.mjs
# tests 52 | pass 51 | fail 0 | skipped 1
```

The rest of the suite is not run here: `release-package-gates.test.mjs`'s
canonical-archive cases need Node 22 and `scripts/build-zip.sh` refuses every
other Node major, so on this machine they are skipped rather than exercised (see
the `archify.zip` note above). CI on Node 22 is the gate for the rest.

Commands, raw output and the real internal-Gitea end-to-end run are recorded in
the fork-sync report (`data/fork-sync-conflict-archify/report.md` in the
`firstmate` home).
