# overlay — this fork's local capability layer

`main` in `onyx-space/archify` tracks `tt-a1i/archify` exactly. Nothing in this
fork is carried as a code divergence on the mainline any more; every local
capability lives here as a patch that is applied on demand.

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

* **`archify.zip` is not patched.** It stays upstream's canonical archive, so a
  patched tree no longer matches its committed package. Rebuild with
  `scripts/build-zip.sh` (requires Node 22) if you need the packaged Skill, and
  note that after a rebuild `archify/test/cursor-onboarding.test.mjs` — which
  runs the *packaged* CLI — still asserts upstream's `Archify is ready.` while
  the AXI overlay prints `status: ready`; that assertion then needs updating too.
* Two upstream CI jobs are baseline-only and cannot pass on this fork regardless
  of the overlay: `published-update-manifest` (the fork publishes no GitHub
  Release, so `releases/latest` is a 404) and `zip-freshness` on a patched tree.

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

Commands, raw output and the real internal-Gitea end-to-end run are recorded in
the fork-sync report (`data/fork-sync-conflict-archify/report.md` in the
`firstmate` home).
