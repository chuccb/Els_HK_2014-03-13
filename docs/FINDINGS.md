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
  binary `item.kim` ("KIM" magic). They are parsed by C++ code of the exe and are phase 2 work.
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
| `tools/lua-difftest.sh`: 9 hand-written differential tests (basics, tables, strings, metatables, coroutines, errors, math, misc, library surface) | 9/9 identical |
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
* `math.sin/cos/tan/asin/acos/atan/atan2/exp/log/log10/pow/sinh/cosh/tanh` and the `^` operator use V8's libm; the exe uses the
  CRT and x87 sequences (`lj_vm_exp2_x87`, `lj_vm_pow_sse`), so results can differ in the last ulp for some inputs (x87
  `fyl2x`/`f2xm1` are not bit-reproducible across CPUs either). Exactly rounded operations (`+ - * / sqrt floor ceil abs fmod`)
  are identical.
* `pcall()` / `xpcall()` with *no arguments* report "attempt to call a nil value" instead of "bad argument #1 to '?' (value
  expected)" (pcall/xpcall are synthetic bytecode closures).
* `strToNumber` handles only part of `lj_strscan` (signed `inf`/`infinity`/`nan` spellings are missing).
* Printed addresses (`tostring(table)`, `%p`) can never match.
* JIT compilation is not implemented: the VM is an interpreter, semantically equivalent by LuaJIT's contract (nothing in the
  client depends on `jit.*`).

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

