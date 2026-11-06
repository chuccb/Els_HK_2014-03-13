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
    # The oracle runs with -joff: the TS VM models the interpreter, and trace-compiled loops differ from it in degenerate cases (step -0 ...).
    # stripped bytecode like the game's scripts (no names/lines in error messages); the oracle runs the SAME bytecode
    if ! (cd "$(dirname "$g")" && "$LJ" -b -s "$(basename "$g")" "$TMP/$n.luac"); then
      echo "FAIL $n (does not compile)"; fail=$((fail+1)); continue
    fi
    (cd "$(dirname "$g")" && "$LJ" -joff "$TMP/$n.luac" > "$TMP/$n.native" 2> "$TMP/$n.native.err"); nrc=$?
    (cd "$(dirname "$g")" && "$BUN" run "$ROOT/tools/lua-run.ts" "$TMP/$n.luac" > "$TMP/$n.ts" 2> "$TMP/$n.ts.err"); trc=$?
    # a test must run to the end on the oracle (a crash or a script error would silently truncate what is compared)
    if [ "$nrc" != 0 ] || [ "$trc" != 0 ]; then
      echo "FAIL $n (exit status: native $nrc, ts $trc)"; fail=$((fail+1))
      head -c 400 "$TMP/$n.native.err"; head -c 400 "$TMP/$n.ts.err"
      diff "$TMP/$n.native" "$TMP/$n.ts" | head -${DIFFLINES:-12}
      continue
    fi
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
