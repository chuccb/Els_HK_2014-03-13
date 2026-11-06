# Findings

Facts about the original client that the implementation depends on. "L1234567" = line in `data/x2.exe.c`;
"@ADDR" = function address (`//----- (ADDR)` marker). Everything here was read from the decompile or measured on the data
unless marked *(assumption)*.

## 1. The client

* `data/x2.exe`: PE32 (Win32), 14.8 MB, MSVC. `data/x2.exe.c` has 2,610,163 lines (33,294 functions, 1,355 classes found
  by `tools/index_decomp.py`), `data/x2.exe.h` 446,629 lines.
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
* Lua **source** exists in exactly three places: `data/TutorSystem.lua` (loose, UTF-8 BOM) and `GameOption.txt` /
  `GameOptionPreset.txt` inside the KOMs (Algorithm 2, UTF-8 BOM, `GAME_OPTION_CURRENT = { ... OPTION_LEVEL["OL_HIGH"] ... }`).
  Running them unmodified needs a Lua source compiler (not written yet, see ROADMAP "1b").
* The KOMs hold 41 Algorithm-2 `.txt`/`.kim` entries: 2 of them are the Lua sources above (`GameOption.txt`,
  `GameOptionPreset.txt`); the other 39 are not Lua: `particlesystem "GameMajor" 1.00 { ... }` particle scripts
  (`Game*/UI*Particle*.txt`), `XMESHPLAYER` scripts (`*XMeshPlayer*.txt`), a 0-byte `bossraid_dummy.txt`, and the 18.7 MB
  binary `item.kim` ("KIM" magic). They are parsed by C++ code of the exe and are phase 2 work (`item.kim` is done, see section 8).
* The exe's LuaJIT is stock 2.0.2 plus a few KOG additions: `dofile_UTF8` (`luaL_loadfilex(L, name, mode, iEncoding)`:
  encoding 0 accepts a UTF-8 BOM, 1 *requires* one unless the file is bytecode (`invalid encoding <chunk>` otherwise), 2 does no
  check), `lua_setencoding`/`lua_getencoding` (a flag in `global_State`), and the compat aliases `string.gfind` and `math.mod`
  (both reproduced; the library surface of the TS VM is identical to the oracle, test `t09_surface`). The lexer is stock
  (`lj_lex_setup` skips a BOM and a `#` first line, detects `ESC` bytecode).

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
| `tools/lua-difftest.sh`: 14 differential tests, t01-t09 hand-written (basics, tables, strings, metatables, coroutines, errors, math, misc, library surface) and t10-t14 fuzzers (table sizing/`#`/`pairs` order, string library, number conversion and formatting, every operator x every operand type with metamethod logging, `table.sort` ties, 500 random Lua patterns, `os.date/os.time`). The oracle runs with `-joff` and a test fails on a compile error or a non-zero exit of either engine | 14/14 identical (see "Differential fuzz findings" below for what they found) |
| `tools/corpus-diff.sh`: every game script run under a stub environment on native LuaJIT and on the TS VM; log of host calls, global table contents (order-independent hash + iteration-order hash) and results of calling every defined function must be identical | see the table at the end of this file |

Not verified / known gaps (also tracked in `docs/ROADMAP.md`):

* **Yield inside a metamethod** (e.g. `__index` that yields): LuaJIT allows it, this VM raises "attempt to yield across C-call
  boundary".
* `setfenv(0, t)` is a no-op; `collectgarbage('step')` always returns false; `__gc` is never called; weak tables
  (`__mode`) are strong.
* No Lua *source* compiler yet: `load`, `loadstring`, `loadfile` accept bytecode only.
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
* `os.date` follows the exe's CRT (msvcr100) where it is known and glibc is not the reference: 1970..3000 only (else `nil`),
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

* No GPU in the sandbox. A software Vulkan (Dawn `webgpu` npm package with Mesa lavapipe) can run WebGPU from Node/Bun for
  tests; headless Chromium cannot be launched.
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
with no stray control characters. Open point: whether the exe's CRT rounds exact `printf` ties half-to-even (modern UCRT, as ported) or
half-up (older MSVC runtimes) only matters for values like 0.125 passed to `f` / `e`.

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

Not done in Phase 2 (see section 9 for what the mesh work added): particle and XMeshPlayer text scripts (a custom block / `key = value`
DSL: `particlesystem "Name" 1.00 { eventsequence "..." { particleType = PT_2D_PLANE ... Fade so From 0.000 to 0.300 Position = XYZ(...) } }`,
parsed by `CKTDGParticleSystem::Compile` 328F5DB0 and `CKTDGXMeshPlayer::Compile` 32917A60 after a tokenizer),
MPEG-1, the `XETProxy` / `TETProxy` Lua authoring classes (registered with `lua_tinker`, but none of the 4,498 shipped scripts calls
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

**What the exe adds on top (not ported yet)**: static meshes are cloned to FVF 338, their vertex colour is set to 0xFFFFFFFF,
`D3DXComputeBoundingSphere`, `D3DXWeldVertices` (all epsilons 0) and `Optimize(MANAGED | ATTRSORT | VERTEXCACHE)` run, and the
attribute table becomes the draw ranges; keys read from a KSM go through `OptimizeKeys` (32988610, tolerance 0.001) before
`RegisterAnimationSRTKeys`; the `ID3DXAnimationController` is created with 2 tracks and 30 events. Open points for the renderer
phase: (1) D3DX's `D3DXLoadMeshFromX` flattens multi-mesh files with the frame transforms applied (assumed from the documented
behaviour, not checked against the real library; 13,039 `.y` files depend on it); (2) the quaternion convention of X-file
`AnimationKey`s (w,x,y,z, possibly conjugated) can be decided by comparing key 0 with the frame's rest matrix, the same
relationship holds in the KSM files; (3) X-file skin meshes need `D3DXLoadMeshHierarchyFromX` semantics (frame names, `SkinWeights`
-> bone table, `VertexDuplicationIndices`).
