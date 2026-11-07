#!/usr/bin/env bash
# usage: ./tools/test-packages.sh [bun test options]     (`bun run test` runs it)
#
# Every test of packages/*, in THREE bun processes.  `bun test` runs all files in one process and keeps what they load, and the parts of
# this repository are heavy in different ways: the GPU tests of d3d9 / engine / assets peak at ~3.1 GB (Dawn + SwiftShader), host + ui
# (which load the scripts of the whole client, the census of all 1,024 dialogs included) at ~2.1 GB, and the dialogs drawn through the
# device (packages/ui/test-gpu: whole textures decoded and uploaded to SwiftShader) at ~0.8 GB; in one process the kernel kills bun on a
# 4 GB machine (exit 137, no summary).  Each part prints its own summary and the script fails when any of them does.
#
# bun's test filters are path SUBSTRINGS: `packages/ui` would also match packages/ui/test-gpu, hence `packages/ui/test/`.
set -u
cd "$(dirname "$0")/.."
BUN="${BUN:-bun}"
command -v "$BUN" >/dev/null 2>&1 || BUN="$PWD/node_modules/.bin/bun"

heavy=(packages/host packages/ui/test/)
gpu_ui=(packages/ui/test-gpu/)
light=()
for d in packages/*/; do
  d="${d%/}"
  case "$d" in packages/host|packages/ui) ;; *) light+=("$d") ;; esac
done

status=0
echo "== ${light[*]}"
./tools/gpu.sh "$BUN" test "${light[@]}" "$@" || status=$?
echo "== ${heavy[*]}"
./tools/gpu.sh "$BUN" test "${heavy[@]}" "$@" || status=$?
echo "== ${gpu_ui[*]}"
./tools/gpu.sh "$BUN" test "${gpu_ui[@]}" "$@" || status=$?
exit "$status"
