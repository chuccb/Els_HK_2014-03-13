#!/usr/bin/env bash
# usage: ./tools/test-packages.sh [bun test options]     (`bun run test` runs it)
#
# Every test of packages/*, in TWO bun processes.  `bun test` runs all files in one process and keeps what they load, and the two halves
# of this repository are heavy in different ways: the GPU tests of d3d9 / engine / assets peak at ~3.1 GB (Dawn + SwiftShader), host + ui
# (which load the scripts of the whole client, the census of all 1,024 dialogs included) at ~2.1 GB; in one process the kernel kills
# bun on a 4 GB machine (exit 137, no summary).  Each half prints its own summary and the script fails when either half does.
set -u
cd "$(dirname "$0")/.."
BUN="${BUN:-bun}"
command -v "$BUN" >/dev/null 2>&1 || BUN="$PWD/node_modules/.bin/bun"

heavy=(packages/host packages/ui)
light=()
for d in packages/*/; do
  d="${d%/}"
  case " ${heavy[*]} " in *" $d "*) ;; *) light+=("$d") ;; esac
done

status=0
echo "== ${light[*]}"
./tools/gpu.sh "$BUN" test "${light[@]}" "$@" || status=$?
echo "== ${heavy[*]}"
./tools/gpu.sh "$BUN" test "${heavy[@]}" "$@" || status=$?
exit "$status"
