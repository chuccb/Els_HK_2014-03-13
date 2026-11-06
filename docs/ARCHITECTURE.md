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
`xet.ts` reads the `.xet` / `.tet` tables with the exe's own `GetString` and binary search. Tests: `packages/assets/test`
(`bun test packages/assets`); corpus tools: `decode-images.ts` + `verify-images.py` (Pillow), `verify-xet-tet.ts`.

### `@els/lua` (`packages/lua`)
A register-based interpreter for LuaJIT 2.0.2 bytecode, following `lj_*` of the exe:

| File | Content |
|---|---|
| `value.ts` | value representation (`nil` = `undefined`, numbers = doubles, strings = JS byte strings, `LuaTable`, `LuaClosure`, `LuaNative`, `LuaUserdata`), `LuaError`, error-context records |
| `table.ts` | port of `lj_tab_*`: array/hash parts, node chaining with the same hash functions, `lj_tab_len` border search, `next` order |
| `bytecode.ts` | opcode tables (`lj_bc_mode`), `loadBytecode` (private header `1B 4B 4C 81`, flags, uleb128 constants, nested prototypes), `disassemble` (format of `jit.bc`) |
| `vm.ts` | `LuaState`/`LuaThread`/`Frame`, the interpreter loop (`runLoop`), calls, varargs, upvalues, metamethods (`lj_meta_*`), coroutines, error context (`resolveError`, `slotName`, `callerLevels`), synthetic `pcall`/`xpcall` closures |
| `numfmt.ts` | C-correct `%e/%f/%g` (ties-to-even) used by `tostring` and `string.format` |
| `lib/base.ts` | base library (`loadChunk`, `BaseHost`) |
| `lib/string.ts`, `lib/pattern.ts` | `string.*` (`lj_cf_string_format` port, Lua patterns) |
| `lib/table.ts`, `lib/misc.ts` | `table.*`; `math` (Tausworthe PRNG as in `lj_math_random`), `bit`, `coroutine`, `os`, `io`, `debug`, `jit` stubs, `package`/`require`/`module` |
| `index.ts` | `createLuaState(host)`, `runChunk` |

Design points that matter for faithfulness:

* **Bytecode only (so far).** Scripts are compiled stripped, so debug info is absent; error messages and `tostring` formats
  follow the exe (see FINDINGS section 3).
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
| `lua-difftest.sh` + `tests/lua/*.lua` | differential tests; both VMs run the same `luajit -b -s` bytecode |
| `corpus-diff.sh` + `lua/stubrun.lua` + `corpus-run.ts` | stub-environment differential run of all 4,498 game scripts (native xargs -P2 vs one in-process TS run, ~3 minutes per flavor) |
| `lua-run.ts` + `lib/lua-host.ts` | run a `.luac` in the TS VM (`arg` like the standalone interpreter); the shared runner of the corpus tool |
| `bindings.py` | extracts the `lua_tinker` registrations from `data/x2.exe.c` -> `docs/HOST_API.md`, `docs/host_api.tsv` (phase 5 ground truth) |
| `api-census.ts`, `script-graph.ts` | what the scripts use of the host API (`docs/SCRIPT_API_USAGE.md`) and which scripts the exe loads (`docs/SCRIPT_GRAPH.md`) |
| `census-images.ts`, `decode-images.ts`, `verify-images.py`, `verify-xet-tet.ts` | image format census, decode of all 55,377 TGA/DDS entries, cross-check against Pillow (needs a venv with `pillow`), XET/TET structure check |
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
./tools/lua-difftest.sh                       # 9 differential tests
./tools/corpus-diff.sh 1 && ./tools/corpus-diff.sh 2 && ./tools/corpus-diff.sh 3    # stub-environment corpus, 3 flavors
python3 tools/index_decomp.py data/x2.exe.c /home/user/work/analysis/functions.tsv
./node_modules/.bin/bun run tools/api-census.ts --md docs/SCRIPT_API_USAGE.md --json /home/user/work/analysis/api_census.json --usage /home/user/work/analysis/member_usage.json
./node_modules/.bin/bun run tools/script-graph.ts --md docs/SCRIPT_GRAPH.md
python3 tools/bindings.py && python3 tools/ledger.py                                # docs/HOST_API.md, docs/LEDGER.md
./node_modules/.bin/bun test packages/assets                                          # image / XET / TET unit tests
./node_modules/.bin/bun run tools/decode-images.ts --tsv /home/user/work/analysis/images_ts.tsv --dump /home/user/work/analysis/rgba_dump --every 40
python3 -m venv /home/user/work/venv && /home/user/work/venv/bin/pip install pillow
/home/user/work/venv/bin/python tools/verify-images.py /home/user/work/analysis/images_ts.tsv /home/user/work/analysis/rgba_dump
./node_modules/.bin/bun run tools/verify-xet-tet.ts
```
