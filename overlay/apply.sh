#!/usr/bin/env bash
# Apply this fork's capability overlay onto a clean upstream baseline.
#
# `main` tracks tt-a1i/archify exactly; every local capability lives in
# overlay/*.patch so it never becomes a merge conflict on the next sync.
#
# Usage:  bash overlay/apply.sh
#
# Patches are applied in filename order onto the current working tree, which is
# expected to be a clean checkout of the upstream baseline. A failing patch
# aborts the run and rolls back the patches already applied, so the tree is
# never left half-patched.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
patch_dir="$root/overlay"

shopt -s nullglob
patches=("$patch_dir"/[0-9]*.patch)
shopt -u nullglob

if [ "${#patches[@]}" -eq 0 ]; then
  echo "overlay: no overlay/*.patch files found in $patch_dir" >&2
  exit 1
fi

applied=()

on_exit() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "${#applied[@]}" -gt 0 ]; then
    echo "overlay: rolling back ${#applied[@]} already-applied patch(es)" >&2
    for ((index = ${#applied[@]} - 1; index >= 0; index--)); do
      if ! git -C "$root" apply -R "${applied[$index]}"; then
        echo "overlay: WARNING could not revert $(basename "${applied[$index]}")" >&2
      fi
    done
  fi
  exit "$status"
}
trap on_exit EXIT

for patch in "${patches[@]}"; do
  echo "overlay: applying $(basename "$patch")"
  git -C "$root" apply --whitespace=nowarn "$patch"
  applied+=("$patch")
done

echo "overlay: applied ${#patches[@]} patch(es)"
echo "overlay: note: archify.zip is deliberately not patched; rebuild it with scripts/build-zip.sh (Node 22) if you need the packaged Skill."
