#!/usr/bin/env bash
# Differential run of the real game scripts: every script of the client (KOM-extracted bytecode) is executed by
# tools/lua/stubrun.lua on the native LuaJIT 2.0.2 oracle and on the TypeScript VM; the outputs must be identical.
#   tools/corpus-diff.sh [flavor 1|2|3] [name-filter-regex]
#   flavor: what a call on a stub object returns (1 = another stub, 2 = nothing, 3 = the number 0)
# Needs: the oracle (tools/setup-oracle.sh) and the extracted scripts in $EX (python3 tools/kom_extract.py $EX lua,LUA).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LJ="${LUAJIT:-/home/user/work/luajit-2.0/src/luajit}"
export LUA_PATH="${LUA_PATH:-/home/user/work/luajit-2.0/src/?.lua}"
BUN="${BUN:-$ROOT/node_modules/.bin/bun}"
EX="${EX:-/home/user/work/ex}"
BASE="${OUT:-/home/user/work/corpus}"
FLAVOR="${1:-1}"
FILTER="${2:-.}"
OUT="$BASE/f$FLAVOR"
mkdir -p "$OUT/native" "$OUT/ts"
LIST="$BASE/list.txt"
ls "$EX" | grep -i '\.lua$' | sort > "$LIST"
(cd "$ROOT/tools/lua" && "$LJ" -b -s stubrun.lua "$BASE/stubrun.luac") || exit 1
grep -E "$FILTER" "$LIST" > "$OUT/todo.txt"
echo "scripts: $(wc -l < "$OUT/todo.txt")  flavor=$FLAVOR"

run_native() {
  name="$1"
  timeout 20 "$LJ" "$BASE/stubrun.luac" "$EX/$name" "$LIST" "$FLAVOR" > "$OUT/native/$name.out" 2>&1
  echo "exit=$?" >> "$OUT/native/$name.out"
}
export -f run_native
export LJ BASE OUT EX LIST FLAVOR LUA_PATH
xargs -P 2 -I{} bash -c 'run_native "$@"' _ {} < "$OUT/todo.txt"

# TS side: one process for all scripts; if it dies/hangs on a script, record that and continue after it
start=0
while true; do
  echo "init" > "$OUT/ts/.current"
  timeout "${TS_TIMEOUT:-1200}" "$BUN" run "$ROOT/tools/corpus-run.ts" "$BASE/stubrun.luac" "$EX" "$LIST" "$OUT/ts" "$FLAVOR" "$start" "$FILTER" || true
  cur="$(cat "$OUT/ts/.current")"
  [ "$cur" = "done" ] && break
  i="${cur%% *}"; name="${cur#* }"
  echo "TS run died at #$i $name" >&2
  printf 'TS-HANG\n' > "$OUT/ts/$name.out"
  start=$((i + 1))
done

pass=0; fail=0; : > "$OUT/failed.txt"
while read -r name; do
  if cmp -s "$OUT/native/$name.out" "$OUT/ts/$name.out"; then pass=$((pass+1)); else fail=$((fail+1)); echo "$name" >> "$OUT/failed.txt"; fi
done < "$OUT/todo.txt"
echo "identical=$pass different=$fail  (failed list: $OUT/failed.txt)"
[ "$fail" -eq 0 ]
