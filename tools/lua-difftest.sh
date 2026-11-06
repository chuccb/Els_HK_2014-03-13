#!/usr/bin/env bash
# Differential test: native patched LuaJIT 2.0 (oracle) vs the TypeScript VM on tests/lua/*.lua.
# The native binary compiles each test to KL\x81 bytecode with `luajit -b`; both engines execute and stdout is compared.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LJ="${LUAJIT:-/home/user/work/luajit-2.0/src/luajit}"
export LUA_PATH="${LUA_PATH:-/home/user/work/luajit-2.0/src/?.lua}"
BUN="${BUN:-$ROOT/node_modules/.bin/bun}"
TMP="$(mktemp -d)"
pass=0; fail=0
for f in "${@:-$ROOT/tests/lua/*.lua}"; do
  for g in $f; do
    n="$(basename "$g" .lua)"
    # stripped bytecode like the game's scripts (no names/lines in error messages); the oracle runs the SAME bytecode
    (cd "$(dirname "$g")" && "$LJ" -b -s "$(basename "$g")" "$TMP/$n.luac")
    (cd "$(dirname "$g")" && "$LJ" "$TMP/$n.luac" > "$TMP/$n.native" 2> "$TMP/$n.native.err")
    (cd "$(dirname "$g")" && "$BUN" run "$ROOT/tools/lua-run.ts" "$TMP/$n.luac" > "$TMP/$n.ts" 2> "$TMP/$n.ts.err")
    if cmp -s "$TMP/$n.native" "$TMP/$n.ts"; then
      echo "PASS $n"; pass=$((pass+1))
    else
      echo "FAIL $n"; fail=$((fail+1))
      diff "$TMP/$n.native" "$TMP/$n.ts" | head -${DIFFLINES:-12}
      head -c 600 "$TMP/$n.ts.err"
    fi
  done
done
echo "pass=$pass fail=$fail (outputs in $TMP)"
[ "$fail" = 0 ]
