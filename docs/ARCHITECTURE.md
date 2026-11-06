# Architecture

## Target

```
                +-----------------------------+            +--------------------------+
 data/*.kom --> |  @els/kom   (done)          |            |  apps/server (Bun)       |
 data/ui,...    |  archive reader + XORCRC    |            |  game server: packet     |
                +--------------+--------------+            |  protocol subset,        |
                               |                           |  bun:sqlite persistence  |
                +--------------v--------------+            +------------^-------------+
                |  @els/assets   (phase 2)    |                         | WebSocket
                |  TGA/DDS/X/Y/XET/TET/...    |                         |
                +--------------+--------------+            +------------+-------------+
                               |                           |  apps/client (browser)   |
   +---------------------------v--------------+            |  boot, game states       |
   |  @els/gfx (phase 3)  D3D9-compat on WebGPU|<----------+  (CX2State*), main loop  |
   +---------------------------+--------------+            +------------+-------------+
                               |                                        |
   +---------------------------v--------------+              +----------v-------------+
   |  @els/engine / @els/ui (phases 4-5)       |  host API   |  @els/lua  (done*)      |
   |  KTDX/KTDG classes, dialogs, lua_tinker-  |<----------->|  LuaJIT 2.0.2-compatible|
   |  equivalent bindings                      |             |  VM running the KOM     |
   +-------------------------------------------+             |  scripts unmodified     |
                                                             +-------------------------+
```

`*` verified against a native oracle, with the gaps listed in `docs/FINDINGS.md`.

The client runs in a browser (WebGPU, WebAudio, DOM input). Bun is used as package manager, test runner, bundler and server
runtime. Nothing in `data/` is modified or re-packed: archives are read through `@els/kom`, either from disk (tools/tests) or
over HTTP range requests (browser).

## Packages (implemented)

### `@els/kom` (`packages/kom`)
`KomArchive.open(source)` parses the header and XML manifest, `read(entry)` returns the decoded bytes (zlib; algorithm 2 adds
`xorCrcDecrypt`), `readStored` / `verifyStored` give the raw bytes and the Adler-32 check, `find(name)` is case-insensitive.
`ByteSource` abstracts a file (`fileSource`) or an HTTP resource with `Range` (`httpSource`).

### `@els/assets` (`packages/assets`)
Decoders for the client's asset formats (Phase 2). `decodeImage(bytes)` sniffs the container from the content (as D3DX does) and
returns level 0 as straight RGBA8, first row on top, plus the D3D9 source format name: `tga.ts` (types 1/2/3/9/10/11, 15-32 bpp,
palettes, origin bits), `dds.ts` (BC1/BC2/BC3 block decoders, bit-mask formats), `bmp.ts`, `png.ts` (non-interlaced, via fflate);
`xet.ts` reads the `.xet` / `.tet` tables with the exe's own `GetString` and binary search; `ess.ts` loads `General.ess` (the string
table: `parseEss`, `StringTable.get` / `.replaced`); `kim.ts` opens `item.kim` (`Kim.open`, `getItem`, `getSet`, per-unit lookups).
Meshes: `mszip.ts` + `inflate.ts` (the `bzip` container of X files; own raw-deflate decoder because the files contain stored blocks
without NLEN and chunks that reference the previous 32 KiB), `xfile.ts` (generic DirectX X reader, text + binary, template driven:
`parseXFile` returns the object tree with typed members), `ksm.ts` (KOG's `KME` static mesh, `KSM` skinned mesh and `KAC` animation
block, decoded from the exe's loaders with the same range checks). Mesh semantics (D3DX loading rules, skinning, animation
evaluation) are not written yet, see ROADMAP phase 2.
Effect scripts: `effectscript.ts` (the shared tokenizer with the exe's quirks, `ProcessNumber/Vector/Color`, the CRT `rand` and
`RandomNumber`, `EFFECT_SYSTEMS` = which file feeds which of the eight systems), `particle.ts` (`parseParticleScript` -> sequences with
their properties and events, `ParticleLibrary`) and `xmeshplayer.ts` (`parseXMeshPlayerScript` -> templets with Global / Anim / Die
timelines, `XMeshLibrary`): the compile side of `CKTDGParticleSystem` / `CKTDGXMeshPlayer`; the run-time simulation is not ported.
Tests: `packages/assets/test` (232 tests) and `packages/lua/test` (`loader.test.ts` 14, `proxy.test.ts` 38); all with `bun test packages`; corpus tools: `decode-images.ts` + `verify-images.py` (Pillow),
`verify-xet-tet.ts`, `verify-xfiles.ts`, `verify-xparse.ts`, `verify-ksm.ts`, `verify-ess.ts`, `verify-kim.ts`, `verify-effects.ts`.

### `@els/lua` (`packages/lua`)
A register-based interpreter for LuaJIT 2.0.2 bytecode, following `lj_*` of the exe:

| File | Content |
|---|---|
| `value.ts` | value representation (`nil` = `undefined`, numbers = doubles, strings = JS byte strings, `LuaTable`, `LuaClosure`, `LuaNative`, `LuaUserdata`), `LuaError`, error-context records |
| `table.ts` | port of `lj_tab_*`: array/hash parts, node chaining with the same hash functions, `lj_tab_len` border search, `next` order |
| `bytecode.ts` | opcode tables (`lj_bc_mode`), `loadBytecode` (private header `1B 4B 4C 81`, flags, uleb128 constants, nested prototypes), `disassemble` (format of `jit.bc`) |
| `vm.ts` | `LuaState`/`LuaThread`/`Frame`, the interpreter loop (`runLoop`), calls, varargs, upvalues, metamethods (`lj_meta_*`), coroutines, error context (`resolveError`, `slotName`, `callerLevels`), synthetic `pcall`/`xpcall` closures |
| `numfmt.ts` | C-correct `%e/%f/%g` (ties-to-even) used by `tostring` and `string.format` |
| `strscan.ts` | literal port of `lj_strscan.c` (`tonumber`, string arithmetic coercions; not always correctly rounded, so never replace it by `Number()`) |
| `cmath.ts` | `x ^ y` / `math.pow` exactly as `vm_pow_sse` (repeated squaring for int32 exponents, special cases; `Math.pow` for the x87 path) |
| `lib/base.ts` | base library; `loadChunk` (= `lj_lex_setup` + `cpparser` + `lj_bcread`: the exe has no source compiler, so text is refused), `loadFileChunk` (`luaL_loadfilex` with `iEncoding`), `dofile_UTF8`, `BaseHost` |
| `proxy.ts` | `LuaManagerProxy`: port of KOG's `KLuaManagerProxy`, the interpreter of the text configuration files (`GameOption*.txt`, server group, tutor, console arguments); no Lua VM involved except for global lookups |
| `lib/string.ts`, `lib/pattern.ts` | `string.*` (`lj_cf_string_format` port, Lua patterns) |
| `lib/table.ts`, `lib/misc.ts` | `table.*`; `math` (Tausworthe PRNG as in `lj_math_random`), `bit`, `coroutine`, `os`, `io`, `debug`, `jit` stubs, `package`/`require`/`module` |
| `index.ts` | `createLuaState(host)`, `runChunk` |

Design points that matter for faithfulness:

* **Bytecode only, like the exe.** The client has no Lua source compiler (FINDINGS section 11): scripts are precompiled and stripped, so debug info is
  absent; text chunks fail with `cannot load malformed bytecode`. Error messages and `tostring` formats follow the exe (see FINDINGS section 3).
* **Strings are byte strings** (code units 0-255): bytes round-trip exactly, string hashing and `#` match the 32-bit exe.
* **Error context is computed lazily**: natives and VM raise `LuaError` with a *pending* description; `resolveError` (run when the
  error reaches the nearest frame boundary, while the frames are still intact) builds the final message, exactly as
  `lj_err_*`/`lj_debug_*` do (position prefix, `bad argument #n to 'name'`, variable naming from bytecode).
* **`pcall`/`xpcall` are ordinary Lua closures over synthetic bytecode** (`Proto.synthetic`), so error handling, tail calls and
  stack depth behave like in LuaJIT (handler runs at the error point, before unwinding).
* **Coroutines** have their own stacks and frames; yields across natives or metamethods are not supported yet.

## Tools (`tools/`)

| Tool | Purpose |
|---|---|
| `verify-kom.ts` | full verification of every KOM entry |
| `verify-lua-bytecode.ts` + `lua/native_dump_bc.lua` | loader/disassembler vs the native `jit.bc` listing |
| `setup-oracle.sh` | builds the LuaJIT 2.0.2 oracle (patched for 32-bit `long`, client header) |
| `lua-difftest.sh` + `tests/lua/*.lua` | differential tests (t10-t14 are fuzzers, t15 the chunk loader); both VMs run the same `luajit -b -s` bytecode, the oracle with `-joff`; a compile error or non-zero exit fails the test |
| `corpus-diff.sh` + `lua/stubrun.lua` + `corpus-run.ts` | stub-environment differential run of all 4,498 game scripts (native xargs -P2 vs one in-process TS run, ~3 minutes per flavor) |
| `lua-run.ts` + `lib/lua-host.ts` | run a `.luac` in the TS VM (`arg` like the standalone interpreter); the shared runner of the corpus tool |
| `bindings.py` | extracts the `lua_tinker` registrations from `data/x2.exe.c` -> `docs/HOST_API.md`, `docs/host_api.tsv` (phase 5 ground truth) |
| `api-census.ts`, `script-graph.ts` | what the scripts use of the host API (`docs/SCRIPT_API_USAGE.md`) and which scripts the exe loads (`docs/SCRIPT_GRAPH.md`) |
| `census-images.ts`, `decode-images.ts`, `verify-images.py`, `verify-xet-tet.ts` | image format census, decode of all 55,377 TGA/DDS entries, cross-check against Pillow (needs a venv with `pillow`), XET/TET structure check |
| `verify-xfiles.ts` | container census of the 26,453 `.x` / `.y` entries; decompresses all 25,204 MSZIP entries (`--crosscheck` against fflate, `--dump DIR --every N` writes samples) |
| `verify-xparse.ts` | parses all 25,313 DirectX-format files with `parseXFile`, object census and per-mesh consistency checks (`--limit N --filter RE --verbose`) |
| `verify-ksm.ts` | parses the 109 KME + 1,031 KSM files (with their KAC animations) and checks the invariants the exe relies on |
| `verify-ess.ts`, `verify-ess.py` | decodes `data/general.ess` and reports index mismatches, capped lines, placeholders, character classes; the Python script is an independent second implementation of the loader |
| `verify-kim.ts` | decodes `item.kim` from its KOM, checks id order / id agreement / string length words / set cross references and reports every byte the decoder did not read |
| `verify-effects.ts` + `lib/effect-oracle.ts` | parses the 37 particle / XMeshPlayer scripts of the KOMs and compares every field of all 13,882 blocks with an independent line-based reader; counts three ways, unread tokens, duplicate names per script system (`--census`: property and event usage) |
| `ledger.py` | coverage ledger keyed by IDA address -> `docs/LEDGER.md` (rules in `docs/ledger.tsv`, `docs/ledger-classes.tsv`) |
| `index_decomp.py`, `komlib.py`, `kom_extract.py`, `luadecrypt.py`, `census.ts` | reverse-engineering helpers (function index, extraction, census) |

## Reproducing the verification from a clean checkout

```sh
npm install --no-audit --no-fund              # installs bun, typescript, fflate into node_modules
./tools/setup-oracle.sh                       # LuaJIT 2.0.2 oracle -> /home/user/work/luajit-2.0
./node_modules/.bin/bun run tools/verify-kom.ts
python3 tools/kom_extract.py /home/user/work/ex lua,LUA
ls /home/user/work/ex | sort > /home/user/work/lualist.txt
LUA_PATH=/home/user/work/luajit-2.0/src/?.lua /home/user/work/luajit-2.0/src/luajit tools/lua/native_dump_bc.lua \
  /home/user/work/ex /home/user/work/lualist.txt > /home/user/work/native_bc.txt
./node_modules/.bin/bun run tools/verify-lua-bytecode.ts /home/user/work/native_bc.txt
./tools/lua-difftest.sh                       # 15 differential tests (t10-t14 are fuzzers, t15 the chunk loader)
./tools/corpus-diff.sh 1 && ./tools/corpus-diff.sh 2 && ./tools/corpus-diff.sh 3    # stub-environment corpus, 3 flavors
python3 tools/index_decomp.py data/x2.exe.c /home/user/work/analysis/functions.tsv
./node_modules/.bin/bun run tools/api-census.ts --md docs/SCRIPT_API_USAGE.md --json /home/user/work/analysis/api_census.json --usage /home/user/work/analysis/member_usage.json
./node_modules/.bin/bun run tools/script-graph.ts --md docs/SCRIPT_GRAPH.md
python3 tools/bindings.py && python3 tools/ledger.py                                # docs/HOST_API.md, docs/LEDGER.md
./node_modules/.bin/bun test packages                                                 # unit tests: asset decoders (232), Lua loader (14), KLuaManagerProxy (38)
./node_modules/.bin/bun run tools/decode-images.ts --tsv /home/user/work/analysis/images_ts.tsv --dump /home/user/work/analysis/rgba_dump --every 40
python3 -m venv /home/user/work/venv && /home/user/work/venv/bin/pip install pillow
/home/user/work/venv/bin/python tools/verify-images.py /home/user/work/analysis/images_ts.tsv /home/user/work/analysis/rgba_dump
./node_modules/.bin/bun run tools/verify-xet-tet.ts
./node_modules/.bin/bun run tools/verify-xfiles.ts --crosscheck       # MSZIP container, ~105 s
./node_modules/.bin/bun run tools/verify-xparse.ts                    # generic X reader on 25,313 files, ~100 s
./node_modules/.bin/bun run tools/verify-ksm.ts                       # KME / KSM / KAC, ~45 s
./node_modules/.bin/bun run tools/verify-ess.ts                       # string table
./node_modules/.bin/bun run tools/verify-kim.ts                       # item database, ~2 s
./node_modules/.bin/bun run tools/verify-effects.ts                   # particle / XMeshPlayer scripts, ~4 s
```
