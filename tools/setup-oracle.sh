#!/usr/bin/env bash
# Builds the native LuaJIT 2.0 oracle used by tools/lua-difftest.sh and tools/lua/native_dump_bc.lua.
# The client embeds LuaJIT 2.0 with a private bytecode header (1B 'K' 'L' 0x81); the oracle is stock v2.0.2 (the version string embedded in the exe) with that header.
# Output: $ORACLE_DIR/src/luajit (default /home/user/work/luajit-2.0). Idempotent.
set -euo pipefail
DIR="${ORACLE_DIR:-/home/user/work/luajit-2.0}"
if [ -x "$DIR/src/luajit" ]; then echo "oracle present: $DIR/src/luajit"; exit 0; fi
mkdir -p "$(dirname "$DIR")"
rm -rf "$DIR"
# The upstream repo has no tags; this is the "RELEASE LuaJIT-2.0.2" commit (the exe reports "LuaJIT 2.0.2").
SHA="${ORACLE_SHA:-21af151af28d4b3524684b106bd19b02484f67f1}"
mkdir -p "$DIR"
curl -fsSL "https://codeload.github.com/LuaJIT/LuaJIT/tar.gz/$SHA" | tar -xz -C "$DIR" --strip-components=1
H="$DIR/src/lj_bcdump.h"
sed -i -E 's/(#define BCDUMP_HEAD2[[:space:]]+)0x4c/\10x4b/; s/(#define BCDUMP_HEAD3[[:space:]]+)0x4a/\10x4c/; s/(#define BCDUMP_VERSION[[:space:]]+)1$/\10x81/' "$H"
grep -E 'BCDUMP_(HEAD|VERSION)' "$H"

# The client is a Win32 build: `long` / `unsigned long` are 32 bits. Make the x64 oracle behave the same where the library
# depends on it (string.format %d/%x go through lj_lib_checkbit only when sizeof(long)==4; tonumber(s, base) uses strtoul).
sed -i -E 's/^(#define LUA_INTFRMLEN[[:space:]]+)"l"/\1""/; s/^(#define LUA_INTFRM_T[[:space:]]+)long/\1int/' "$DIR/src/luaconf.h"
grep -E 'LUA_INTFRM' "$DIR/src/luaconf.h"
python3 - "$DIR/src/lib_base.c" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
helper = r"""/* Win32 client: unsigned long is 32 bits (UCRT strtoul semantics: overflow saturates, a sign negates modulo 2^32). */
static unsigned long els_strtoul32(const char *p, char **ep, int base)
{
  const char *q = p;
  int neg = 0;
  unsigned long long v;
  while (*q == ' ' || (*q >= 9 && *q <= 13)) q++;
  if (*q == '-') { neg = 1; q++; } else if (*q == '+') q++;
  v = strtoull(q, ep, base);
  if (*ep == q) { *ep = (char *)p; return 0; }
  if (v > 0xffffffffULL) return 0xffffffffUL;
  return neg ? (unsigned long)((0u - (unsigned int)v) & 0xffffffffu) : (unsigned long)v;
}

"""
assert "LJLIB_ASM(tonumber)" in s and "ul = strtoul(p, &ep, base);" in s
s = s.replace("LJLIB_ASM(tonumber)", helper + "LJLIB_ASM(tonumber)", 1)
s = s.replace("ul = strtoul(p, &ep, base);", "ul = els_strtoul32(p, &ep, base);")
open(p, "w").write(s)
PY
make -C "$DIR" -j"$(nproc)" amalg
"$DIR/src/luajit" -e 'print(jit.version, jit.arch)'
