# Findings

Facts about the original client that the implementation depends on. "L1234567" = line in `data/x2.exe.c`;
"@ADDR" = function address (`//----- (ADDR)` marker). Everything here was read from the decompile or measured on the data
unless marked *(assumption)*.

## 1. The client

* `data/x2.exe`: PE32 (Win32), 14.8 MB, MSVC. `data/x2.exe.c` has 2,610,163 lines (33,294 functions, 1,355 classes found
  by `tools/index_decomp.py`), `data/x2.exe.h` 446,629 lines.
* **It is a recent rebuild, not a 2014 binary**: linker 14.51 (Rich header: VS 2022-era toolsets, builds 35721 / 36260), PE time stamp 2026-11-04,
  and it imports the *Universal CRT* (`api-ms-win-crt-*`), `VCRUNTIME140`, `MSVCP140` and `mfc140u`, not `msvcr100` (the `msvcr100` / `msvcp100` /
  `mfc100u` DLLs in `data/` belong to the side DLLs). So the exe's CRT behaviour is the UCRT's (printf with two-digit exponents and, on Windows 10 2004+,
  ties-to-even; correctly rounded `atof`/`strtod`; 64-bit `time_t`). Other imports that matter later: `d3dx9_43`, `fmodex`, `libxml2`, `usp10`,
  `dinput8`, `imm32`, `wininet`, `ws2_32`.
* Data: 173 KOM archives (`data001..`, `datai001..datai023`, ...), 97,891 entries; loose `data/ui`, `data/movie`
  (30 MPEG-1 files), `data/music` (135 ogg), `general.ess`, fonts, DLLs. `data/x2.fx` is a DXUT sample, not the game's
  effect file (the game's effects live in the KOMs).
* Lua is **LuaJIT 2.0.2** (string "LuaJIT 2.0.2" at L2515937; upstream commit `21af151af28d4b3524684b106bd19b02484f67f1`),
  FFI compiled in but unused by the scripts (all 4,498 script headers have FFI flag 0), `LUA52COMPAT` off.

### x2.exe.c map

| Area | Lines |
|---|---|
| declarations | 15 - 36093 |
| data (`chunk`="" L36961, `s_aiXorKeys` L37018, `lj_bc_mode` L100351) | 36093 - ~149889 |
| function bodies | from 149889 |
| `VirtualWinMain` | 247692 |
| string table | 266301 - 267546 |
| `IncludeLua_` (script loader/decryptor) | 284967 |
| `KGCMassFileManager` / `CMassFile` | 298026 - 303043 (`LoadMassFile` L300714, `_GetMemberFile` L302911) |
| `CRC_32` | 311633 |
| `DoMemoryNotEncrypt` | 375217 |
| `CX2StateStartUp` / `Login` / `Join` | 1544904 / 1545070 / 1551043 |
| LuaJIT: `lj_err_*` 2472067-2472610, `KLuaManager` 2474373+, `lj_debug_*` 2478074-2479139, `lj_str_new` 2479226, `lj_str_bufnum` 2479440, `lj_tab_*` 2479830-2481044, `lj_meta_*` 2481315-2482146, `cpparser`/`bcread` 2489419 / 2510034-2510941, `ffh_pairs` 2509478, `lj_cf_string_format` 2511566, `lj_cf_io_write` 2513847, `lj_cf_package_module` 2514973 | |

`x2.exe.h`: `ENUM_EVENT_ID` L14928, `SERVER_EVENT_ID` L42967, `MASSFILE_HEADER` L119308, `CMassFile` L119316,
`MEMBERFILEHEADER` L119531, `MEMBERFILEINFO` L137982.

## 2. KOM archives (`@els/kom`, verified on all 173 archives)

* Magic `KOG GC TEAM MASSFILE V.0.3.`, u32 count @0x34, u8 compressed @0x38, u32 filetime @0x3C, u32 Adler-32 of the manifest
  @0x40, u32 manifest size @0x44, then an XML manifest and the entries packed back to back in manifest order.
* Entry = `zlib(content)`; manifest `Algorithm="2"` entries (all `.lua`, `.txt`, `.kim`: 4,539 entries) are additionally
  enciphered with `XORCRCDecrypt` (key = `s_aiXorKeys` ^ `0x38D2DFA4`, stream seeded by CRC-32 over the lower-cased UTF-16
  name and the stored size). The engine's `LoadMassFile` ignores `Algorithm`; the Lua/text loaders decrypt.
* `tools/verify-kom.ts`: parsed end == file size, size and Adler-32 of every entry match: 97,891 entries, 0 errors.
* Names are looked up case-insensitively (the manager upper-cases them).

## 3. Lua scripts

* 4,498 `.lua` entries (4,478 `.lua` + 20 `.LUA`), all precompiled **stripped** bytecode with the client's private header
  `1B 4B 4C 81` (`KL\x81`) and the stock LuaJIT 2.0 bytecode layout otherwise (`lj_bc_mode` identical to stock 2.0: 0
  mismatches). 26,565 prototypes. No `.lua` entry contains source text.
* Stripped => no line info and no local/upvalue names: runtime errors read `chunk:0: msg`, upvalues are `upvalue ''`, locals
  are not named. This is observable behaviour and is reproduced.
* The scripts themselves use very little of the standard library (GGET census over all scripts): `math.random` 63,
  `string.format` 62, `math.floor` 19, `os.time` 9, `math.min` 9, `math.randomseed` 8, `table.sort` 7, `string.upper` 6,
  `math.sqrt` 5, `math.abs` 5, `ipairs` 16, `print` 8. Almost everything else is the host API (`g_pObjectMesh`,
  `D3DXVECTOR3`, `STATE_CHANGE_TYPE`, `g_pLineMap`, ... 89k distinct global names), i.e. the `lua_tinker` bindings of the exe.
* Three files *look* like Lua source: `data/TutorSystem.lua` (loose; 3 bytes, only the UTF-8 BOM) and `GameOption.txt` /
  `GameOptionPreset.txt` inside the KOMs (Algorithm 2, UTF-8 BOM, `GAME_OPTION_CURRENT = { ... OPTION_LEVEL["OL_HIGH"] ... }`).
  The exe cannot compile Lua source at all (section 11): these files are read by `KLuaManagerProxy`, KOG's own interpreter of a
  small Lua-like subset (ported as `packages/lua/src/proxy.ts`).
* The KOMs hold 41 Algorithm-2 `.txt`/`.kim` entries: 2 of them are the text configuration files above (`GameOption.txt`,
  `GameOptionPreset.txt`); the other 39 are not Lua: `particlesystem "GameMajor" 1.00 { ... }` particle scripts
  (`Game*/UI*Particle*.txt`), `XMESHPLAYER` scripts (`*XMeshPlayer*.txt`), a 0-byte `bossraid_dummy.txt`, and the 18.7 MB
  binary `item.kim` ("KIM" magic). They are parsed by C++ code of the exe and are phase 2 work (`item.kim` is done, see section 8).
* The exe's LuaJIT is stock 2.0.2 plus a few KOG additions: `dofile_UTF8` (`luaL_loadfilex(L, name, mode, iEncoding)`:
  encoding 0 accepts a UTF-8 BOM, 1 *requires* one unless the file is bytecode (`invalid encoding <chunk>` otherwise), 2 does no
  check), `lua_setencoding`/`lua_getencoding` (a flag in `global_State`), and the compat aliases `string.gfind` and `math.mod`
  (both reproduced; the library surface of the TS VM is identical to the oracle, test `t09_surface`, which leaves out `dofile_UTF8`
  that the stock oracle lacks). The lexer is cut down to `lj_lex_setup` (BOM / `#` line / `ESC` detection): the parser is not linked
  into the exe (section 11).

### LuaJIT 2.0.2 behaviour reproduced (from the decompile)

* Error positions: `lj_debug_line` returns 0 without line info, so VM errors read `shortName(chunk):0: msg`. `error(msg)`
  at level 1 gets no prefix (`where()` requires line > 0). Natives that raise via `lj_err_caller*` get the *calling Lua
  frame's* position, none if the caller is C (pcall).
* Message formats: `attempt to %s %s '%s' (a %s value)` (kind global/field/method/upvalue/local), `attempt to call a %s
  value`, `attempt to compare two %s values` / `compare %s with %s`, `bad argument #%d to '%s' (%s)` (method calls shift the
  index and say `calling '%s' on bad self`; name is `?` when the caller is C or the native was tail-called).
* `slotName` (variable naming in errors): scan back from the faulting instruction; MOV follows, GGET => global, TGETS =>
  field/method, UGET => upvalue (named `''` when stripped).
* `shortName`: `=` -> rest (<=59 chars), `@` -> file name (`...` + last 56 chars when >= 60), else `[string "first line..."]`.
* `xpcall`: handler runs at the error point, before unwinding; error inside the handler => `error in error handling`.
  Yield across a C boundary / from the main thread => `attempt to yield across C-call boundary`.
* `string.format`: `%d %i %o %u %x %X` convert with `lj_num2bit` (round half-even, wrap to int32); `%c` int32 cut at NUL; `%s`
  cut at NUL when len < 100 or a precision is given; no `%F` / `%a`; non-finite => `nan` `inf` `-inf`; missing argument =>
  `bad argument #n to 'format' (no value)`; >= 6 flags => `invalid format (repeated flags)`.
* `tostring(number)` = `%.14g` (UCRT: ties-to-even, 2-digit exponent). JS `toFixed/toExponential` round exact ties up, so
  `numfmt.ts` implements correct C rounding.
* `tonumber(s, base)` = 32-bit `strtoul` (sign negates mod 2^32, `0x` accepted for base 16, overflow => 4294967295).
* `pairs`/`ipairs`: `checkany` ("value expected") then "table expected, got X"; no `__pairs`.
* `gsub`: `%` followed by a non-digit adds that character, a trailing `%` adds NUL. `io.write` / `file:write` return `true`.
* `print` calls the global `tostring`; `select('#')` looks only at the first character; `unpack` with n > 8000 results fails
  with "too many results to unpack"; `collectgarbage` options as in 5.1 (`step` always false here).
* `module(name, ...)` makes the module table the calling function's environment.
* Table behaviour (`lj_tab_*`, `hashkey`, `lj_tab_len`) is ported function by function; iteration order of tables with string,
  number and boolean keys is identical to the oracle (checked on every global table of all scripts, see below).

## 4. Verification status of the Lua runtime (honest summary)

| Check | Result |
|---|---|
| `tools/verify-lua-bytecode.ts`: TS loader + disassembler vs `jit.bc` listing of the oracle, all scripts | 4,498 scripts / 26,565 prototypes / 8.4 M listing lines identical |
| `tools/lua-difftest.sh`: 15 differential tests, t01-t09 hand-written (basics, tables, strings, metatables, coroutines, errors, math, misc, library surface), t10-t14 fuzzers (table sizing/`#`/`pairs` order, string library, number conversion and formatting, every operator x every operand type with metamethod logging, `table.sort` ties, 500 random Lua patterns, `os.date/os.time`) and t15 (the chunk loader: all prefixes of 3 oracle dumps, header mutations, chunk names, BOM / `#` headers; 392 lines). The oracle runs with `-joff` and a test fails on a compile error or a non-zero exit of either engine | 15/15 identical (see "Differential fuzz findings" below for what they found) |
| `bun test packages/lua` (`loader.test.ts` 14 tests: text refused, `iEncoding`, `dofile_UTF8`, `require` error wrapping; `proxy.test.ts` 38 tests: the `KLuaManagerProxy` reader, hand-derived from the decompile because there is no native oracle for it, plus the shipped `GameOption*.txt`) | 52 pass |
| `tools/corpus-diff.sh`: every game script run under a stub environment on native LuaJIT and on the TS VM; log of host calls, global table contents (order-independent hash + iteration-order hash) and results of calling every defined function must be identical | see the table at the end of this file |

Not verified / known gaps (also tracked in `docs/ROADMAP.md`):

* **Yield inside a metamethod** (e.g. `__index` that yields): LuaJIT allows it, this VM raises "attempt to yield across C-call
  boundary".
* `setfenv(0, t)` is a no-op; `collectgarbage('step')` always returns false; `__gc` is never called; weak tables
  (`__mode`) are strong.
* No Lua *source* compiler, like the exe (section 11): `load`, `loadstring`, `loadfile` accept bytecode only and answer
  `cannot load malformed bytecode` to text.
* `debug`, `io`, `os`, `package` are approximations: `debug.traceback` text, `debug.getinfo` fields, `os.date` formats,
  `io.input/output` do not switch the default files, `io.popen` raises, `os.execute/remove/rename/tmpname/exit/setlocale` are
  stubs, no C modules. The *names* in every library table are identical to the oracle.
* `string.dump` / `lua_dump` (bytecode writer) is not implemented.
* `math.sin/cos/tan/asin/acos/atan/atan2/exp/log/log10/sinh/cosh/tanh` use V8's libm and `x ^ y` / `math.pow` with a
  *non-integer* (or beyond-int32) exponent use `Math.pow` (the exe uses the CRT and the x87 sequence `fyl2x` + `f2xm1` +
  `fscale` of `vm_pow_sse`), so results can differ in the last ulp for some inputs (x87 transcendental instructions are not
  bit-reproducible across CPUs either). Exactly rounded operations (`+ - * / sqrt floor ceil abs fmod`) and `x ^ n` with an
  int32-valued `n` (repeated squaring, `cmath.ts`) are bit-identical.
* `pcall()` / `xpcall()` with *no arguments* report "attempt to call a nil value" instead of "bad argument #1 to '?' (value
  expected)" (pcall/xpcall are synthetic bytecode closures).
* `string.format('%a')` is not implemented (glibc and the UCRT print it differently anyway) and `%p` / addresses can never match.
* `os.date` follows the exe's CRT (the UCRT) where it is known and glibc is not the reference: 1970..3000 only (else `nil`),
  `%c` is the C-locale `%m/%d/%y %H:%M:%S`; the locale the exe selects at run time (`setlocale`) is not known.
* Printed addresses (`tostring(table)`, `%p`) can never match.
* JIT compilation is not implemented: the VM is an interpreter, semantically equivalent by LuaJIT's contract (nothing in the
  client depends on `jit.*`).

### Differential fuzz findings (t10-t14): behaviours confirmed on the oracle

The fuzzers found 13 divergences that the hand-written tests and the stub-environment corpus had not exercised. All are fixed;
the native behaviour they establish (the oracle is LuaJIT 2.0.2 at the exe's commit, run from the same stripped bytecode) is:

* **Table constructors**: `{...}` allocates an array of `max(narr, 3)` slots; `TSETM` starts at `narr - 1` and, if `start + n`
  exceeds the array size, calls `lj_tab_reasize(needed)`, i.e. `needed + 1` slots (one spare), copying nothing when `n == 0`.
  `#t` is `lj_tab_len`: with `asize > 1` and a nil last array slot a binary search for a border, so `#{...}` with nil holes depends
  on the argument count in a way that only this port reproduces.
* **Library argument conversion**: integer arguments go through `(int32_t)` of the double with `cvttsd2si` semantics (NaN or out
  of range gives `INT32_MIN`, no wrap): `("hello"):sub(2, math.huge) == ""`, `select(2^31, ...)` is "index out of range".
  `%d %x %o %u` use `lj_lib_checkbit` instead (modular wrap, NaN gives 0). `string.rep(s, n, sep)` takes a separator
  (the stock 2.0.2 has it); the result length limit is `0x7fffff00` ("string length overflow"). `string.format` cuts the
  "invalid option" message at the NUL when the conversion character is NUL or missing.
* **`lj_strscan`** (`tonumber`, string arithmetic, `for` coercion): an embedded NUL ends the string; `"-0"` is `+0` but `"-0.0"`
  is `-0`; `inf`/`infinity`/`nan` in any case with an optional sign (the sign of `nan` is ignored); hex integers and hex floats,
  no suffixes, surrounding white space allowed; decimal conversion is **not always correctly rounded** (`"6.1770031190000001e+19"`
  differs from `strtod`), so `strscan.ts` is a literal port of the C code and must never be replaced by `Number()`.
* **`tonumber(s, base)`** (base not 10) is the CRT's 32-bit `strtoul`: one optional sign (a second sign or a space after the sign
  is "no digits"), `0x` for base 16, overflow saturates to 4294967295, a C string (stops at NUL).
* **`x ^ y`, `math.pow`** are `vm_pow_sse`, not the C `pow`: an int32-valued exponent is applied by repeated squaring (one
  rounding per multiplication, `1/x^|n|` for negative `n`), `x^NaN` is 1 only for `x == 1`, `(+-1)^(+-Inf)` is 1,
  `(-1)^(2^31)` is NaN (the exponent no longer fits int32 and `fyl2x` rejects the negative base), `(-Inf)^y` is `+Inf` or 0
  whatever the parity of `y`. JavaScript's `**` differs from all of these (`1 ** NaN` is NaN).
* **`math.min/max`** are `minsd/maxsd` chains: the second operand wins when the values are equal (`math.max(0, -0)` is `-0`) or
  unordered (`math.max(0, nan)` is `nan`, `math.max(nan, 0)` is `0`).
* **Numeric `for`**: the *sign bit* of the step picks the comparison (`+0` is forward, `-0` and the x86 default NaN are backward),
  so `for i = 1, 0, 0` runs zero times and `for i = 1, 3, 0` never ends; an unordered comparison ends the loop. (Trace-compiled
  loops differ from the interpreter in these degenerate cases, which is why the oracle runs with `-joff`.)
* **`__call`** must be a function: `lj_meta_call` does not follow chains, so a table whose `__call` is a table (or `false`)
  raises "attempt to call a table value" for the original object.
* **`table.sort`** is the 5.1 quicksort with LuaJIT's bounds checks `i >= u` / `j <= l` (PUC has `i > u` / `j < l`): an
  inconsistent order function (`<=`, `>=`, `a.k - b.k`) raises "invalid order function for sorting" one step earlier, before
  the comparator sees `nil`. Tie order, the median-of-three and the recursion on the smaller half are identical.
* **`os.time(t)`** reads `sec, min, hour, day, month, year` in that order with `lua_getfield` (honours `__index`), numeric strings
  count, values are truncated like `(int)`, a missing `day/month/year` is "field 'day' missing in date table". **`os.date`**
  compares the format with `"*t"` exactly and casts the time with `(time_t)` (truncation).
* Not behaviours but test pitfalls: native `unpack(t, math.huge)` crashes (signed overflow in `e - i + 1`), `math.min()` after
  another call can return a stale stack slot, and the oracle's `os.date` accepts glibc extensions (`%e`, `%5`) that the exe's CRT
  rejects: such cases are left out of the tests.

## 5. Platform findings (to be extended per phase)

* No GPU in the sandbox. A software Vulkan (Dawn `webgpu` npm package + SwiftShader, `tools/gpu.sh`) runs WebGPU from Node/Bun for
  the unit tests, and a **headless Chromium 153 with WebGPU on the SwiftShader adapter** runs too (`tools/setup-browser.sh`,
  `tools/browser.mjs`; §15.1), so the web client can be tested with real pages and screenshots.
* Sandbox resets keep only the repository directory: regenerate `/home/user/work` with `tools/setup-oracle.sh`,
  `python3 tools/kom_extract.py /home/user/work/ex lua,LUA`, `tools/index_decomp.py`.

## 6. Stub-environment corpus run (what it proves and what it found)

`tools/corpus-diff.sh <flavor>` runs every one of the 4,498 scripts twice, once on the native LuaJIT 2.0.2 oracle and once in the
TS VM (both on the same `luajit -b -s` bytecode), under `tools/lua/stubrun.lua`: unknown globals are stub userdata that log every
call/assignment and return (flavor 1) another stub, (flavor 2) nothing, (flavor 3) the number 0; then the main chunk's result, every new
global (tables: size, `#`, an order-independent content hash, a key-iteration-order hash, the first keys) and the outcome of calling
every defined function twice (no arguments / six stub arguments) are logged. Native and TS logs must be byte-identical.

| flavor | a stub call returns | identical scripts | functions called (ok / err) | main chunks ok / err | host calls logged |
|---|---|---|---|---|---|
| 1 | another stub | 4,498 / 4,498 | 44,043 (19,456 / 24,587) | 4,486 / 7 | 805,348 |
| 2 | nothing | 4,498 / 4,498 | 44,054 (17,966 / 26,088) | 4,483 / 10 | 698,591 |
| 3 | the number 0 | 4,498 / 4,498 | 44,010 (8,847 / 35,163) | 2,925 / 1,568 | 247,490 |

Bugs this found in the VM (all fixed, each now has a regression test):

1. `%q` (testcastle.lua, flavor 1): the exe's `addquoted` escapes `"`, `\` and newline with a backslash and writes the control characters
   0-31 and 127 as `\d`, `\dd` or `\ddd` (three digits if the value is >= 100 or the next character is a digit); the first
   implementation followed Lua 5.1. Test: `t03_strings`.
2. Ordered comparisons (ANU.lua, flavor 1): LuaJIT passes the A operand first (`lj_meta_comp(L, o1, o2, op)`), so the error reads
   `attempt to compare number with userdata` for `2 > stub`, and `a > b` / `a >= b` use `__le` / `__lt` negated (not Lua 5.1's swapped
   `__lt` / `__le`). Port of `lj_meta_comp` (x2.exe.c L2482024). Test: `t04_meta`.
3. NaN (the dragon scripts, flavor 3, `GetNowHP() / GetMaxHP()` = 0/0): `ISGE` is "not ISLT" and `ISGT` is "not ISLE", i.e. true
   for unordered operands; the parser emits them when it negates a condition (`if not (a < b)`, `if a <= b` with an else branch).
   Test: `t01_basic`.

What the corpus does **not** show: the real host objects (every engine call is a stub), long-running behaviour (limit: 3,000 log
lines and 120 function calls per script), yields inside metamethods, garbage collection, numerics beyond what the scripts compute
at load time. Coverage of function bodies is shallow (most calls with stub arguments fail at the first index of a stub).

## 7. Host API and script loading (from the decompile)

* The exe registers its Lua API with `lua_tinker`: **122 classes, 1,418 methods, 34 fields, 93 global objects, 5 global functions,
  19 global constants** (`tools/bindings.py` -> `docs/HOST_API.md`, `docs/host_api.tsv`, one row per binding with the C++ function and
  its IDA address). 68 methods are virtual (the decompiler shows `vcall'{offset}` thunks; they are resolved through the vtable
  structs of `x2.exe.h`), 5 are bound to a no-op (`__empty_global_delete`). Names the decompiler shows only as the address of a shared string
  are resolved in `docs/bindings-overrides.tsv` (marked `(inferred)` when they come from the usage in scripts, not from the binary).
* 46 of the 33,294 functions could not be decompiled (`#error "call analysis failed"`); they are listed in `docs/LEDGER.md` and need
  disassembly if the port depends on them.
* Enum constants (`XUF_DODUM_*`, world ids, ...) are defined by `Enum.lua` / `DungeonEnum.lua` (`CX2Main::LoadLuaEnum`); the exe registers
  only the nation flags (`NF_NONE` 0, `NF_KR` 256, `NF_JP` 512, `NF_TW` 768, `NF_HK` 769, `NF_US` 1024, `NF_CN` 1536, ...).
* Each manager's `OpenScriptFile` declares the globals its script may use (`g_pItemManager`, `g_pWorld`, `g_pUnitManager`, ...) and then
  runs the file; `CX2ItemManager::OpenItemScriptFile` first runs the item scripts against two lightweight *proxy* classes that only
  know `AddItemTemplet` and `AddSetItemData_LUA`.
* The exe's own code names 500 `.lua` files; following `IncludeLua("...")` (134 calls, all with constant names) and string constants
  that name another script reaches 555 of the 4,498 scripts. The rest are loaded through names the exe composes at run time (worlds,
  dungeons, NPCs, dialogs by id) or are dead data; `docs/SCRIPT_GRAPH.md` is therefore a lower bound.
* Scripts call methods that the exe does not register (`AddSpawnMonsterGroup` x522 in 27 scripts, `AddRandomSocketGroupInfo`,
  `AddWeddingHallItem`, `AddSetItemDataTrans_LUA`, ...): none of those scripts is reachable from the exe's loader except
  `GameEditCommandList.lua` (one GM command, `OccurLag_LUA`). The original would raise `attempt to call method ... (a nil value)`.

## 8. Image and table formats (Phase 2 so far)

**How the exe loads a texture** (`CKTDXDeviceTexture::_Load`, 329682A0, x2.exe.c L423330): the KOM entry is handed to
`D3DXGetImageInfoFromFileInMemory` and then `D3DXCreateTextureFromFileInMemoryEx(device, data, size, w, h, MipLevels = 1,
Usage = 0, format = m_LoadTexFormat (the caller's `texFormat`), Pool = MANAGED, Filter = NONE when the size is unchanged else LINEAR,
MipFilter = NONE, ColorKey = 0, ...)`. Consequences for the port: the container is recognised from the **content** (the KOMs hold
BMP, JPEG, PNG and TGA files under `.tga` / `.dds` names), only the top mip level is used, there is no colour key, and the
detail level can shrink the texture (medium: width/height >= 128 are halved, low: quartered; R8G8B8 / R5G6B5 sources are then
re-encoded as DXT1, other low-detail textures as DXT3). `@els/assets` decodes level 0 to RGBA8 (high detail).

**Census** (`tools/census-images.ts`, 55,377 entries): TGA 23,784 = 23,477 true-colour (24 bpp 20,226, 32 bpp 3,227, 16 bpp 24) + 299
RLE true-colour + 3 colour-mapped + 1 grey + 4 that are not TGA (2 BMP `UIEdge.tga` / `HQ_ShopEqipedBorder2.tga`, 2 JPEG
`tempStick.tga` / `tempSword.tga`). DDS 31,593 = DXT1 27,439, DXT5 1,824, DXT3 1,021, R8G8B8 848, A8R8G8B8 428, X8R8G8B8 16,
A4R4G4B4 12, one FourCC 63 (`D3DFMT_Q8W8V8U8` bump map, `field_Peita_stage1_bluegate.dds`) + 4 that are not DDS (a PNG, a TGA
`DLG_UI_AD.dds`, and two **empty** files `Velder_Field_001.dds` / `_003.dds`). 45 DDS carry the volume-texture flag; the exe
never calls `D3DXCreateVolumeTexture*` / `D3DXCreateCubeTexture*` (0 references in `x2.exe.c`), only the 2D loader, so only the
first slice is decoded (what D3DX itself does with such a file is unverified). By size, 128x128 is 20,557 of the 23,784 TGAs and
64x64 is 26,251 of the 31,593 DDS (`image_census.json`).

**Verification** (`tools/decode-images.ts`, `tools/verify-images.py`): 55,372 of 55,377 entries decode (the 5 exceptions are the
Q8W8V8U8 map, the 2 JPEGs and the 2 empty files; JPEG is left to the browser's decoder). Against Pillow 13 as an independent
decoder, **55,348 are pixel-identical** (all DXT1/3/5, all uncompressed DDS, 24/32 bpp, RLE, palette and grey TGA, BMP, PNG);
the 24 that differ are the 16 bpp TGAs, where Pillow ignores the alpha bit and scales 5 -> 8 bits by rounding (we replicate
bits and honour the descriptor's alpha-bit count).

Open assumptions (no D3DX available to compare):
1. 32 bpp TGA = A8R8G8B8 whatever the descriptor says. Measured: 757 32 bpp TGAs have descriptor alpha bits = 0; 729 of them carry
   a real alpha channel (e.g. `Arme_ChargeMp2.tga`, alpha 0..160; reading them as opaque would break the effect and UI atlases),
   26 are fully opaque and 2 have alpha 0 everywhere (`Wisp_Alpha.tga` 2x2, `Mesh_Elsword_Cash_Weapon190.tga` 128x128).
2. 16 bpp TGA with descriptor alpha bits = 1 is A1R5G5B5. Measured: all 24 such files (23 `MESH_*` cash-costume textures +
   `Fire_flame01.tga`) have bit 15 clear in every pixel, so they decode to alpha 0 everywhere. If D3DX honours that bit the renderer
   must still draw them without alpha (the costume meshes obviously show in the game), so: ignore texture alpha for materials that
   do not enable blending / alpha test. To be confirmed against real captures.

**XET / TET are small binary tables, not text** (`CKTDXDeviceXET_Preprocessing::OpenFile` 328EA3A0, `FindAniDataIndex` 328E9F70,
`CKTDXDeviceTET_Preprocessing::OpenFile` 328E6460, `GetTexUV` 328E62E0, `GetString` 328E6280; layouts in `packages/assets/src/xet.ts`):
* TET (1,247 files): `"TET "`, version 256, N, `u32 nameOffset[N]` sorted by `wcscmp`, N x 40-byte UV records (leftTop,
  rightBottom, leftBottom, rightTop, rectSize as float pairs in texels), UTF-16 strings (`u16 length`, chars, NUL).
* XET (4,552 files): 36-byte header (counts of change-texture pairs, animation entries and animation texture-change events, two
  multi-texture stages), then the three tables and the strings. Used for mesh texture swaps and face animations.
* All 5,799 files parse; every string offset resolves; every file ends exactly where its last referenced string ends
  (`tools/verify-xet-tet.ts`). 12 XET files are empty tables.
* **Data bug the port must keep**: the exe finds animations with a binary search using `_wcsicmp`, but 16 shipped XET files
  (the `*_Face_Sorted.XET` family and `UI_NPC_Roseang.XET`) are sorted case-sensitively, so the search misses 120 of their names
  (e.g. in `Mesh_Lire_Basic_Face_Sorted.XET` `CR_LobbyWait` sorts before `ComboX4`). `findAniDataIndex` reproduces the exact
  search, including those misses.

**`General.ess` is the string table** (`CKTDXStringTable::LoadStringTable` 328ADEF0; a plain file next to the exe, not in a KOM; the
`Script.ess` name passed to `InitializeStringTable` is never loaded): UTF-16LE after a 2-byte BOM, one line per entry read with
`fgetws(buf, 2048)` (so at most 2047 units per line), each line cut at its first CR LF, every code unit XORed with 0x10, then
`<decimal id> TAB <text>`; an entry is kept only when its id equals the running line number (otherwise an empty string is stored and
the counter still advances) and the two characters `\n` become CR LF. `GetGeneralString` 328ACCA0 gives `""` outside `0..size-1`;
`GetReplacedString` 328ACE00 substitutes `@1`, `@2`, ... by the arguments described by a type string (`I` string id, `L`/`S`/`l`/`s`
strings, `i`/`h` ints, `f`/`e` doubles rounded to two decimals and printed with the stream default `%g`). Measured on the shipped file
(`tools/verify-ess.ts`; `tools/verify-ess.py` is an independent re-implementation and prints the same counts): **30,584 entries, 0 index mismatches, 0 capped
lines, 3,625 empty texts, 3,029 entries with line breaks, 783 with `@N` placeholders (highest `@5`)**, all Traditional Chinese / ASCII
with no stray control characters. Open point: the exe is built with a modern toolset against the UCRT, whose `printf` rounds exact ties half-to-even on Windows 10 2004 and later
(half-up before); the port does the former. It only matters for values like 0.125 passed to `f` / `e`.

**`item.kim` is the item database as a flat memory image** (`packages/assets/src/kim.ts`, `tools/verify-kim.ts`). It sits in `data036.kom`
(18,704,284 bytes after the KOM layer). `CX2ItemManager::OpenItemScriptFile` 32C49BC0 reads it through the mass-file manager,
`DoMemoryNotEncrypt` 32C4B4B0 checks magic `'KIM '`, version 4609 and size >= `192 * numItems | 0x10`, and the whole buffer becomes
`KItemFormatTemplet::ms_pData`; the templet accessors (32B85150..32B85FD0, 780 lines of decompile, all ported) follow offsets into it.
When the file is missing the exe runs `Item.lua` / `SetItem.lua` instead (the names are passed along), and the image is produced from those
same scripts by `KProxy2` (writer at x2.exe.c L855618), so the KIM is a cache and **a ground truth for what `AddItemTemplet` makes of
`Item.lua`**: once the host API exists, running the scripts must reproduce this table (Phase 5 acceptance test). Layout: 16-byte header
{magic, version, numItems, numSetIDs}, sorted `u32` item ids, `numItems * 188`-byte templets (struct in x2.exe.h: 11 numeric words,
30 string/block offsets, 4 shorts, 16 bytes), sorted `u32` set ids, `numSetIDs * 20`-byte set entries, then the pool (strings =
`u16` length, NUL-terminated UTF-16; stat / ability / socket-option / particle / mesh / extra blocks). Measured: **57,106 items, 3,811
sets, 321,726 strings, 0 out-of-range offsets, 0 length-word mismatches, every templet id equals its table id, every item whose set id
exists is listed in that set (16,575 of 16,737 set-bearing items; 162 name a set that is not in the table; 844 sets list no items)**.
The decoder accounts for the whole file: of 18.7 MB only 51,176 zero padding bytes (block alignment) and 138 bytes of 6 unreferenced
strings are never read, 0 bytes are unexplained (a field I would have missed shows up here). `flags2` bit 0 (PvP item) is never set;
44,745 items carry base stats, 30,205 socket options, 469 special abilities (615 entries), 120 particles, 93 attached meshes, 44 slash
trace colours. Defaults of absent blocks are the exe's zero-initialised dummies (`ms_vOne` = (1,1,1) for render scales).

Not done when this section was written (since then: meshes in section 9, the particle and XMeshPlayer text scripts in section 10, MPEG-1
in section 13): the `XETProxy` / `TETProxy` Lua authoring classes (registered with `lua_tinker`, but none of the 4,498 shipped scripts calls
them; the shipped tables are already binary).

## 9. Meshes, animations and the X-file container (Phase 2)

**Who loads what.** `CKTDXDeviceXMesh::_Load` (3296B780) and `CKTDXDeviceXSkinMesh::_Load` (32970130) look at the first dword: `'KME '`
(541412683) / `'KSM '` (541938507) go to KOG's own loaders (`LoadKMEMesh` 3296A880, `LoadKSkinnedMesh` 3296EBB0), anything else to
Direct3D (`D3DXLoadMeshFromXInMemory` with options 0x220 for static meshes, `D3DXLoadMeshHierarchyFromXInMemory` with a
`CMultiAnimAllocateHierarchy` for skin meshes). By content, the 26,453 `.x` / `.y` entries are:

| | DirectX `bzip` | DirectX `txt` | DirectX `bin` | `KSM ` | `KME ` |
|---|---|---|---|---|---|
| `.x` (13,305) | 12,203 | 67 | 4 | 1,031 | - |
| `.y` (13,148) | 13,001 | 38 | - | - | 109 |

By use (parsed with the generic reader, `tools/verify-xparse.ts`): **`.y` = static meshes** (`CKTDXDeviceXMesh`: map pieces, props,
effects; every one of the 13,039 DirectX-format files holds meshes, on average 5.4 and at most 451 per file, 1.39 M frames in all, only
37 files carry an `AnimationSet`); **`.x` = skin meshes and animations** (`CKTDXDeviceXSkinMesh`: 12,274 DirectX-format files, 7,392
with `SkinWeights`, 5,304 with `AnimationSet`s; the 1,031 KSM files are skeleton + animation (+ mesh) files, 710 of them named `Motion_*`, the largest 18.8 MB
`Motion_Field_Boss_Iron_Eltrion.X`).

**MSZIP (`bzip` / `tzip`)**: `xof 0303bzip0032`, `u32` total size including the 16-byte header, then chunks `{u16 raw (<= 32768),
u16 packed (counts the 'CK'), 'CK', raw deflate}`; every chunk may back-reference the previous 32 KiB of output. Two quirks are
handled in `packages/assets/src/inflate.ts` (own decoder, writes into the shared output buffer, stops after the chunk's raw size):
51 entries contain **stored blocks without the NLEN complement** (LEN, then the data directly), which fflate and zlib reject.
`tools/verify-xfiles.ts --crosscheck`: all 25,204 compressed entries decode to their declared size; the 25,153 that fflate can decode
are byte-identical to fflate's output.

**X-file reader** (`xfile.ts`, text + binary, template-driven): `tools/verify-xparse.ts` parses **all 25,313 DirectX-format files**
(25,208 binary, 105 text) to the last byte with 0 errors in ~100 s. Object census: Frame 1,982,071, FrameTransformMatrix 1,982,071,
AnimationKey 258,972, Material 173,782, TextureFilename 167,227, Animation 108,944, Mesh 107,183 (12.05 M vertices, 10.49 M faces),
MeshNormals 107,183, MeshMaterialList 107,183, MeshTextureCoords 107,120, VertexDuplicationIndices 95,351, SkinWeights 78,639,
XSkinMeshHeader 8,312, AnimationSet 6,856, AnimTicksPerSecond 890, FVFData 72, MeshVertexColors 1. Consistency checked for every mesh:
face indices < vertex count, normal / texture-coordinate / material-list sizes match, material indices < material count, skin
weight vertex indices in range - 0 violations. Shape of the data a mesh layer must handle: **every one of the 10,490,401 faces is a
triangle**; the normals are index-aligned with the positions in 107,150 meshes and **33 are not** (they need vertex splitting); 63
meshes have no texture coordinates; 72 meshes carry `FVFData` (all `dwFVF` 0x800C = XYZB4 | LASTBETA_D3DCOLOR); and **102,313 of the
107,183 meshes sit under a non-identity frame transform** (only 4,870 are at identity), so the order in which frame matrices are
applied matters for the 13,039 static `.y` files. (Binary-format facts the reader relies on: template array dimensions are NAME
tokens, numeric members are packed into INTEGER_LIST / FLOAT_LIST tokens, strings carry a separator token.)

**KME** (`parseKme`, 0x3C-byte header): `'KME '`, version 512, FVF 338 (XYZ | NORMAL | DIFFUSE | TEX1, 36 bytes/vertex, required by the
loader), options (bit 0 = 32-bit indices), then offsets/counts of 72-byte materials (`D3DMATERIAL9` + texture-name offset), vertices,
indices and per-face attribute ids, bounding centre and radius. **KSM** (`parseKsm`): 0x20-byte header (`'KSM '`, 512, offset of the
animation block, centre, max radius, frame count <= 255) + 84-byte frames (name, matrix, bounding radius, mesh-container offset, sibling,
first child; frame 0 is the root, every other frame is referenced exactly once) + 56-byte mesh containers (FVF 274 = XYZ | NORMAL | TEX1
in 8,882 containers, FVF 18 in 54; materials, vertices, 16-bit indices, attributes, 76-byte bones with offset matrix, frame index and
`u32 vertexIndex[n]` + `f32 weight[n]` influences). **KAC** (`parseKac`, the animation block of a KSM): `'KAC '`, version <= 256, sets
{name, type, `f64` ticks/s, playback} with per-frame animations of 5-byte `{f32 time, u8 flags}` keys plus a float payload, unpacked
exactly like `UnpackKeys` (3298A4E0: flag bits 0..2 scale, 3..5 translation, 6 quaternion; bit 7 suppresses a channel when none of
its bits is set; absent components repeat the previous value). Corpus (`tools/verify-ksm.ts`): 109 KME + 1,031 KSM parse with 0 errors
and 0 invariant violations (indices inside the vertex buffer, attributes inside the material list, bones inside the frame list, frame
tree connected, key times non-decreasing, all numbers finite): 52,964 frames (<= 234 per file), 8,936 mesh containers (8 KSM have none;
<= 43 bones, palette <= 20), 1.57 M vertices, 1.59 M faces, 16,428 animation sets in 1,027 files - **all keyframed, none compressed,
all looping, all 4800 ticks/s** - 967,449 animations, 109.6 M keys.

**What the exe adds on top (the static-mesh part is now emulated by `@els/d3d9`, section 12.4)**: static meshes are cloned to FVF 338, their vertex colour is set to 0xFFFFFFFF,
`D3DXComputeBoundingSphere`, `D3DXWeldVertices` (all epsilons 0) and `Optimize(MANAGED | ATTRSORT | VERTEXCACHE)` run, and the
attribute table becomes the draw ranges; keys read from a KSM go through `OptimizeKeys` (32988610, tolerance 0.001) before
`RegisterAnimationSRTKeys`; the `ID3DXAnimationController` is created with 2 tracks and 30 events. Open points for the renderer
phase: (1) D3DX's `D3DXLoadMeshFromX` flattens multi-mesh files with the frame transforms applied (assumed from the documented
behaviour, not checked against the real library; 13,039 `.y` files depend on it); (2) the quaternion convention of X-file
`AnimationKey`s (w,x,y,z, possibly conjugated) can be decided by comparing key 0 with the frame's rest matrix, the same
relationship holds in the KSM files; (3) X-file skin meshes need `D3DXLoadMeshHierarchyFromX` semantics (frame names, `SkinWeights`
-> bone table, `VertexDuplicationIndices`).

## 10. Particle and XMeshPlayer scripts (Phase 2)

**What they are.** 40 `.txt` entries sit in the KOMs. 37 of them are scripts in two private, line-oriented text languages (not Lua):
30 particle scripts (`CKTDGParticleSystem`: `GameMajorParticle.txt` + `2..23`, `GameMinorParticle`, `UIMajorParticle`, ... and their `_INT`
companions; 10,399 sequences) and 7 XMeshPlayer scripts (`CKTDGXMeshPlayer`: `GameMajorXMeshPlayer.txt` alone has 3,339 templets; 3,483 in
all). The other three are `GameOption.txt` and `GameOptionPreset.txt` (text configuration read by `KLuaManagerProxy`, section 11) and the
empty `bossraid_dummy.txt`. `OpenScriptFile` (328FFC70) is the KOM read (decrypt + inflate, `@els/kom`) followed by `Compile(buffer, size)`,
which reads **only the first top-level block** and ignores whatever follows its closing brace. Errors are thrown as `const char*` and
nothing near the parser catches them; the port raises `EffectScriptError` with the exe's text.

**Which script feeds which system** (`CX2StateStartUp::LoadData` 32ED9CB0, x2.exe.c L1544939; `CX2SquareGame` L863261 builds its own copies of
the four game systems from the same files). The constructors take the system id (0 UI major, 1 UI minor, 2 game major, 3 game minor); every
system is a separate name space in which a later definition replaces an earlier one (`EFFECT_SYSTEMS` in `effectscript.ts`):

| system | files, in load order |
|---|---|
| UIMajorParticle | `UIMajorParticle.txt`, `UIMajorParticle_INT.txt` |
| UIMinorParticle | `UIMinorParticle.txt` |
| GameMajorParticle | `GameMajorParticle.txt`, `GameMajorParticle2.txt` .. `GameMajorParticle23.txt`, `GameMajorParticle_INT.txt` |
| GameMinorParticle | `GameMinorParticle.txt`, `GameMinorParticle_INT.txt` |
| UIMajorXMeshPlayer | `UIMajorXMeshPlayer.txt`, `UIMajorXMeshPlayer_INT.txt` |
| UIMinorXMeshPlayer | `UIMinorXMeshPlayer.txt` (one empty templet) |
| GameMajorXMeshPlayer | `GameMajorXMeshPlayer.txt`, `GameMajorXMeshPlayer_INT.txt` |
| GameMinorXMeshPlayer | `GameMinorXMeshPlayer.txt` |

`rena_A_trapingArrow_Particle.txt` and `rena_A_trapingArrow_Xmesh.txt` are named nowhere (exe literals and Lua constants checked): stale
working copies of sequences that also live in `GameMajorParticle8.txt` / `GameMajorXMeshPlayer.txt` (9 of 12 sequences and 2 of 4
templets are identical in the parsed model, the rest differ). 261 definitions repeat a name that an earlier file defines (counting the
files in name order): 243 of them across different systems (e.g. `GameMajorParticle.txt` and `GameMinorParticle.txt` share some), which do
not clash, 16 in the two unreferenced `rena_*` files, and **only 2 inside one system**: `PET_SNOWBUMP_Attack_C_M01` and
`Pengzzang_Attack_C_Explosion` in `GameMajorXMeshPlayer`, where `GameMajorXMeshPlayer_INT.txt` (loaded last) replaces the first
definition. No name is defined twice inside one file.

**Replace semantics** (confirmed in the decompile for both languages): `ProcessEventSequenceBlock` (329007C0) and `ProcessTempletBlock`
(3291ECD0) put the new object into the system's name map *as soon as its name has been read* and delete the previous object of that name
(`ParticleLibrary.replaced`, `XMeshLibrary.replaced`). The `erase` that `ProcessParticleSystemBlock` does afterwards is dead code (the
callee always returns 1), so a script that fails halfway still leaves the half-built object registered.

**Tokenizer quirks, ported on purpose** (listed with examples in the header of `effectscript.ts`, one test each in
`packages/assets/test/effectscript.test.ts`): the last token is emitted twice when the text ends in white space (the buffer is not
cleared after a flush; a missing final `}` is therefore closed by the duplicate); `{abc` is one token, `x=5` is one token; a quote right
behind a word appends the string to the word; `//` inside a word drops the word, `--` is a comment only where a token starts; a file
that ends inside a comment ends with a stray `/` or `-` token; a number token is whatever starts with a digit or `-` up to the next
delimiter and `_atof` reads its prefix, so the shipped typo `fade so from 0.s1 to 0.5` (sequence `Sand_villeage_balpanWIND_P02` in
`GameMinorParticle.txt` and `UIMinorParticle.txt`) means 0.

**Model.** The parse result keeps what the exe's constructors and `ProcessTokenStream` functions store, at the exe's precision (`float`):
`Random(a, b)` stays a range (`MinMax`); int fields keep `(int)max` or `(int)` of both ends as the exe does; spherical angles are converted
to radians; fields the exe draws once when a sequence is *instantiated* (`TRIGGERCOUNT/TIME`, `DRAWCOUNT`, `LANDPOS`, `BLACKHOLEPOS`,
`LIGHTPOS`, `ADDROTATEREL`, `SPHERICAL_EMITROTATION`) stay ranges, so that loading is deterministic and the run-time draws from them with
`randomNumber` / `MsvcRand` (the CRT `rand`: the same generator in the UCRT). Particle `final` events get the time range `[0, LIFETIME.max]` using the LIFETIME written
*before* them; XMeshPlayer `final` is a flag with time `[0, 0]`. Fading (`fade so`) is refused for `texture` / `eventtimer` / `blackholetime`
(particle) and `aniname` / `slashtrace` / `anispeed` / `blackholetime` / `resetcrash` / `sound` / `render_type` (XMeshPlayer). Enumerations
carry the D3D9 values (`D3DBLEND_*` 1..15, `D3DCULL_*` 1/2/3, tested against the documented numbers), the exe's own enums for `PT_*`, `BT_*`,
`RT_*` (19 names; an XMeshPlayer `RENDERTYPE` accepts 16 of them, a particle `MESHRENDERTYPE` 4), `LT_*`, `XAP_*`. XMeshPlayer `TEXTURECHANGE` is
classified as an event property but the factory has no class for it, so it is an error. Defaults are those of `CParticleEventSequence`
(328F3FB0) and `XMeshTemplet` (329165A0): e.g. a particle sequence blends SRCALPHA / DESTALPHA, an XMeshPlayer templet SRCALPHA / INVSRCALPHA.

**Verification** (`bun run tools/verify-effects.ts [--census]`, 3 s). There is no native oracle for these parsers (no exe to run), so the
check is an *independent* second reader, `tools/lib/effect-oracle.ts`, that shares no code with the parsers: it relies on the corpus being
line-oriented (one statement per line, no `=` shared between statements, no brace on a statement line; all checked) and rebuilds every
sequence / templet from lines and regular expressions. Result: **all 37 scripts parse; 13,882 blocks (10,399 sequences, 3,483 templets),
152,174 properties, 94,839 events, 2.07 M tokens (10.4 MB) agree with the oracle field by field**; the counts agree three ways (parser
statistics, oracle statements, raw census of `=` signs and block keywords); the tokens after the closing brace are exactly the duplicated
last token when the file ends in white space (none otherwise); no stray lines, no non-ASCII bytes outside `--` comments (Korean CP949
comments in 4 files). Mutation check: breaking `from A to B` times, `final`, `NUMPARTICLES`, `DRAWCOUNT`, the xmesh `final` flag in the
parser makes the verifier fail; changes to fields whose `Random` ends are never different in the data (XMeshPlayer `LAYER`, `to` times) or to the
shared enum tables are *not* detected by the corpus (the unit tests cover them: 171 tests in `effectscript/particle/xmeshplayer.test.ts`,
including every reachable error message, the tokenizer quirks, and verbatim excerpts of `GameFight`, `Flare_Nasod_Diriler_Cannon_HyperCannon02`,
`ArmeAirBlastCenter`, `AishaLightningBolt`, `STEAL_SOUL_FX`). The first run found a quirk the oracle did not model (`0.s1`, above).

**What the data exercises** (`--census`): every sequence has PARTICLETYPE, both blend modes, NUMPARTICLES and LAYER (`PresentADDProl6_1` writes it twice, the last wins) and a LIFETIME
(except `Defence_Dugeon_Effect_02`, both in `UIMajorParticle.txt`); 36,200
of 77,275 particle events fade; XMeshPlayer has 17,515 `Global` events, **49 `Anim` events and no `Die` event at all** (74 templets set `UseDieEvent`
but write no `Die` event), 28 `final` events, 4,403 fading events. Handled by the exe but never used in the shipped data (covered by unit tests
only): particle `ALPHATEST`, `SKINMESH`, `MULTITEXXET`, `ANIXET`, `ANINAME`, `SPHERICAL_EMITROTATION`, event `TEX1UV`; XMeshPlayer `DIEPLAYCOUNT`,
`DIELIFETIME`, `LANDPOS`, `BLACKHOLEPOS`, events `TEX2UV`, `BLACKHOLETIME`, `CRASH`, `RESETCRASH`, `LIGHTFLOWPOINT`, `SOUND`.

**Not done.** Only the compile side is ported. The run-time (`CreateSequence` / `CParticleEventSequence` instantiation with the load-time draws,
`OnFrameMove` of every event class, the emitter and mesh-instance simulation, rendering, the Lua handle API) belongs to phases 3 and 5 and needs
the renderer to check against. `catof` uses `Number()` on the digit prefix, which is what the UCRT's correctly rounded `atof` gives.
`isspace` and `_toupper` are assumed ASCII (the scripts are ASCII outside comments); `ConvertCharToWCHAR` of names is ACP-dependent for non-ASCII
names, which do not occur.

## 11. Chunk loading and the text configuration files (Phase 1b)

**The client cannot compile Lua source.** Phase 1b was planned as a port of `lj_lex.c` / `lj_parse.c`, because three files look like Lua source
(`GameOption.txt`, `GameOptionPreset.txt`, `TutorSystem.lua`). The decompile shows that the premise was wrong, so no source compiler is built:
it would not be faithful, in the exe `loadstring("return 1")` fails.

* Of the lexer, the exe links `lj_lex_setup` (33376640), `lj_lex_cleanup`, `lj_lex_token2str`, `lj_lex_error`, `lj_lex_init`, `fillbuf`,
  `save_grow` and the readers `reader_file/string/func`. `lj_lex_next`, `lj_lex_lookahead` and every `lj_parse*` / `expr_*` / `parse_*` function are
  *not among the 33,294 functions* (the `LJ_ERR_X*` parser messages are unused too).
* `cpparser` (33378B50, the protected body of `lua_load`) is: `if (lj_lex_setup(L, ls) == 0)` throw `LJ_ERR_BCBAD` (`cannot load malformed bytecode`,
  status `LUA_ERRSYNTAX`, no chunk name); then, if the `mode` string has no `b`, `LJ_ERR_XMODE`; then stock `lj_bcread`. `lj_lex_setup` is stock: it
  returns 1 only when the first character (after an optional UTF-8 BOM and an optional `#` line) is ESC, and it throws `BCBAD` itself when a BOM or
  `#` line came before the ESC (stock refuses a dump with an extra header "for security reasons" and echoes no chunk name).
* Therefore **every chunk that is not a dump fails with `cannot load malformed bytecode`**: text, an empty buffer, a lone BOM, a lone `#` line, a dump
  behind a BOM / `#` line. The game can only run precompiled scripts; stripping the parser also means no script (or injected string) can be compiled
  at run time. *(That this was done on purpose is an inference; the effect is certain.)*
* The stock oracle *does* compile text, so text cases can never be compared with it: they live in `packages/lua/test/loader.test.ts`; the
  differential test `t15_loader.lua` feeds both sides only dumps.

**Chunk loading as ported** (`packages/lua/src/lib/base.ts`, `bytecode.ts`).

* `loadChunk(L, data, chunkname, env?)` = `lj_lex_setup` + `cpparser` + `lj_bcread`. A header failure (magic, version, flags, truncated header) is
  `cannot load incompatible bytecode`, a failure in the body `cannot load malformed bytecode`; the chunk name in the message follows `bcread_error`:
  `(binary)` when the name starts with ESC, otherwise the name without a leading `@` or `=` (the default name of `loadstring(s)` is `s` itself, so a
  dump loaded without a name reads `(binary)`). A dump of the other byte order is accepted and swapped like `bcread_swap`; a dump that ends exactly at
  its terminator is accepted (stock reads the NUL); sizes that the rest of the dump cannot hold are refused *before* allocating.
* `luaL_loadfilex(L, name, mode, iEncoding)` (33378830, KOG added the 4th argument): with `iEncoding` 2 no check; otherwise a first byte 0xEF must be
  followed by BB BF (the BOM is consumed and never reaches the lexer, so `BOM + dump` loads as a dump, while stock would refuse it), and any other first
  byte that is not ESC gives `invalid encoding <chunkname>` unless `iEncoding` is 0. `luaL_loadfile` passes `lua_getencoding(L)` (`global_State` +380,
  0..2; the game calls `lua_setencoding(L, 1)` at L2474299), `loadfile` / `dofile` use it, `dofile_UTF8` (`lj_cf_dofile_UTF8`, 3338DD00) always passes 1.
  Unreadable files: `cannot open <name>: No such file or directory`. `require` wraps a loader error like `loaderror` of `lib_package.c`.
* The host level: `KLuabinder::DoMemoryNotEncrypt` (L284138) and `KLuaManager::DoMemoryNotEncrypt` (L375218) decide *before* Lua sees a buffer: encoding 2 or
  a first byte of 27 -> `dobuffer`; a BOM -> skip 3 bytes, then `dobuffer`; anything else -> return 0 (never reaches Lua). Phase 5 work.

**`KLuaManagerProxy`: how the text files are really read** (`packages/lua/src/proxy.ts`; decompile L2579858-L2582535; `GetNumberFromLuaValue<int>` L982041,
`<float>` L996114). The text is interpreted by a hand-written statement parser, not by Lua:

* Callers: `CX2GameOption::OpenScriptFile` (L990011; `GameOption.txt`, table `GAME_OPTION_CURRENT`; presets from `GameOptionPreset.txt`),
  `CX2InstanceData::OpenScriptServerGroupFile` (L981836; `SERVER_GROUP = SERVER_GROUP_ID["SGI_GAIA"]`, accepted values <= 1),
  `CX2TutorSystem::OpenScriptFile` (L1521239; tables `UNIT0`, `UNIT1`, ... with `UNIT_NAME`, `VIEW_AFTER_A_WEEK`, `LAST_VIEW_YDAY_CANDIDATE_LIST`,
  `REFUSE_FOR_A_WEEK`, `LAST_REFUSE_YDAY_TUTOR_REQUEST`; the shipped `TutorSystem.lua` is just a BOM, so the read returns false and the exe logs an
  error) and `CX2GameEdit::ExecCommand` (L1033948; every console argument goes through `LuaParse` with name expansion, then `LuaCall`).
* The model is a `Value` (nil, boolean, number = double, string = UTF-8 bytes, table = shared reference) and a `Table` (an array part `m_vec` and a
  name map `m_map`). The proxy holds a deque of tables (the root created by the constructor, one more per open `{` / `BeginTable`) and the `lua_State`.
* `DoMemoryNotEncrypt(buffer, size)`: a null buffer, an empty text (after an optional BOM) or a NUL as first byte -> false. The text is cut into
  lines at every CR and every LF (an empty "line" between CR and LF is skipped); `--` starts a comment that runs to the end of the line *even inside
  a string*; a NUL byte ends the text. Each line is tokenised like `boost::char_separator(" \t\n\v", "=,{}[]")` (blanks are dropped, the six
  delimiters are tokens of their own, no empty tokens; `\f` and `\r` are NOT blanks). A state stack starts at `NONE`; the pending names `kw` / `kw2`
  persist across lines.
  * `,` and `}` settle the pending entry of the current table: `DONE` -> `NONE`; `KEYWORD` (a bare name) -> look the name up (`LuaKeyword`) and push it to
    the array part; `ASSIGN_KEYWORD` (`NAME = OTHER`) -> look `OTHER` up, a non-nil value is stored as `NAME`, nil *removes* `NAME`. Every other state
    is an error. `}` additionally needs an open `{` and pops the state and the table.
  * `=` needs a bare name before it. `{` after `=` stores a new table under the name, in state `NONE` it appends an unnamed table to the array part
    (anything else is an error). `[` / `]` bracket a reference (below). Any other token goes through `LuaParse`.
  * `LuaParse(token, expand)`: trim; empty -> error. `"..."` (first and last char must be quotes; nothing is unescaped, so a string can contain no blank
    and none of `= , { } [ ]`) -> string. A leading digit -> `boost::lexical_cast<double>` (throws `bad_lexical_cast` for `0x10`, `12abc`, `1;`; nothing
    in the loader catches it). `nil`, `true`, `false` (exact case) -> values. An identifier -> `KEYWORD` (with `expand` it is resolved and must succeed).
    `+` / `-` followed by a digit -> number. Everything else is an error (so no `.5`, `-x`, `'x'`, `f(1)`, `A.B`, `1 + 2`).
  * Values: in `NONE` a value is appended to the array part, after `NAME =` it is stored under the name; `nil` removes the name. After a value the state is
    `DONE`, which at the top level (no open `{`) still allows the next `NAME`, so **top-level statements need no commas but entries inside braces do**,
    and **an identifier value (`A = TRUE`) is only resolved at the next `,` / `}` / end of text, so a following statement without a comma is an error**.
  * `NAME[n]` / `NAME["key"]` (as a value or a list entry): `n` must be an integer >= 1; `NAME` is looked up in the statements read so far (the root
    table), then among the Lua globals (a global must be a table). Out of range / missing key gives nil (and removes the name), an unknown or non-table
    name is an error. This is how `OPTION_LEVEL["OL_HIGH"]` gets its number from `Enum.lua`.
  * `LuaKeyword(name)` and the reference lookups read the **first (root) table** even inside nested braces; a name is looked up in the root map first, then
    as a Lua global (`lua_getfield(L, LUA_GLOBALSINDEX, name)`; nil, booleans, numbers and strings (cut at the first NUL) convert, tables / functions /
    userdata fail, an unknown name is nil, which is *not* an error). Because `NAME = {` stores the table before its contents are read, a table can
    reference itself.
  * Any error returns false at once and leaves what was read (the stacks are not unwound). At the end of the text the pending entry is settled like
    `,` and the read succeeds only if every `{` was closed.
* Queries (`StackGetValue`, `GetValue`, `BeginTable`, `EndTable`, `GetNumberFromLuaValue`): they use the *innermost* table. `BeginTable(name)` needs a table
  under that name (`BeginTable(name, i)` looks up `name` + decimal `i`, e.g. `UNIT` 3 -> `UNIT3`), `EndTable` never pops the root. `GetValue(bool)`: nil is
  false, boolean, number -> `(int)n != 0` (so 0.5 is false); strings and tables fail. `<int>`: boolean 0/1, number `(int)` (x87 truncation, out of range =
  0x80000000), string -> `lexical_cast<int>` (throws); `<float>` likewise. String values: UTF-8 -> UTF-16; a number is formatted by
  `lexical_cast<std::wstring>(double)`. `LuaCall(name, args)` calls a global *function* with boolean / number / string arguments (anything else is nil).
* Shipped data it reads (verified by `proxy.test.ts` from `data036.kom`, with `Enum.lua` run in the VM: `TRUE` = 1, `FALSE` = 0, `OPTION_LEVEL` =
  {`OL_HIGH` 0, `OL_MEDIUM` 1, `OL_LOW` 2}, `SERVER_GROUP_ID` = {`SGI_INVALID` -1, `SGI_SOLES` 0, `SGI_GAIA` 1, `SGI_END` 2}): `GameOption.txt` gives
  `GAME_OPTION_CURRENT` with 13 numbers (`GRAPHIC_UNIT/TEXTURE/MAP` 0, `GRAPHIC_EFFECT` 1, 1024 x 768, `SOUND_VOLUME` -439, `MUSIC_VOLUME` -1871, ...);
  `GameOptionPreset.txt` gives `GAME_OPTION_PRESET0..3` (640x480 low ... 1600x1200 high).

**Verification and honest limits.**

* Loader vs the native oracle: `t15_loader.lua` (392 output lines identical): every prefix of three dumps, header and flag mutations, chunk names
  (`@`, `=`, ESC, none), BOM / `#` headers. The whole corpus still loads identically (corpus flavor 1: 4,498 identical). A mutation sweep of 1,880 damaged
  dumps (every cut, 7 byte values at every position, a trailing NUL, a dump twice) classifies as: the oracle itself crashes on 45 (stock reads past the
  buffer: `bcread_ktabk` has no `bcread_need` before `bcread_mem`, and `ls->n` underflows in release builds); 1,780 give the same answer; 21 differ because
  byte 0 (ESC) was destroyed and the oracle then *compiles* the text; 34 differ because stock raises `table overflow`, `table index is nil` or
  `string length overflow` for damaged table constants, where the port says `malformed` (the exe's behaviour there is a consequence of the unchecked
  read, i.e. not a contract).
* The proxy has **no native oracle** (the class only exists inside the exe), so `proxy.test.ts` (38 tests) was derived by hand from the decompile and the
  shipped files; a misread of the decompile would not be caught by it. Assumed, not measured: the `boost::lexical_cast` formats (the exe's boost is older than
  1.54, it goes through `istream`: a number must be a complete decimal literal, overflow fails, `lexical_cast<std::wstring>(double)` prints 17
  significant digits), `MultiByteToWideChar` replacement characters, ASCII-only `isalpha/isdigit/isspace`.
* Not ported: the callers (`CX2GameOption::OpenScriptFile`, `CX2InstanceData::OpenScriptServerGroupFile`, `CX2TutorSystem::OpenScriptFile`, `ExecCommand`), the host
  level `DoMemoryNotEncrypt` of `KLuaManager` / `KLuabinder`, and writing the files back (`GameOption.txt` is saved by the game; its writer is not ported).

## 12. The D3D9 layer, D3DX and the X scene (Phase 3)

Picture: `docs/img/d3d9-demo.png` (`tools/render-demo.ts`) - the HK loading screen `dlg_first_loading0_hk.tga` as a pre-transformed
quad and the starter sword `MESH_ELSWORD_BASIC_WEAPON.X` (data017.kom) with its texture, lit by one directional light, in three poses,
produced by the D3D9 device and the D3DX functions on a software WebGPU device.

### 12.1 What the client asks of Direct3D (census of the decompile)

* **Calls.** 467 typed COM calls on the device / resources / effect, 53 D3DX imports: textures 5 (`CheckTextureRequirements`,
  `CreateTexture`, `CreateTextureFromFileInMemoryEx`, `GetImageInfoFromFileInMemory`, `SaveSurfaceToFileW`) + `CreateBuffer` / `CreateLine` /
  `CreateEffect`; meshes, skin and frames ~14; animation 3; math 26 (all in `d3dx-math.ts`). The enum-valued arguments of the
  decompile are mostly untyped (`int`), so a census by enum name is meaningless; the typed-call regex only sees calls the decompiler could type.
* **State wrappers.** `CKTDGStateManager` (328D1BD0 `RestoreDeviceObjects`, x2.exe.c L296401) writes *all* states back to the D3D9
  defaults: 103 render states, 18 texture-stage states x 8 stages, 13 sampler states x 16 samplers (tables `aeDRS` / `aeDTSS` / `aeDSSS`, a handful
  of float-valued ones patched in as IEEE bit patterns), and keeps a mirror (`ms_adwRenderState`, ...) + a push / pop stack (`KD3DStack`, 328D9980)
  so that a draw can set a state and restore it. `CKTDGEffectStateManager` (328B2E20-328B3BE0, L270982-271757) is the `ID3DXEffectStateManager`
  that routes the effect's state changes through the same mirror.
* **Dynamic vertex data.** `CKTDGDynamicVBManager` (L313274-315370) works with the FVFs 66 (XYZ | DIFFUSE), 258 (XYZ | TEX1), 322 (XYZ | DIFFUSE | TEX1)
  and 324 (XYZRHW | DIFFUSE | TEX1), buffers of usage 0x208 (DYNAMIC | WRITEONLY) / 0x8, locks with DISCARD (0x2000) / NOOVERWRITE (0x1000); triangle fans are
  special-cased by the device's `MaxPrimitiveCount`. `SetMaterial` is called per subset by `CKTDXDeviceXMesh::Render`, `SetVertexDeclaration` only by
  `CKTDGUIControl::RenderVertex`.
* **Render targets.** `CKTDXDeviceRenderTargetTexture` (L431540-431960): `D3DXCreateTexture(D3DUSAGE_RENDERTARGET, back-buffer format, DEFAULT)` + a depth
  surface of the same size; `Begin` = `SetRenderTarget` / `SetDepthStencilSurface` (+ `Clear(TARGET | ZBUFFER, 0, 1.0)`), `CopyBackBufferToSurface` = `StretchRect(..., LINEAR)`.
  `CKTDGDynamicTexture`: a SYSTEMMEM texture (`LockRect` flags 0x8000) -> `UpdateTexture` -> DEFAULT texture.
* **Device selection** is DXUT (`CKTDXApp`); the only caps the client reads are `DevCaps`, `TextureCaps`, `PresentationIntervals`,
  `MaxPrimitiveCount`, `MaxVertexShaderConst`, `VertexShaderVersion`.
* **One effect**: `XRenderer.fx` (data041.kom; `CKTDGXRenderer::OnResetDevice` 329749E0 -> `D3DXCreateEffect`). 19 techniques (table `off_3362652C`) and 19
  parameters (`off_336265C4`); the vertex shaders are `vs_1_1` (arrays `vsArray{RealColor,Cartoon,BlackEdge,ColorEdge}11[10]`: index 0 = non-skinned,
  1-4 = skinned with 1-4 bones, 5 = non-skinned + fog, 6-9 = skinned + fog; `vsArray{X,Y,Z,Point}Flow{World,Local}11[5]`; chosen by `g_iShaderIndex`), the
  pixel side is fixed-function texture stages set by the passes' render states. `GCSkin.fx`, `RenderState.fx` and `XPosteffect.fx` are shipped but never referenced.

### 12.2 The layer: design decisions

* **API shape**: `Direct3DDevice9` with D3D's PascalCase names and `HRESULT` results so the ported engine code can stay line-for-line; the C++ out-parameters
  become result objects (`{hr, vb}`, `{hr, data}`, `{hr, pBits, pitch}`).
* **One shader per state combination, generated**: the device state that matters for a draw (vertex format, lighting, fog, stage cascade, alpha test, ...)
  is reduced to a `ProgramDesc` key; WGSL is generated once per key (`ffp.ts`) and pipelines are cached per (program, vertex layout, blend / depth / stencil / target).
* **Matrices are uploaded as D3D stores them** (row-major, row vectors); WGSL reads the 16 floats as columns, so `M * v` equals D3D's `v * M` and no CPU
  transpose is needed. Clip space differences (z in [0,1] in both APIs) need nothing; the **half-pixel offset** is applied in the vertex stage
  (`pos.xy += (+w/vpW, -w/vpH)`) because D3D9 pixel centres sit on integer window coordinates. `XYZRHW` vertices skip the transforms and map to the full render target.
* **Attribute locations by semantic** (POSITION 0, BLENDWEIGHT 1, BLENDINDICES 2, NORMAL 3, PSIZE 4, COLOR0 5, COLOR1 6, TEXCOORD0-7 7-14, TANGENT 15); D3DCOLOR is
  fetched as `unorm8x4` and swizzled `.zyxw`. Inter-stage locations are fixed too (diffuse 0, specular 1, texcoords 2-9, fog 10).
* **Uniforms**: group 0 = three blocks with dynamic offsets into a per-frame arena (transforms 228 floats, lighting 248, misc 56; 256-byte aligned); group 1 = 8 x (texture, sampler).
* **Hazards**: the GPU only sees data when the encoder is submitted, but `queue.writeBuffer` executes at once. Dynamic VB / IB and user-pointer data are
  *snapshotted into the arena at draw time*; static buffers and textures that are written after they were used by a recorded draw of the same frame are
  *renamed* (a fresh GPU object) unless the lock said NOOVERWRITE. Frames are submitted at `Present` / `readPixels`.
* **Render targets**: alpha-less targets (X8R8G8B8) mask alpha writes and read back alpha 255; a depth surface whose size differs from the render target is
  skipped with a warning (D3D9 would fail the draw); WebGPU depth starts at 0 and D3D9 never clears automatically, so tests and ported code clear ZBUFFER first.
* **Formats**: colour formats are expanded to 8 bits per channel by bit replication and uploaded as `rgba8unorm` (BGRA for render targets); DXT1/3/5 stay BC1/2/3 when the adapter
  has `texture-compression-bc` (SwiftShader does) and are decoded on the CPU otherwise; A8 samples as (0,0,0,a), L8 as (l,l,l,1), A8L8 as (l,l,l,a).

### 12.3 What is verified, and how

`packages/d3d9/test` (153 tests in 14 files, run with `./tools/gpu.sh bun test packages/d3d9`; all on Dawn + SwiftShader; expectations are analytic or computed on the CPU):
vertex formats and the draw path (all primitive types, indexed / user-pointer / base vertex, triangle fans), clear / viewport / scissor / colour mask / stencil
(D3D compare is `(ref & mask) FUNC (buffer & mask)`, DECR wraps 0 -> 255), blend / alpha test / depth / cull, the full texture-stage cascade, all light types with
attenuation, spot cone and the four colour sources, vertex / table / pre-transformed fog, texture coordinate generation and 2D / 3D texture transforms, sampler address /
filter / LOD / anisotropy, 12 uncompressed formats and BC1 / 3 / 5 (within +-1 of the CPU decode), render-target textures, `StretchRect`, `UpdateTexture`, `Reset`, D3DX math (identities, the operand
order of `D3DXQuaternionMultiply`), D3DX textures, meshes, animation and skinning (below), the `XRenderer.fx` effect with its shaders (12.7). Mutating the code (flipping a blend factor, dropping a stage) makes the corresponding test fail; the tests that
saved pictures were looked at once. What is *not* verified is anything that needs the real D3D9 (see 12.5).

**The one oracle there is for D3DX.** Wine's `dlls/d3dx9_36/tests/mesh.c` (read through `api.github.com`, repository `wine-mirror/wine`) holds expectations that Wine must also meet on *native* Windows.
`packages/d3d9/test/loader-native.test.ts` re-types its X files and uses its numbers: the cube loads as 24 vertices / 12 triangles with the split vertices in order of first appearance,
`D3DCOLOR`s from float colours (`0.1` -> `0x1a`: `(BYTE)(c * 255.0f + 0.5f)` in float arithmetic, `0.7` -> `0xb3`), a quad becomes the fan `(0,1,3) (0,3,2)`, the material fields are
Diffuse = faceColor, **Ambient = (0,0,0,1)**, Specular / Emissive = colour with alpha 1, and a file without materials gives one default material (diffuse and specular 0.5, *alpha 0*, everything else 0);
`D3DXLoadMeshHierarchyFromXInMemory` makes a frame with a **NULL** name around a top-level `Mesh`, names unnamed `Frame` / `Mesh` blocks `""`, adds one more root frame (NULL name, identity) when the file has
several top-level frames / meshes, returns `E_FAIL` for a file without frames, `D3DERR_INVALIDCALL` for empty data / no device / no allocator and no controller when there is no `AnimationSet`;
`D3DXFrameFind` is breadth first (siblings first, then the children of the first frame, then of the second ...: Wine's sequence of 14 checks is replayed in `skin.test.ts`); `UpdateSkinnedMesh` does not apply the
stored offset matrices and zeroes position and normal of vertices that no bone influences. The same file showed three mistakes of the first version, now fixed: ambient was set to the diffuse colour, equal normal
*values* under different normal indices were split (the data never does this: of 107,183 meshes 4 split at load, 16 extra vertices, none skinned, and value and index comparison always agree), the D3DCOLOR rounding was done in double precision.

### 12.4 D3DX

**Textures** (`d3dx-texture.ts`). The exe's loader (`CKTDXDeviceTexture::_Load` 329682A0, L423330-423700) calls `D3DXGetImageInfoFromFileInMemory`, halves the size at medium
detail (>= 128) / low detail (>= 64; >= 128 quartered) and picks DXT1 for R8G8B8 / R5G6B5 sources, DXT3 otherwise, then `D3DXCheckTextureRequirements(dev, &w, &h, &mips, 0, &fmt, MANAGED)` and
`D3DXCreateTextureFromFileInMemoryEx(dev, data, size, w, h, 1 level, 0, fmt, MANAGED, FILTER_NONE or FILTER_LINEAR (when the size changed), MipFilter NONE, ColorKey 0, &info, 0, &tex)`
(`fmt` is `OpenTexture`'s `texFormat`, normally UNKNOWN). The port implements exactly that call. Decisions: UNKNOWN keeps the file's format (R8G8B8 -> X8R8G8B8, P8 -> A8R8G8B8; a bare
`Check(UNKNOWN)` gives A8R8G8B8); DDS DXT data is copied block for block including its mips; LINEAR = one bilinear tap at the pixel centre, NONE / POINT = nearest, BOX / TRIANGLE = footprint
average; the colour key compares the full ARGB value (0 = off) and writes transparent black; mips are 2x2 box averages; JPEG is reported by `GetImageInfo` but `Create` returns
`D3DERR_NOTAVAILABLE` (2 `.tga` files hold JPEG: left to the browser decoder); garbage gives `D3DXERR_INVALIDDATA` (0x88760B59); `SaveSurfaceToFileInMemory` always returns PNG data.
The detail-level reduction therefore yields *smaller uncompressed* textures: **DXT compression is not implemented**.

**Meshes** (`d3dx-mesh.ts`, `@els/assets/xscene.ts`). `CKTDXDeviceXMesh::_Load` (3296B780, L425250-426100) does: `D3DXLoadMeshFromXInMemory(options 0x220 = MANAGED)` -> if `GetFVF() != 338`
`CloneMeshFVF(MANAGED, 338)` -> writes 0xFFFFFFFF into every vertex colour (through the index buffer) -> `D3DXComputeBoundingSphere` -> `D3DXWeldVertices(mesh, 0, all epsilons 0, adjacency)` ->
`Optimize(0x6000220 = ATTRSORT | VERTEXCACHE | MANAGED)` -> `GetAttributeTable` -> a bounding sphere per subset from its vertex range. `CKTDXDeviceXMesh::Render` (L426367) keeps
the current material, then per attribute group `SetMaterial(m_pdxMaterials[AttribId])`, binds the group's texture **only if it has one (an untextured group keeps the previous texture)**, optionally sets
stage-1/2 multi-texture ops from the XET, and calls `DrawSubset(AttribId)`. The port reproduces this sequence on `D3DXMesh` and tests it on a real file: `MESH_ELSWORD_BASIC_WEAPON.X`
has 3 meshes (the sword and two 8-corner helper boxes `ATTACK_LINE_*`), loads as 78 faces / 85 vertices / FVF 274 / 3 materials, welds to 77 vertices, optimizes to the table
`[attr 0: faces 0-53, vertices 0-36] [1: 54-65, 37-56] [2: 66-77, 57-76]` (the weld merges the boxes' duplicated corners: 24 -> 20 each).
Semantics that the sequence makes observable and that are implemented as D3DX documents them (flagged where they are guesses, 12.5): `LoadMeshFromX` merges every mesh of the file with its
accumulated frame transform baked into positions and normals (row vectors: `world = local * parentWorld`), appends the materials of each mesh, adds vertices where a face corner uses another
normal *value* than the first corner that used the position (Wine / native: appended in order of first appearance), triangulates polygons as fans (the data has none), sorts the faces by material with the
loader's own `OptimizeInplace(ATTRSORT | IGNOREVERTS | DONOTSPLIT)` (so the mesh already has an attribute table), gives a mesh without any material one default material; `Optimize(ATTRSORT)` sorts faces by attribute (stable) and, unless DONOTSPLIT,
gives each attribute group its own vertex range by duplicating shared vertices (so the per-subset bounding spheres see exactly the subset's vertices); `D3DXComputeBoundingSphere` is the centroid plus the
largest distance (not the minimal sphere); `D3DXIntersect` returns the closest hit with the barycentric weights of vertices 1 and 2.

**Frames, skinning, animation** (`d3dx-skin.ts`, `d3dx-animation.ts`, `tools/census-skin.ts`). What the engine's skinned-mesh path (`CKTDXDeviceXSkinMesh`, `LoadD3DXSkinnedMesh` 3296E760, L429311) asks of D3DX:
`D3DXLoadMeshHierarchyFromXInMemory(MANAGED, allocator)` -> frames, mesh containers, skin info, controller (its allocator's `CreateMeshContainer` 3296E0F0, L428910, treats a *non-NULL skin info with 0 bones as an error*, so
D3DX must pass NULL for a rigid mesh: the port does); `D3DXFrameFind` / `D3DXFrameCalculateBoundingSphere` / `D3DXFrameRegisterNamedMatrices`; `ID3DXSkinInfo::ConvertToIndexedBlendedMesh(options & 1 | 0x220,
palette = min(bones, 20), adjacency)` (`MultiAnimMC::ConvertToSkinnedMesh` 3296D8B0, L428466) followed by the engine's own clone to FVF 4380 (XYZB4 | LASTBETA_UBYTE4 | NORMAL | TEX1, 48 bytes) and `UpdateSemantics`; `CloneAnimationController` (the engine clones the loader's
controller with its own maxima: 2 tracks, 30 events) and `SetTrack*` / `KeyTrack*` / `AdvanceTime` (the cross-fade of `CKTDGXSkinAnim::ChangeAnim` 32976E60: old track `KeyTrackEnable(FALSE)` + speed / weight -> 0, new track speed 0
-> play speed, weight 0 -> 1, over `transitionTime`). All of it exists now and is exercised on real files.
* *Quaternion convention* (decided from data, not from a document): an X rotation key is stored `w, x, y, z`; the matching `D3DXQUATERNION` is **(-x, -y, -z, w)**. Of 323 key-0-versus-frame-matrix comparisons that carry
  information the file's value matched the frame's rest matrix 0 times as is and 237 times conjugated (86 neither: other poses); and end to end on `LENA_SI_A_LE_BACKJUMP_SHOT01.X` (data121.kom: 7 frames, 2 bones, 7 animations,
  0.367 s): after load and `AdvanceTime(0)` all 7 frame matrices equal their rest matrices (error < 1e-5), which also validates matrix keys (decomposed into S, R, T), the SRT composition `S * R * T` and the controller.
* *Controller*: defaults as D3DX documents (track priority LOW, weight 1, speed 1, position 0, disabled); per priority group a weighted sum of the enabled tracks (rotations sign-aligned and normalised, no weight
  normalisation), the two groups lerped by the priority blend; events (`KeyTrackSpeed / Weight / Position / Enable`, `KeyPriorityBlend`) run in segments from the value at their start, `LINEAR` or `EASEINEASEOUT` (smoothstep),
  the track position is the analytic integral of a speed ramp; a newer event of the same kind replaces a running one; 30 events at most (`Key*` returns handle 0 beyond that); `CloneAnimationController` keeps sets,
  tracks, events and time but not the registered outputs; keyframed sets: period = last key time, `LOOP` / `ONCE` / `PINGPONG`, linear key interpolation, slerp for rotations, clamped outside the key range, sets are `LOOP` with
  the file's `AnimTicksPerSecond` (4800 default).
* *Loader*: one container per X `Mesh` (container name = the mesh name or `""`), the skin info replicates the influences to vertices that the load split off (never needed in the data), the controller has 2 tracks, 30 events and
  one output per named frame; outputs of animations that target a frame the file lacks (483 in 42 files) are ignored. `D3DXFrameCalculateBoundingSphere` = centroid + largest distance of the world-space vertices (a guess).
* *`ConvertToIndexedBlendedMesh`* (own packing; D3DX's exact order of combinations is not reproduced and cannot be observed through the exe's use): faces are grouped by material and packed greedily into bone
  combinations whose bone set fits the palette (a face that needs more bones fails with `E_FAIL`); vertices are duplicated per combination, palette slots follow ascending bone index, weights are renormalised, FVF =
  `(source & ~0xE) | XYZB(m) | LASTBETA_UBYTE4` with `m` = the largest influence count, **limited to 4** (a vertex with more keeps its four strongest influences, renormalised; the UBYTE4 holds four indices), a vertex without
  influence is bound to slot 0 with weight 1 (an assumption), the attribute table has one range per combination (`DrawSubset(i)`), `BoneCombination.AttribId` = the material.
* *Census* (`./tools/gpu.sh bun run tools/census-skin.ts`, 3 min): 7,395 skinned files, 22,563 mesh containers of which 8,312 skinned (4.10 M skinned vertices, 4.10 M after conversion: only 1,680 vertices are duplicated across
  combinations, 8,048 meshes need exactly one bone combination, the most any needs is 6). **0 load failures, 0 unresolved bone names, 0 conversion failures at the engine's palette of min(bones, 20)** (the largest face
  influence count is 11, in two `MOTION_PET_RAINCOAT_CAT_*_STEB_3.X`). Bones per skin: 1 (893 meshes) ... 20 (1,308) ... 40+ (7). Max influences per vertex: 1 (1,402), 2 (5,931), 3 (888), 4 (67), 5 (22), 11 (2); **24 meshes
  have vertices with more than 4 influences** (566 vertices; the cash-shop `*_SORTED.X` parts and the cat raincoats) and lose the weakest ones; 76 vertices have no influence at all and 14 have a weight sum that is not 1
  (> 1e-3 off). Two files (`MESH_RAVEN_CASH_AC_FACE2_259120/259130_SORTED.X`) name two frames `Bone03`: with the breadth-first `D3DXFrameFind` the shallower one wins. Animation: 469 of the skinned files carry sets
  (the other 6,926 are equipment parts animated by another file's skeleton); of 11,083 animated frames 82.4 % are at their rest matrix at t = 0, the rest start in another pose.

**X scene census** (`tools/census-xscene.ts`, all 25,313 DirectX-format files through `loadXScene`; complements section 9): 0 errors; 107,183 meshes (12.05 M vertices, 10.49 M faces, **0 polygons**),
1,982,092 frames, 14,151 files with several meshes, 7,395 skinned files (8,312 skinned meshes, 78,639 bones - every bone name resolves to a frame of the same file, all weight vertex indices in range),
every face / normal-face / texture-coordinate / material index in range, 63 meshes without texture coordinates, 1 with vertex colours, 77,305 duplicate frame names (the first one in breadth-first order wins in
`D3DXFrameFind`), no Frame with a `{ Mesh }` / `{ Frame }` reference or with two `FrameTransformMatrix`, 9 files with several top-level frames / meshes (they get the synthetic root), 810,120 frames with a non-unit 3x3 part, up to 113 materials and 26,900 vertices per mesh. Animation: 6,856 sets, 108,944 animations (75,014 with separate rotation / scale / position keys,
33,930 with 4x4 matrix keys; key times sorted in all), `AnimTicksPerSecond` is 4800 wherever present (the D3DX default 4800 otherwise). **483 animations in 42 files target a frame that does not exist in
the file** (3ds Max leftovers such as `Object274`, `Cylinder01`, `COLLISION1`); a D3DX controller ignores outputs it has no registered matrix for, so the loader keeps them and the controller must skip them.

### 12.5 Assumptions and choices that need a reference (the layer cannot check these against real D3D9 / D3DX)

1. Fixed-function texture coordinates: a 2D coordinate fills (u, v, 1, 0) before a texture transform; a 2D transform takes its translation from `_31` / `_32`; `D3DFVF_TEXCOORDSIZE3(0)` = `1 << 16`.
2. `D3DRS_DEPTHBIAS` -> `round(bias * 2^24)` (D3D9 scales by the depth format's resolution); `SLOPESCALEDEPTHBIAS` is passed through.
3. A texture stage that needs a texture which is not bound ends the cascade (the previous stage's result is the output); stage 0 with MODULATE and no texture outputs the diffuse colour.
4. Without a vertex COLOR1 / COLOR2 the colour sources fall back to the MATERIAL; pre-transformed fog takes its factor from the specular alpha.
5. D3DX math is evaluated in double precision with `Math.fround` at the places where the SSE code stores a float; the last bit can differ from the real library.
6. TGA: a 24 bpp file reports R8G8B8 (like a 24 bpp BMP; the exe itself tests `imgInfo.Format == D3DFMT_R8G8B8` to pick DXT1 at low detail), a 32 bpp file A8R8G8B8 whatever the descriptor's alpha
   bits say (757 files have descriptor alpha bits 0; 729 of them carry a real alpha channel, 26 are opaque, 2 are alpha 0 everywhere; section 8), a 16 bpp file honours the alpha bit (24 files then decode alpha 0).
7. `GetDeviceCaps`: a Shader Model 3.0 HAL device (VS 0xFFFE0300, PS 0xFFFF0300, textures up to 8192, `MaxPrimitiveCount` 0xFFFFF, `MaxVertexShaderConst` 256, hardware T&L,
   `PresentationIntervals` 0x8000000F); the exe reads only the fields listed in 12.1.
8. D3DX meshes: the merge / split / weld / optimize rules of 12.4; `WeldVertices` is not restricted by adjacency (D3DX welds only overlapping vertices of adjacent faces unless WELDALL is set - the same result
   for exact duplicates of a closed mesh); the cache-optimising face order of `D3DXMESHOPT_VERTEXCACHE` is not reproduced (vertices are renumbered by first use, faces keep their order), so face / vertex
   *indices* after `Optimize` can differ from the real library while the subsets, ranges and bounding spheres do not; normals are renormalised after the frame transform; `FVFData` (72 `UI_AD_*` meshes)
   is ignored; `CloneMeshFVF` zero-fills components the source lacks (the exe overwrites the colour itself); a mesh without `MeshMaterialList` is not in the data (all 107,183 have one).
9. `DrawSubset` on a mesh that has no attribute table draws contiguous runs of the attribute (D3DX does the same lazily); with a table it draws each entry with its vertex range.
10. Animation / skin (no D3DX oracle except the loader structure and `D3DXFrameFind` / `UpdateSkinnedMesh` / skin-info creation rules of 12.3): the controller maths of 12.4 (event segments, smoothstep for `EASEINEASEOUT`,
    blending, the 30-event limit and handle 0), slerp / lerp key sampling, clamping outside the key range, `D3DXFrameCalculateBoundingSphere`, the bone-combination packing and the choice of slot 0 for an
    influence-less vertex, keeping the four strongest of more than four influences. The quaternion sign is data-derived (12.4) and checked on one real file end to end.
11. A mesh with vertex colours that lists only some vertices: the unlisted ones are white with alpha 1 here (the reader fills 1,1,1,1) whereas Wine's loader writes `0x00ffffff` (alpha 0); one mesh in the data has vertex
    colours and the question is untested. Several `FrameTransformMatrix` in one frame: the last replaces the earlier ones in the hierarchy loader (native-checked) but `D3DXLoadMeshFromX` accumulates them (Wine's
    test, not implemented; the data has none).
12. `XRenderer.fx` / `ID3DXEffect` (12.7; no D3DX, no fxc): the numbering of the constant registers (invisible outside the effect); that `CommitChanges` re-evaluates only the assignments that depend on a parameter
    changed since and uploads only the changed register groups (all of them after a shader change); that the assignments of a pass are applied in source order and an unassigned state keeps the device's value;
    `FogColor = (float4)` -> DWORD by round to nearest; `SetMatrix` on an array parameter fails (the exe uses `SetMatrixArray`); `SetInt` into a float parameter converts; a shader index outside the array is
    `D3DERR_INVALIDCALL` (the exe never does it). The shader bodies were ported from the HLSL text statement by statement; fxc may evaluate the same expressions in another order (MAD, different `rsq` / `normalize` rounding),
    so the last float bit of an interpolant can differ from the real thing. A zero normal in `normalize` is NaN in WGSL and `rsq(0) = +inf` times 0 in `vs_1_1` - also NaN, but not tested.

### 12.6 Not emulated / todo

Reported once through the device's `warn`: wireframe / point fill, point sprites, clip planes, border and mirror-once addressing (clamp is used), dual-source blending, bump mapping,
multiple render targets, multisampling, float textures other than as render targets. Not implemented at all: `GetRenderTargetData` / `CreateOffscreenPlainSurface` (DXUT cursor and screenshots only),
JPEG textures, DXT compression, `CreateCompressedAnimationSet` (the exe's KSM path uses keyframed sets), `D3DXCreateLine`. `ID3DXEffect` exists only as far as `XRenderer.fx` needs it (12.7): no `CreateVertexShader`
from byte code (a shader is WGSL), no pixel shaders (the exe has none), no other effect file (`GCSkin.fx`, `RenderState.fx`, `XPosteffect.fx` are never referenced), no annotations / `CloneEffect` / `ValidateTechnique`.
Table fog together with a vertex shader needs the view depth of the vertex, which a shader does not provide: reported once through `warn` and not applied. Also open: the
reference pictures. The layer was developed without any screenshot of the real client; a few frames of the loading screen, the character select and a field would let the
assumptions above (and the sampling / filtering details) be checked pixel for pixel.

### 12.7 XRenderer.fx: the effect emulation (`effect.ts`, `xrenderer-shaders.ts`, `vshader.ts`)

The exe loads exactly one effect, `XRenderer.fx` (data041.kom, 1,555 lines of HLSL, 12.1), as *source* and lets D3DX compile it at start-up. Here there is no D3DX, no byte code and no
compiler, so the effect is emulated at the level the exe can observe and nothing more:

* **The file is read, not copied.** `parseEffect` tokenises the shipped text (comments, `#define` / `#ifdef`, parameters with semantics and initialisers, `VertexShader name[N] = { compile vs_1_1 Entry(arg), ... }`,
  techniques, passes, and every state assignment with the right-hand sides the file uses: enumerators, integer literals, `(parameter)`, `(array[parameter])`). Parameters, techniques, passes and states therefore come from
  the file: 19 parameters, 19 techniques (the file's order differs from the engine's table, which is irrelevant: both sides use names), 12 shader arrays with 80 entries.
* **Only the shader bodies are ported by hand.** The 34 HLSL functions (`VS_Skin`, `VS_Fog` and 32 entry points) exist as WGSL in `xrenderer-shaders.ts`, chosen by entry-point name and the `iNumBones` argument. So that the port never runs
  with a meaning it was not written from, the parser hashes the tokens of every function (FNV-1a, `XR_FUNCTION_HASHES`); a file with another body, an unknown entry point / state / enumerator, an undefined function or a
  truncated file is refused with `D3DXERR_INVALIDDATA` and a message in `errors`. Comments, white space and layout do not matter (tested).
* **The device got a programmable vertex stage** (`vshader.ts`; `CreateEmulatedVertexShader`, `SetVertexShader`, `SetVertexShaderConstantF` with 256 float4 registers, and the getters). With a shader set, the fixed-function transform,
  lighting, texture-coordinate generation / transforms and `TEXCOORDINDEX` are ignored (they belong to the fixed-function *vertex* stage); the viewport transform and the half-pixel offset still apply to what the shader writes;
  stage `i` of the (still fixed-function) pixel cascade reads `oT[i]`; `oD0` / `oD1` are saturated like `vs_1_1` does; fog comes from `oFog` when `FOGENABLE` is set, `FOGTABLEMODE` is NONE, `FOGVERTEXMODE` is not NONE and the shader writes it.
  Inputs are by semantic (a missing one reads (0, 0, 0, 1)); a `D3DCOLOR` element arrives as (r, g, b, a) so that `D3DCOLORtoUBYTE4(v) = v.zyxw * 255.001953` gives the bone indices stored in bytes 0..3. `Reset` clears shader and registers.

**Register layout** (this port's; a real compile numbers the registers per shader and nothing outside the effect sees them). Matrices are stored as D3D stores them (register k of a matrix = row k) and used as `v * M`:
`c0-c79` `g_amWorldPalette[20]`, `c80-83` `g_mWorldViewProj`, `c84-87` `g_mViewProj`, `c88` `g_Color`, `c89` `g_LightPos`, `c90` `g_OutLineColor`, `c91` `g_LightFlowPoint`, `c92` `g_TexOffSet01`, `c93` `g_fFog`,
`c94` `g_fEye`, `c95` (`g_fTexOffSet2X`, `g_fTexOffSet2Y`, `g_fOutLineWide`, `g_fLightFlowImpact`), `c96` (`g_fLightFlowWide`, `g_fDensity`, 0, 0). A shader uploads only the groups it reads.

**What the shaders compute** (from the HLSL; the semantics that are easy to get wrong are tested against CPU models):
`VS_Skin` takes the indices from `(int[4]) D3DCOLORtoUBYTE4(BlendIndices)`; 1 bone ignores the weights, 2 and 3 bones use `w0, w1 (, w2)` as stored and do **not** renormalise, 4 bones use `w0, w1, w2` and `1 - w0 - w1 - w2`
for the last. `mul(float3 normal, float4x4)` is HLSL's implicit truncation to float3x4: the normal is rotated and never translated (the 4th lane is `n . column 3`, 0 for affine matrices), but `dot(vNor, g_LightPos)` and
`normalize` run over all four lanes. Rigid `RealColor` / `Cartoon` use `g_mWorldViewProj` for the position and `palette[0]` for fog / normals; every skinned shader and the edge / world-flow shaders go through `g_mViewProj`;
the *local* flow shaders measure the stored position, the *world* ones the transformed position. Cartoon: `Tex1 = (d, d)` with `d = dot(normalize(n'), g_LightPos)` and no offset on stage 1; the edge shaders push the position
out along the *unnormalised* transformed normal by `g_fOutLineWide`. `VS_Fog` = `max(x + length(wPos - g_fEye) * y, z + wPos.y * w) - g_fDensity` with a 4-component `length`. Light flow:
`Diffuse.a = g_Color.a / (0.00001 + distance / g_fLightFlowWide)` with `abs(coordinate - g_fLightFlowImpact)` or the 4-component `distance` to `g_LightFlowPoint`.

**The techniques** (assignments are applied in file order through the state manager):

| technique | passes | shader array | what the passes set |
|---|---|---|---|
| `REAL_COLOR` | 1 | RealColor | stage 0 Modulate(Texture, Diffuse) for colour and alpha, stages 1 / 2 pass the colour on; fog states |
| `CARTOON`, `ADD_CARTOON` | 1 | Cartoon | stage 0 as above; stage 1 Modulate / Add (Current, Texture), `AddressU[1] = Clamp`: the ramp texture is read at (d, d) |
| `CARTOON_BLACK_EDGE`, `ADD_CARTOON_BLACK_EDGE` | 2 | Cartoon, BlackEdge | p1: `TextureFactor = 0xff000000`, stage 0 = TFACTOR, stages 1 / 2 disabled, `CullMode = CW` (the back faces are the outline) |
| `CARTOON_COLOR_EDGE`, `ADD_CARTOON_COLOR_EDGE` | 2 | Cartoon, ColorEdge | p1: the same with Diffuse = `g_OutLineColor` |
| `BLACK_EDGE`, `COLOR_EDGE` | 1 | BlackEdge, ColorEdge | the outline pass alone |
| `LIGHT_FLOW_{WORLD,LOCAL}_{X,Y,Z,POINT}` | 1 | {X,Y,Z,Point}Flow{World,Local} | alpha blend SRCALPHA / DESTALPHA, `AlphaOp[0] = Add(Current, Diffuse)`, `ColorArg1[0] = Diffuse`; no fog states |
| `CARTOON_FADE`, `CARTOON_FADE_NONTEX` | 1 | RealColor | `ColorOp[0] = BLENDDIFFUSEALPHA(Texture, Diffuse)` / `SelectArg1 Diffuse`, `AlphaOp[0] = Disable` |

**How the engine drives it** (x2.exe.c): `CKTDGXRenderer::OnResetDevice` (329749E0, L434486) calls `D3DXCreateEffect(dev, data, size, 0, 0, 2048 = D3DXFX_NOT_CLONEABLE, 0, &eff, 0)`, `SetStateManager(g_pEffectStateManager)`,
`GetTechniqueByName` x19, `GetParameterByName` x19, `SetTechnique(REAL_COLOR)`, `SetInt(g_iShaderIndex, 0)`, `SetVector(g_Color, 0)` and loads the ten `Cartoon*.bmp` ramps. `BeginRender` (L432699): `Begin(&n, 7)`
(7 = `D3DXFX_DONOTSAVESTATE | DONOTSAVESHADERSTATE | DONOTSAVESAMPLERSTATE`, from the D3DX headers), `_CommitChanges`, `BeginPass(0)`; draws; `EndPass`, `BeginPass(1)` ..., `End`. `_CommitChanges` (L434781):
the shader index is `min(bones, 4)`, plus 5 when fog is on and the technique is not a light flow; `SetInt(g_iShaderIndex)` when it changed; inside a pass `effect->CommitChanges()` and then the manager's dirty constant range is flushed to the device
(`CKTDGEffectStateManager`, a clone of the DXSDK `CStateManager` with a 512-entry state stack and a shadow constant array). The port keeps that division: a state manager is an object with five methods
(`ID3DXEffectStateManager`; `DeviceStateManager` forwards them to the device, tests use recorders), and without one the effect writes to the device and puts back what it changed at `End` according to the Begin flags
(three independent bits, tested).

**Verification** (`packages/d3d9/test/xrenderer.test.ts`, 40 tests, expectations computed from the HLSL on the CPU): the parsed file (names the exe asks for, pass counts, every function hashed) and its refusals; the recorded
state assignments of `REAL_COLOR`, the edge techniques and all flow techniques; `CommitChanges` sending only what depends on a changed parameter; the call protocol; save / restore without a manager; **every one of the 80
shaders compiles and draws**; texture coordinates and offsets of the three stages; `g_Color`, alpha and the `g_mWorldViewProj` position; the cartoon ramp (normalisation, no translation of normals, clamping); fade; edge hulls
(extent, colour, winding under `CullMode = CW`); skinning with 1-4 bones, D3DCOLOR indices out of a decoy-filled palette, with and without fog, and the blended normal; fog (constant, distance with a 4-component `length`,
height, clamping); the eight light-flow families rigid and two skinned; and the device hook itself (constants per draw, bounds, default inputs, saturation, `oT` routing, bypass of the fixed-function stage, `oFog` rules,
a broken shader reported through `takeErrorsAsync`). Mutating the shaders (bone-index swizzle, a missing `normalize`, a translated normal, a dropped last weight, `length(xpos.xyz)`, a wrong flow register) makes tests fail.
What this cannot show: that fxc's code gives the same last bits, and that D3DX's effect framework behaves as assumed in 12.5 item 12 (no oracle).

**Not ported**: the engine classes around it - `CKTDGXRenderer` (render types, `SetColor`, `SetRenderPassFog`, the shader-index rule, the draw paths) and `CKTDGEffectStateManager` (state stack over `CKTDGStateManager`); the
index rule is replicated only inside the test (`shaderIndex`). They are ordinary engine code over this layer and belong with the engine classes of the later phases.

### 12.8 Test infrastructure

Dawn (the `webgpu` npm package, prebuilt `dawn.node`) needs a Vulkan loader and driver; the sandbox has neither a GPU nor a browser, so `tools/setup-gpu.sh` extracts SwiftShader (`libvk_swiftshader.so`,
`vk_swiftshader_icd.json`, `libvulkan.so.1`) from the `@sparticuz/chromium` npm package into `/home/user/work/swsh/sw` and `tools/gpu.sh` runs a command with
`VK_ICD_FILENAMES` / `LD_LIBRARY_PATH` set (they must be in the environment before the process starts; a missing ICD file gives a null adapter). Dawn hands each adapter out once, so every test device
gets a fresh adapter. SwiftShader supports BC textures and 8192-pixel 2D textures; uncaptured validation errors arrive asynchronously (`await dev.takeErrorsAsync()` in the tests).

## 13. MPEG-1 movies and the Bandi video library (Phase 2)

### 13.1 What the exe does

The only video in the client is `CKTDGUIControl::CMovieData` (ctor L367000, `OnFrameMove` L368330, `OnFrameRender` L368562, `SetMovieFileName`
L368902 / `_LUA` L368955, object size 0x78). There is no DirectShow, MCI or Media Foundation anywhere in x2.exe.c: playback goes through the
closed Bandisoft library `bdvid32.dll` (`data/bdvid32.dll`, loose next to the exe) wrapped by `CBandiVideoLibrary` (L445180..) and
`CBandiVideoTexture_DX9` (L445440..):

* `Create(L"bdvid32.dll")`, `Verify("KOG_ELSWORD_20131203", "1b9b533c")` (licence id / key), path = working directory + `\movie\` + name, then
  `Open`, `GetVideoInfo` (-> texture size), `Play`; the texture wrapper `Open(w, h)` creates a D3D9 texture (`CalcTexSize` rounds to a power
  of two when asked).
* `OnFrameMove`: `GetStatus == BVL_STATUS_PLAYEND` -> `Seek(0)`, then `Play` when looping else `Stop`; `IsNextFrame` -> lock the texture and
  `GetFrame(buffer, pitch, pixel_format = texture format)`. So the library does the colour conversion into the caller's format, and the
  frame clock (24 fps wall-clock) is the library's.
* `OnFrameRender`: clear a render-target texture, `m_pBvt->Draw(0, 0, size)`, then draw that target at `pos / m_ResolutionScale`.
* Lua surface: `CMovieData` (`SetLoop`, `SetMovieFileName_LUA`, `SetRect_LUA` ...), `CKTDGUIDialog::CreateMovie`,
  `CKTDGUIStatic::AddMovieData_LUA` / `GetMovie`; `CX2StateServerSelect::ProcessIntroMovieEnd` (L15553) looks related, link not verified.

Data: exactly 30 loose files `data/movie/movie_create_<character>_<class>.avi` (47 MB); no video inside any of the 173 KOMs
(`find_movies` over all entries). Each is a RIFF AVI with one `vids` stream, handler `MPG1`, BITMAPINFOHEADER 400 x 220 24 bpp, a `JUNK`
chunk after `strf`, `avih` 41,666 us per frame (24 fps), an `idx1` whose key-frame flags equal the I pictures, and a `movi` list of only
`00dc` chunks: one picture each, no audio. Content: 459..734 pictures per file, **18,514 in total = 999 I + 17,515 P**; no B and no D
pictures, default quantiser matrices, **one slice per picture covering all 14 macroblock rows** (the encoder never restarts a slice), a constant
quantiser inside each picture (no `macroblock_quant`), no 16 bit escape levels, vectors up to `f_code` 7 and always inside the picture,
`constrained_parameters_flag` 0, variable bit rate (0x3ffff), `vbv_buffer_size` 9, `pel_aspect_ratio` code 14 (1.2015; the engine draws the
400 x 220 texture into the rectangle Lua gives, so the code is not used). Over the 30 files: 6.48 M macroblocks, of which 4.96 M coded
(1.12 M intra, 3.27 M with a forward vector, 0.57 M pattern only) and 1.52 M skipped, 163,351 escape levels, 2,646 `macroblock_escape` codes.

### 13.2 The decoder (`packages/assets/src/mpeg1.ts`, `mpeg1-tables.ts`, `avi.ts`, `movie.ts`)

There is no decoder code to port, so this is a decoder of ISO/IEC 11172-2 written from the standard: I, P and B pictures (the movies only use
I and P), slices that start anywhere in a row and span rows, skipped macroblocks (P: zero vector; B: repeat of the previous prediction and
vectors), custom quantiser matrices, full-pel vectors, picture re-ordering (an I / P reference is held back until the next one arrives),
sizes that are not a multiple of 16 (the planes cover whole macroblocks, `width` / `height` are the visible size; `visiblePlanes` crops).
D pictures (DC-only) are rejected with `Mpeg1Error`. `Mpeg1Decoder.decode(bytes)` takes whole pictures (an AVI chunk, or a whole elementary
stream: it finds the pictures itself); `splitPictures` cuts an elementary stream into one-picture pieces.

* `avi.ts`: RIFF walker (nested `LIST`s, `rec ` lists, odd chunk sizes padded to even offsets, `avih` / `strh` / `strf`, key frames from
  `idx1`). `movie.ts`: `Mpeg1Movie.open(bytes)` -> `info` (size, frame count, rate 24/1, duration), sequential `next()` and random access
  `frame(i)` / `seek(i)` (restarts at the nearest I picture with a sequence header, or at 0 when the stream has B pictures).
* Choices the standard leaves open, which matter for the last bit: the IDCT is the 16 bit integer "simple" IDCT (`W1..W7` = 22725 21407
  19266 16383 12873 8867 4520, row shift 11, column shift 20, DC shortcut) because that is what libavcodec uses, and the pictures can then be
  compared sample for sample; blocks are `Int16Array` so out-of-range intermediate values wrap like the C code. Chroma vectors are the luma
  vector / 2 truncated toward zero (full-pel vectors are doubled first). Mismatch control: every non-zero dequantised coefficient is made
  odd (`(v - 1) | 1` only for non-zero values: libavcodec applies it to a 0 as well, which differs when `(2|level|+1) * qscale * matrix < 16`, i.e.
  matrices with entries below 6; no shipped stream and no fixture has such a matrix), clamp +-2048.
* Vectors that point outside the coded picture (the standard forbids them) read replicated edge samples; libavcodec instead skips the
  prediction ("MPEG motion vector out of boundary"), so there is no oracle for that case.
* Colour: `yuv420ToBgra` is ITU-R BT.601 limited range with chroma replicated. **This is an assumption**: what `bdvid32.dll` does inside
  `GetFrame` (matrix, range, chroma upsampling filter, dithering, gamma) is not visible in the decompile. The decoded YUV is exact; the RGB
  of the original may differ by a few levels.
* The 400 x 220 pictures are decoded as 25 x 14 macroblocks (400 x 224); the bottom 4 rows are cropped. Speed: about 800 pictures per
  second per core (`bun`), i.e. 30 files in 22 s including hashing, far faster than the 24 fps the movies need.

### 13.3 Verification

The oracle is FFmpeg's libavcodec through PyAV (`pip install --target /home/user/work/pyav av numpy`; the `av` 18.1.0 manylinux wheel bundles
FFmpeg, decoder and encoder), `tools/oracle-mpeg1.py`: CRC-32 per plane and picture, optional raw I420 dump. libavcodec's default IDCT on x86
and `idct=simple` give the same pictures on the movies (checked), so the default build is a fair reference.

| Check | Result |
|---|---|
| `tools/verify-mpeg1.ts` over all 30 movies (against the recorded hashes, or `--hashes` a fresh FFmpeg run) | **18,514 of 18,514 pictures identical** (Y, Cb, Cr of the visible area), 0 files differ; the first run of the decoder on the first file was already exact |
| `packages/assets/test/fixtures/mpeg1` (`tools/gen-mpeg1-fixtures.py`, 9 streams made with FFmpeg's encoder, 80 KB; the hashes of the 30 movies are recorded in `movies.json` + `movies.bin`, 240 KB, so `verify-mpeg1.ts` and the tests need no FFmpeg) | all identical: B pictures (forward / backward / bidirectional macroblocks, skipped B macroblocks, display re-ordering), a 50 x 34 picture, large vectors (f_code 3), per-macroblock quantiser changes, 16 bit escape levels, address increments above 33 (`macroblock_escape`), full-pel vectors, custom matrices (loaded by rewriting the sequence headers: the encoder of this build ignores the `intra_matrix` / `inter_matrix` options) |
| hand made streams in the test | slices that start inside a row (the first address increment is relative to the row start), macroblock stuffing, intra macroblocks resetting the vector predictors in P and in B pictures, slices below the picture, D pictures / orphan pictures / P without reference |
| `inverseDct` against the exact floating point IDCT | peak error 1, mean square error 0.01 (IEEE 1180 allows 0.06) |
| random damage (300 corrupted / truncated copies of a stream) | only `Mpeg1Error` is ever thrown, no hang |
| mutation check (`python3 tools/mutate-mpeg1.py`, 40 mutants of the decoder and the tables: oddification, shifts, rounding of the half-pel / bidirectional averages, chroma vector rounding, predictor resets, address escape, escapes, zigzag, table entries, reference order) | all 40 killed (the clamp 2047 -> 1023 mutant is caught by the real movies only; the synthetic streams cannot see it because a single huge coefficient saturates anyway) |

The oracle does not cover: the colour conversion, the timing of the Bandi player, vectors outside the picture, the tiny-matrix corner above, D
pictures, streams with more than one `sequence_header` change of size. The pictures of an I/P-only movie do not depend on any of these.

### 13.4 Reproducing

```sh
./node_modules/.bin/bun run tools/verify-mpeg1.ts                                # the 30 movies against the recorded FFmpeg hashes, ~22 s, no FFmpeg needed
pip install --target /home/user/work/pyav av numpy
export PYTHONPATH=/home/user/work/pyav
python3 tools/oracle-mpeg1.py --out /tmp/oracle.json data/movie/*.avi          # a fresh FFmpeg run; --dump DIR adds raw I420 (2.3 GB for all 30), --pack PREFIX re-records movies.*
./node_modules/.bin/bun run tools/verify-mpeg1.ts --hashes /tmp/oracle.json      # against that run
python3 tools/gen-mpeg1-fixtures.py                                              # regenerates the synthetic streams in packages/assets/test/fixtures/mpeg1
gh api -H "Accept: application/vnd.github.raw" repos/FFmpeg/FFmpeg/contents/libavcodec/mpeg12data.c > /home/user/work/scratch/ff/mpeg12data.c
python3 tools/gen-mpeg1-tables.py                                                # regenerates mpeg1-tables.ts (byte identical)
```

### 13.5 What is left for the engine (Phase 4)

A Bandi-like movie player for `CMovieData`: `Open` / `GetVideoInfo` / `Play` / `Stop` / `Pause` / `Seek` / `GetStatus` (`PLAYEND`) /
`IsNextFrame` / `GetFrame` with a 24 fps wall-clock over `Mpeg1Movie`, uploading `yuv420ToBgra` rows (or a YUV -> RGB shader) into the
`CBandiVideoTexture_DX9` texture of the D3D9 layer. The 30 movies have no audio track, so `SetVolume` is a no-op.

## 14. The file layer: mass files, loose files, the web client's VFS

### 14.1 What the exe does (x2.exe.c)

* `CX2Main::CX2Main` (L527960-528130, L528545-528600) builds `m_KOMList` = `datai001` .. `datai023`, then `data001` .. `data150` (173 names) and calls
  `KGCMassFileManager::AddMassFile(&m_pDeviceManager->m_MassFileManager, "./" + name, &bDup)` for each, then `LockMassFileMap`; `MassFileMapping` follows
  later (L301729). It also registers `CKTDXDeviceManager::AddHighTexName(L"DLG_")` / `(L"HQ_")` and runs `DeleteOtherFile(L"KOM", &m_KOMList, ...)`, an
  integrity clean-up that removes KOM files that are not on the list.
* `AddMassFile` (L299222) inserts every member into `m_mapMassFile` (`SMassFileIndex { pMassFile, Index }`, names compared case-insensitively). A duplicate
  name logs `<kom>(<name>) is duplicated`, shows a message box, deletes the archive and makes the caller crash on purpose. After the lock the call logs an
  error and returns null.
* `LoadDataFile` (L300437; narrow-string wrapper L300377) upper-cases the whole name with `_towupper` and looks it up; a miss logs error 0x87 with the name and
  returns an empty result. There is **no loose-file fallback** in it: `LoadDataFile_LocalFile` (L300558) is a separate entry that callers choose.

### 14.2 What the data contains

* 173 archives, 97,891 members, **0 duplicate names** (case-insensitive), so the "duplicated" path never fires with this client. All headers open in about 0.9 s from
  disk (Bun) and about 1.4 s over HTTP Range requests (headless Chromium, 12 in flight).
* Some loose files of `data/` are also archive members (the fonts `dft_p7.ttc` / `msjh*.ttf`, the HK / TW loading screens `dlg_first_loading*_hk.tga`,
  `dlg_new_unit_background*`), others are loose only: the `*_event.tga` / `*_spare_*.tga` loading screens, `dlg_sever_select_background01-03.tga`, `dlg_ui_ad_*.tga`,
  `general.ess`, `2002lkog.ttf`, `h2hdrm.ttf`, `TutorSystem.lua`, `arrow.x`, `x2.fx`; `data/movie` (30 AVI) and `data/ui` are loose only, `data/music` has 135 `.ogg`
  (one also in an archive). Same name does not always mean same content (`dlg_ui_ad.tga`: 1,048,620 bytes in `data068.kom`, 786,476 loose). Which copy wins is decided by the
  caller (`LoadDataFile` vs `LoadDataFile_LocalFile`), so it has to be settled when the loading-screen code is ported.

### 14.3 Implementation

`@els/kom`: `MassFileManager` (`addMassFile` / `addArchive` / `lock` / `find` / `has` / `loadDataFile` / `names`, the duplicate and lock rules above, upper-case lookup),
`CLIENT_KOM_NAMES` (the 173 names in the exe's order) and `mountClientArchives(manager, open, { names, concurrency, onMissing, onProgress })`
(`packages/kom/src/massfile.ts`, `packages/kom/test/massfile.test.ts`, 6 tests). The web client opens the archives through `httpSource("/data/<name>")`; the server (`apps/server`)
answers `Range` and `HEAD` and serves only the asset types the client can use (not `x2.exe`, the decompile or the DLLs).

## 15. The web client, the browser test harness and the first engine lists

### 15.1 Headless Chromium with WebGPU (`tools/setup-browser.sh`, `tools/browser.mjs`)

`@sparticuz/chromium` 153.0.0 ships a complete headless Chromium (plus the Amazon Linux 2023 libraries, fonts and SwiftShader); `puppeteer-core` 25.16.0 drives it.
`setup-browser.sh` installs both into `/home/user/work/browser` and unpacks the browser to `/tmp/chromium` (it sets `AWS_EXECUTION_ENV`, otherwise the package does not unpack the libraries);
`browser.mjs` opens a URL, forwards console messages, waits for an expression, evaluates expressions, takes a screenshot and exits 1 on a page error, a failed request or a timeout.
Things that cost time:

* `navigator.gpu` exists only in secure contexts: `http://127.0.0.1` or `localhost`, not `data:` / `about:blank`.
* **`--use-vulkan=swiftshader` is required** (together with `--enable-unsafe-webgpu --enable-unsafe-swiftshader --use-angle=swiftshader`). Without it the GPU process cannot create its own
  Vulkan instance (`vkCreateInstance() failed: -9`), has no shared-image backing for a WebGPU swap chain (`Could not find SharedImageBackingFactory ... WebgpuSwapChainTexture`)
  and **destroys the device the first time a canvas is presented to** ("Device was destroyed"); every later `mapAsync` then fails with `A valid external Instance reference no
  longer exists`. Compute-only WebGPU works either way, which is why the first probes looked fine.
* `HEAD` requests and aborted `blob:` fetches of media elements show up as `net::ERR_ABORTED` and are not failures; `console.error` counts as one (uncaptured WebGPU errors arrive there).
* `ELS_BROWSER_DUMPIO=1` prints the browser's stderr, `ELS_BROWSER_FLAGS` adds flags.

### 15.2 The client (`apps/client`) and the server (`apps/server`)

`bun run apps/server/src/main.ts [--port 8080]` serves `/` (apps/client/index.html), `/client.js` (a `Bun.build` of `apps/client/src/main.ts`, rebuilt when a source file of the client or
of a package changed; about 370 KB with the Lua, assets and D3D9 packages), `/data/*` (Range, allow-list of extensions, no `..`) and `/api/files` (the loose files).
The page is an **asset viewer**: all 97,891 archive members and the 208 loose files in a filterable list, a preview per type:

| type | preview |
|---|---|
| tga / dds / bmp / png / jpg | `decodeImage` of `@els/assets` into a 2D canvas (JPEG through `createImageBitmap`) |
| avi | `Mpeg1Movie` at 24 fps on a 2D canvas, pause / seek |
| ogg / wav | `<audio>` (the browser decodes) |
| x / y | `D3DXLoadMeshHierarchyFromXInMemory` + the exe's frame lists (§15.3) + textures from the archives + the animation controller + CPU skinning, drawn by the D3D9 layer on a WebGPU canvas (orbit, zoom, animation set, speed) |
| xet / tet | the parsers of `@els/assets`, as JSON |
| lua | LuaJIT bytecode listing (`@els/lua` `disassemble`) |
| others | text (BOM aware) or hex dump |

The D3D9 layer presents with `copyTextureToTexture` from its back buffer (1024x768, the client's base resolution) into the canvas texture; the format is the canvas's preferred one
(`?format=rgba8unorm|bgra8unorm` forces it; desktop browsers prefer `bgra8unorm`, this headless one `rgba8unorm`). Files that are not DirectX X (the KSM / KAC / KME formats) fall back to the
hex view with a note: **rendering them (the playable characters, `Mesh_*_Base_SD.x` + `Motion_*.x`) is not done yet**.

### 15.3 `CKTDXDeviceXSkinMesh::XSkinMeshProxy`: which frames are drawn

`LoadD3DXSkinnedMesh` (L429311) runs: `D3DXLoadMeshHierarchyFromXInMemory` with options 544 (= `D3DXMESH_MANAGED`) and the exe's allocator; `SetupFrameList` (L430693: the frame, then its
sibling chain, then its first child; fails above 255 frames, logs 0xD4 for a frame with more than one mesh container); per skinned container `D3DXFrameFind` for every bone name; `D3DXFrameCalculateBoundingSphere`;
`SetupDrawFrameList` (L430592); `EstimateDrawFrameWorkingPaletteSizeAndBoneNum`; `ComputeCollisionData` (L428384); `OptimizeDrawFrameMesh`; `ConvertDrawFrameToSkinnedMesh`; `ReleaseUnusedInfo`.
The model files carry helper frames whose meshes are boxes or spheres for the collision code: `ATTACK_LINE_START0_Sword` / `ATTACK_LINE_END0` (the wooden practice sword has two 18.9-unit boxes),
`ATTACK_SPHERE*`, `COLLISION*`, `Bip01_Footsteps*`. **`SetupDrawFrameList` leaves out every frame with a mesh container whose name starts with `COLLISION` (9 bytes), `ATTACK` (6 bytes) or `Bip01_Footsteps`
(15 bytes), case sensitive, and does not visit the children of such a frame at all** (also when it has no mesh); `ComputeCollisionData` feeds the COLLISION* / ATTACK* frames to `AddCollisionData` (L427598).
Ported as `setupFrameList`, `setupDrawFrameList`, `collisionFrames` in `packages/engine/src/skinmesh-frames.ts` (10 tests, one on the real sword: 7 frames, draw list `Elsword_Basic_Weapon`, collision frames
`ATTACK_LINE_END0` and `ATTACK_LINE_START0_Sword`). The viewer draws exactly that list; before, it drew the two boxes next to the sword.

What the data looks like: the body parts of the playable characters are X files with the 68-bone skeleton and one skinned mesh and **no animation sets** (`Mesh_ElSword_JP_Upbody09_Sorted.X`); their motions live in KAC files
(`Motion_Elsword.x`, not X). Pets, NPCs and effect models (`Motion_PET_*_STEB_*.X`, 25 animation sets, 2-4 skinned meshes) are complete X files and animate in the viewer.

### 15.4 Verification (`bun run tools/browser-test.ts [--shots dir]`, 18 checks, about 17 s)

It starts the server in the process, loads the page in headless Chromium and checks: 173 archives / 97,891 members mounted over Range requests with none missing; the TGA `dlg_first_loading0_hk.tga` pixel-identical to the
Bun decode; picture 13 of `movie_create_aisha_base.avi` pixel-identical to the Bun decode; the wooden sword draws one container and lights pixels; `Motion_PET_SONOGONG_STEB_1.X` (56 frames, 7 drawn containers, 2 skinned, 25 sets, 3 textures) draws,
changes with the animation time and switches animation sets; the Lua listing, `general.ess`, an XET and a TET, an `.ogg` (browser-decoded, 109.7 s) and the KSM fallback; **the sword and the animated pet are pixel-identical with an RGBA and a BGRA back buffer**;
no console error, exception, failed request or HTTP status >= 400. These show that the browser stack is consistent with the Bun stack, not that the pictures equal the original client's (there is no reference screenshot).

### 15.5 Not done

KSM / KAC rendering (the characters), `CKTDGXRenderer` over the layer (the viewer uses the fixed-function path, CPU skinning and no XET texture changes), UI (`DLG_*.lua`), the real boot sequence.

