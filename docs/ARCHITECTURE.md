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
   |  @els/d3d9 (phase 3) D3D9 + D3DX on WebGPU|<----------+  (CX2State*), main loop  |
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
`ByteSource` abstracts a file (`fileSource`) or an HTTP resource with `Range` (`httpSource`). `MassFileManager` (`massfile.ts`) is the exe's
`KGCMassFileManager` name map: `addMassFile` / `addArchive` / `lock` / `find` / `has` / `loadDataFile` (upper-case lookup, a duplicate name is an error, nothing can be added
after the lock); `CLIENT_KOM_NAMES` is the mount order of `CX2Main` (`datai001`..`datai023`, `data001`..`data150`) and `mountClientArchives` opens them concurrently (FINDINGS 14).

### `@els/assets` (`packages/assets`)
Decoders for the client's asset formats (Phase 2). `decodeImage(bytes)` sniffs the container from the content (as D3DX does) and
returns level 0 as straight RGBA8, first row on top, plus the D3D9 source format name: `tga.ts` (types 1/2/3/9/10/11, 15-32 bpp,
palettes, origin bits), `dds.ts` (BC1/BC2/BC3 block decoders, bit-mask formats), `bmp.ts`, `png.ts` (non-interlaced, via fflate);
`xet.ts` reads the `.xet` / `.tet` tables with the exe's own `GetString` and binary search; `ess.ts` loads `General.ess` (the string
table: `parseEss`, `StringTable.get` / `.replaced`); `kim.ts` opens `item.kim` (`Kim.open`, `getItem`, `getSet`, per-unit lookups).
Meshes: `mszip.ts` + `inflate.ts` (the `bzip` container of X files; own raw-deflate decoder because the files contain stored blocks
without NLEN and chunks that reference the previous 32 KiB), `xfile.ts` (generic DirectX X reader, text + binary, template driven:
`parseXFile` returns the object tree with typed members), `ksm.ts` (KOG's `KME` static mesh, `KSM` skinned mesh and `KAC` animation
block, decoded from the exe's loaders with the same range checks), `xscene.ts` (`loadXScene`: the frames, meshes, skin weights and
animation sets of an X file as typed data, the input of the D3DX mesh functions in `@els/d3d9`). Skinning and animation evaluation are not
written yet, see ROADMAP phases 2 and 3.
Movies: `avi.ts` (RIFF AVI demuxer: headers, `movi` chunks, `idx1` key frames), `mpeg1.ts` + `mpeg1-tables.ts` (MPEG-1 video decoder of ISO 11172-2:
`Mpeg1Decoder.decode(bytes)` -> `Mpeg1Frame` YUV 4:2:0 planes in display order, `yuv420ToBgra`, `visiblePlanes`, `splitPictures`; the tables are generated
by `tools/gen-mpeg1-tables.py`) and `movie.ts` (`Mpeg1Movie.open(aviBytes)`: `info`, `next()`, `frame(i)`, `seek(i)`); the 30 shipped movies decode
identically to FFmpeg (FINDINGS section 13). Effect scripts: `effectscript.ts` (the shared tokenizer with the exe's quirks, `ProcessNumber/Vector/Color`, the CRT `rand` and
`RandomNumber`, `EFFECT_SYSTEMS` = which file feeds which of the eight systems), `particle.ts` (`parseParticleScript` -> sequences with
their properties and events, `ParticleLibrary`) and `xmeshplayer.ts` (`parseXMeshPlayerScript` -> templets with Global / Anim / Die
timelines, `XMeshLibrary`): the compile side of `CKTDGParticleSystem` / `CKTDGXMeshPlayer`; the run-time simulation is not ported.
Tests: `packages/assets/test` (270 tests) and `packages/lua/test` (`loader.test.ts` 14, `proxy.test.ts` 38); all with `bun test packages`; corpus tools: `decode-images.ts` + `verify-images.py` (Pillow),
`verify-xet-tet.ts`, `verify-xfiles.ts`, `verify-xparse.ts`, `verify-ksm.ts`, `verify-ess.ts`, `verify-kim.ts`, `verify-effects.ts`, `verify-mpeg1.ts` (+ the FFmpeg oracle
`oracle-mpeg1.py`, the fixture generator `gen-mpeg1-fixtures.py`, the mutation check `mutate-mpeg1.py`).

### `@els/d3d9` (`packages/d3d9`)
`Direct3DDevice9` (PascalCase, D3D's names, `HRESULT` results; `CreateX` returns `{hr, resource}`, `Lock` returns `{hr, data}`) over a WebGPU
device, plus the D3DX functions the exe imports. Rendering is recorded into one command encoder per frame; `await dev.readPixels()`
reads the back buffer or any surface (that is how the tests and `tools/render-demo.ts` produce images). Every module has a header comment that
documents its design and assumptions; FINDINGS section 12 is the reference.

| File | Content |
|---|---|
| `enums.generated.ts`, `enums.ts` | the D3D9 enums and flags, generated from the enum definitions of `data/x2.exe.h` by `tools/gen-d3d9-enums.ts` (`--check` verifies the checked-in file); `enums.ts` adds the D3DFVF / D3DTS helpers |
| `state.ts` | the device state machine: render / texture-stage / sampler states with the defaults the exe writes back in `CKTDGStateManager::RestoreDeviceObjects`, transforms, lights, material, viewport |
| `vertex.ts`, `formats.ts` | FVF codes and vertex declarations -> WebGPU vertex layouts (one fixed shader location per semantic); `D3DFORMAT` metadata and the CPU conversions to the uploaded texel format |
| `ffp.ts`, `pipeline-state.ts` | the fixed-function pipeline: device state -> `ProgramDesc` -> generated WGSL (vertex transform + lighting + fog + texcoord generation; texture-stage cascade + specular + fog + alpha test); blend / depth / stencil / raster / sampler translation |
| `resources.ts`, `arena.ts` | buffers, textures, surfaces, declarations with CPU shadows in D3D's layout and the renaming rules for data written after use; the per-frame bump allocator for uniform blocks and dynamic vertex data |
| `device.ts`, `caps.ts`, `hresult.ts` | `Direct3DDevice9`, `D3DCAPS9` (a Shader Model 3 HAL), `D3D_OK` / `D3DERR_*` / `D3DXERR_*` |
| `d3dx-math.ts` | the 26 D3DX math functions of the import table (single-precision at the same points as the SSE code) |
| `d3dx-texture.ts` | `D3DXGetImageInfoFromFileInMemory`, `D3DXCheckTextureRequirements`, `D3DXCreateTextureFromFileInMemoryEx` (decoding by `@els/assets`), `D3DXCreateTexture`, `D3DXSaveSurfaceToFileInMemory`, `ID3DXBuffer` |
| `d3dx-mesh.ts` | `ID3DXMesh` and the mesh functions (`D3DXLoadMeshFromXInMemory` = merge all meshes of the X file with their frame transforms baked in, `D3DXBuildMesh` = one X mesh as D3DX loads it, `Optimize`, `WeldVertices`, `GetAttributeTable`, `DrawSubset`, `Intersect`, `ComputeBoundingSphere`) |
| `d3dx-animation.ts` | `D3DXCreateKeyframedAnimationSet` and `D3DXCreateAnimationController`: tracks, priority groups, keyed speed / weight / position / enable / priority-blend events (the exact cross-fade of `CKTDGXSkinAnim::ChangeAnim` is a test), `AdvanceTime`, `CloneAnimationController` |
| `d3dx-skin.ts` | `ID3DXSkinInfo` (+ software `UpdateSkinnedMesh`), `ConvertToIndexedBlendedMesh`, `D3DXFrame*`, `ID3DXAllocateHierarchy` and `D3DXLoadMeshHierarchyFromXInMemory` (frames, mesh containers, skin info, controller from an X file) |
| `vshader.ts` | the programmable vertex stage of the device: an emulated vertex shader is WGSL (`user_vs`) over the 256 float4 constant registers; what it replaces and what stays fixed-function is in the header (FINDINGS 12.7) |
| `xrenderer-shaders.ts` | the 34 HLSL functions of `XRenderer.fx` (`vs_1_1`: rigid and 1-4 bone skinning of real colour, cartoon, black / colour edge, 8 light-flow families) as WGSL, the register layout `XR`, and the token hashes that tie them to the shipped file |
| `effect.ts` | `D3DXCreateEffect` / `ID3DXEffect` for `XRenderer.fx`: parses the shipped HLSL text (parameters, techniques, passes, state assignments, shader arrays), `Begin` / `BeginPass` / `CommitChanges` / `EndPass` / `End`, `ID3DXEffectStateManager`, `DeviceStateManager` |

`@els/assets` gained `xscene.ts` (`loadXScene`: frames, meshes, skin weights and animation sets of an X file as typed data) and
`encodePng`. Tests are GPU tests: `./tools/gpu.sh ./node_modules/.bin/bun test packages/d3d9` (software Vulkan from `tools/setup-gpu.sh`);
without an adapter they skip themselves and only `pure.test.ts` and the effect-file parse test of `xrenderer.test.ts` run.

### `@els/engine` (`packages/engine`)
The engine classes (`CKTDX*` / `CKTDG*`) over the D3D9 layer, ported function by function with their x2.exe.c anchors in the header comments (FINDINGS 15.3, 16):

| File | Content |
|---|---|
| `skinmesh-frames.ts` | `setupFrameList`, `setupDrawFrameList`, `collisionFrames` of `CKTDXDeviceXSkinMesh::XSkinMeshProxy`: which frames of a model are drawn |
| `multianim.ts` | `CMultiAnimAllocateHierarchy`, `MultiAnimFrame`, `MultiAnimMC`: the frame / mesh-container classes the loaders fill (the exe's `ID3DXAllocateHierarchy`) |
| `ksm-load.ts` | `loadKSkinnedMesh` (`LoadKSkinnedMesh`, `ReadKSM`, `KTDXAnimationController::ReadFromMemory`): a KSM file -> frames, skinned mesh containers, an `ID3DXAnimationController` with one keyframed set per KAC set |
| `kac-keys.ts` | `optimizeKeys` (the key reducer `OptimizeKeys`, **bit-identical to the exe**, FINDINGS 16.2 / 16.3), `prepareKeys` (UnpackKeys output -> reduced D3DX key arrays) |
| `skinmesh.ts` | `loadSkinnedMesh` (`CKTDXDeviceXSkinMesh::_Load`: KSM -> `ksm-load.ts`, anything else -> `D3DXLoadMeshHierarchyFromXInMemory` + frame lists) |
| `xmesh.ts` | `loadXMesh` (`CKTDXDeviceXMesh::_Load`: `LoadKMEMesh` for KME, `LoadD3DXMesh` for X): FVF 338 mesh, welded, attribute sorted, one bounding sphere per range |

Tests (`./tools/gpu.sh ./node_modules/.bin/bun test packages/engine`, 42): `skinmesh-frames.test.ts` (10), `ksm-load.test.ts` (14: the real `Motion_Elsword.x`, pose at time 0, Wait3 upright, the Walk set), `xmesh.test.ts` (7),
`kac-keys.test.ts` (11, no GPU: hand cases from the oracle + the recorded fixture `test/fixtures/optimizekeys.bin`; `test/keys-fixture.ts` is its codec, shared with `tools/verify-optimizekeys.ts`).

### `@els/host` (`packages/host`)
The `lua_tinker` layer: what a script sees of the C++ client. The binder is data driven (one implementation instead of one C++ template
instance per signature), fed by `src/api.generated.ts`, which `tools/gen-host-api.ts` generates from `docs/host_api.tsv` (`--check` fails
when it is stale): 128 classes (119 with methods or fields; the rest are named only as a base or as the class of a global object), 1,418
methods, 34 fields, 59 global object names (66 name / class pairs from the 93 registration sites), 5 global functions, 19 constants, each method with the exe's address and its C++ parameter / return types, and a typed `<Class>_Methods` interface per class.

| File | Content |
|---|---|
| `src/tinker.ts` | `HostRuntime`: `class_add` / `class_inh` / `class_mem` / `class_con` (a global table named like the class is the metatable of its objects; `__index` = `meta_get`, `__newindex` = `meta_set`, `__parent` chain, fields as accessor userdata, `__call` constructors for D3DXVECTOR2 / 3 / COLOR), `read<T>` / `push<T>` (`(int)lua_tonumber` truncation with the x86 `cvttsd2si` results, bool rules, `char const *` from strings and numbers, a struct by value is a copy, a pointer is a NEW userdata per push), the exact error texts (`can't find 'X' class variable. (forgot registering class variable ?)`, `no class at first argument. (forgot ':' expression ?)`), `registerImpl` / `registerFunction` / `setObject` / `status`, and **not-ported handling**: strict mode throws `HostNotPortedError("Class.method @addr")`, record mode counts the call and returns a typed stub value (0, false, "", a zero vector, a stub object of the declared class) |
| `src/kluamanager.ts` | `KLuaManager` (the table reader of every `*_LUA` function): `BeginTable` / `EndTable` / `GetValue` overloads / `GetUserDefinedTypeValue<D3DXVECTOR2/3/COLOR>` / `GetNumIndexedValues`; `(L, 1)` reads the table on top of the stack of the native call being served |
| `src/values.ts` | `Vec2` / `Vec3` / `Color` (Float32Array backed, C++ `float` semantics), `HostHandle` (`KHandleType<int, ...>`) |
| `src/world.ts` | `HostWorld`: one Lua state with the host layer, `IncludeLua` (base name, case ignored, `false` for a missing script), `loadEnums` (what `CX2Main::LoadLuaEnum` runs: `Enum.lua`, `DungeonEnum.lua`, `MassFileMappingList_HK.lua`, `StringID_def.lua`) and `publishStubObjects` (the registered globals as typed stubs) |
| `src/classes/massfile.ts` | the first real host class: `KGCMassFileManager.AddMappingList` / `AddMappingTime` (`std::map::emplace` semantics, `CTime` date parsing as in 328D43E0); the file lookup that applies the mapping is not ported yet |
| `src/census.ts` | `makeCensusWorld`, `runCensus`: every script on typed stubs (the core of `tools/host-census.ts`) |

A host class is a plain TS class whose methods are named exactly like the Lua names and declare `implements Partial<Class_Methods>`; calls are
dispatched on the receiver by name, so one TS class can implement a base class and its derived classes. Nothing is invented: a name the exe
does not register is not visible to scripts. `docs/HOST_CENSUS.md` (`tools/host-census.ts`) runs all 4,498 scripts on the binder with record
mode and lists what they need: 4,422 run to the end; the other 76 need 23 names that are not even strings of `x2.exe`.
Tests: `bun test packages/host` (34, no GPU; the 9 script tests need `data/`, the whole-corpus ones take ~6 s each).

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

## Apps

* `apps/server` (`@els/server`): `bun run apps/server/src/main.ts [--port 8080] [--host 0.0.0.0]`. Serves the client page, the bundle (`Bun.build` of
  `apps/client/src/main.ts`, rebuilt when a source file changes), `/data/*` with `Range` / `HEAD` (only asset types; no `..`) and `/api/files` (the loose files). The game server
  (packet protocol, `bun:sqlite`) is Phase 6.
* `apps/client` (`@els/client`): today the **asset viewer** (FINDINGS 15.2): `vfs.ts` mounts the 173 archives over HTTP Range requests, `gpu.ts` creates the WebGPU device and the D3D9 layer that
  presents to a canvas, `viewer.ts` is the list + preview pane, `previews/` has one module per type (image, movie, audio, text / Lua / tables, mesh). The boot sequence and the game states
  replace `main.ts` in Phase 6. `window.__els` is the handle for the browser tests.

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
| `gen-host-api.ts` | `docs/host_api.tsv` -> `packages/host/src/api.generated.ts` (`--check` fails when stale) |
| `host-census.ts` | runs every script of the KOMs on the host layer with typed stubs (`--md docs/HOST_CENSUS.md`, `--show SCRIPT`, `--match RE`, `--isolated`) |
| `api-census.ts`, `script-graph.ts` | what the scripts use of the host API (`docs/SCRIPT_API_USAGE.md`) and which scripts the exe loads (`docs/SCRIPT_GRAPH.md`) |
| `census-images.ts`, `decode-images.ts`, `verify-images.py`, `verify-xet-tet.ts` | image format census, decode of all 55,377 TGA/DDS entries, cross-check against Pillow (needs a venv with `pillow`), XET/TET structure check |
| `verify-xfiles.ts` | container census of the 26,453 `.x` / `.y` entries; decompresses all 25,204 MSZIP entries (`--crosscheck` against fflate, `--dump DIR --every N` writes samples) |
| `verify-xparse.ts` | parses all 25,313 DirectX-format files with `parseXFile`, object census and per-mesh consistency checks (`--limit N --filter RE --verbose`) |
| `verify-ksm.ts` | parses the 109 KME + 1,031 KSM files (with their KAC animations) and checks the invariants the exe relies on |
| `verify-ksm-load.ts` | loads all 1,031 KSM through `loadSkinnedMesh` on a software WebGPU device and compares with `parseKsm` (frames, containers, bones, sets, animations, poses; keys before / after `OptimizeKeys`), ~90 s |
| `verify-xmesh-load.ts` | loads the 109 KME (and with `--x N` every N-th X / Y file) through `loadXMesh`, checks the tail of `_Load` (FVF 338, ranges tile the faces, finite spheres), ~45 s |
| `peemu.py` | runs functions of `data/x2.exe` on the Unicorn CPU emulator (PE mapped at its base, imports replaced by stubs / Python hooks): the oracle for pure functions of the exe |
| `oracle-optimizekeys.py`, `verify-optimizekeys.ts`, `mutate-optimizekeys.py` | `OptimizeKeys` of the exe on `peemu.py` for a file of cases; the TS tool generates cases (synthetic + the shipped animations), compares the port bit for bit and records / merges the fixture; the mutation check of `kac-keys.ts` (22 mutants; unit tests or `--live`) |
| `disasm.py` | Capstone disassembly of a range of `x2.exe` by virtual address, imports named (also through the `jmp [slot]` thunks): for what the decompile gets wrong (float code, FINDINGS 7) |
| `verify-ess.ts`, `verify-ess.py` | decodes `data/general.ess` and reports index mismatches, capped lines, placeholders, character classes; the Python script is an independent second implementation of the loader |
| `verify-kim.ts` | decodes `item.kim` from its KOM, checks id order / id agreement / string length words / set cross references and reports every byte the decoder did not read |
| `verify-effects.ts` + `lib/effect-oracle.ts` | parses the 37 particle / XMeshPlayer scripts of the KOMs and compares every field of all 13,882 blocks with an independent line-based reader; counts three ways, unread tokens, duplicate names per script system (`--census`: property and event usage) |
| `setup-gpu.sh`, `gpu.sh` | `setup-gpu.sh` installs the software Vulkan driver (SwiftShader, taken from the `@sparticuz/chromium` npm package) into `/home/user/work/swsh`; `gpu.sh CMD...` runs a command with the environment that lets Dawn (the `webgpu` npm package) find it (`ELS_GPU_NATIVE=1` skips this on a machine with a real GPU) |
| `gen-d3d9-enums.ts` | regenerates `packages/d3d9/src/enums.generated.ts` from `data/x2.exe.h` (`--check` fails when the file is stale) |
| `census-xscene.ts` | loads all 25,313 X / Y files through `loadXScene` and checks every index (faces, normals, texture coordinates, materials, bones, animation targets); prints the census quoted in FINDINGS section 12 |
| `census-skin.ts` | the D3DX hierarchy loader, `ConvertToIndexedBlendedMesh` (with the engine's palette) and the controller over every skinned X file (needs the GPU wrapper) |
| `render-demo.ts` | the D3D9 visual milestone: loading screen + starter sword -> PNG (`docs/img/d3d9-demo.png` with `--docs`) |
| `setup-browser.sh`, `browser.mjs` (+ `browser.d.mts`) | installs `puppeteer-core` and a headless Chromium (`@sparticuz/chromium`, WebGPU on SwiftShader) under `/home/user/work/browser` and `/tmp/chromium`; `node tools/browser.mjs URL [--shot f.png] [--wait EXPR] [--eval EXPR]... [--size WxH] [--settle ms]` opens a page, prints the console, evaluates, screenshots, exits 1 on a page error / failed request / timeout; `withPage` for scripts (FINDINGS 15.1) |
| `browser-test.ts` | 22 browser checks of the web client (`--smoke N` opens N pseudo-random X / Y files as well, N = 1,500: all open as meshes - 440 skinned, 349 animated, 50 KSM, 5 KME, 10 with nothing to draw - 0 errors) against the same decoders run in Bun (archives over Range, TGA and AVI pictures pixel-identical, static, skinned and KSM / KME meshes through the WebGPU canvas incl. the standing Elsword and a Walk pose, RGBA vs BGRA back buffer identical, Lua / XET / TET / audio previews, no console error); `--shots DIR` keeps screenshots |
| `ledger.py` | coverage ledger keyed by IDA address -> `docs/LEDGER.md` (rules in `docs/ledger.tsv`, `docs/ledger-classes.tsv`) |
| `index_decomp.py`, `komlib.py`, `kom_extract.py`, `luadecrypt.py`, `census.ts` | reverse-engineering helpers (function index, extraction, census) |

## Reproducing the verification from a clean checkout

```sh
# npm cannot read the `workspace:` specs of this repo, so bun is bootstrapped into a scratch prefix and does the real install
npm install --no-audit --no-fund --prefix /home/user/work/boot bun@1.4.4 && /home/user/work/boot/node_modules/.bin/bun install   # bun, typescript, fflate, webgpu + the @els/* workspace links
./tools/setup-gpu.sh                          # software Vulkan (SwiftShader) for the d3d9 tests -> /home/user/work/swsh (run code through ./tools/gpu.sh)
python3 tools/index_decomp.py data/x2.exe.c /home/user/work/analysis/functions.tsv   # function index (needed by tools/ledger.py)
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
./node_modules/.bin/bun test packages                                                 # unit tests that need no GPU: asset decoders, Lua loader, KLuaManagerProxy (the d3d9 GPU tests skip)
./tools/setup-gpu.sh                                                                   # software Vulkan for Dawn -> /home/user/work/swsh (about 2 s)
./tools/gpu.sh ./node_modules/.bin/bun test packages                                   # everything: 562 tests (423 + 139 that need the GPU), incl. the 154 d3d9 tests on Dawn + SwiftShader
./node_modules/.bin/bun run tools/gen-d3d9-enums.ts --check                            # enums.generated.ts is current
./node_modules/.bin/bun run tools/census-xscene.ts                                     # integrity of all 25,313 X / Y scenes
./tools/gpu.sh ./node_modules/.bin/bun run tools/census-skin.ts                        # hierarchy loader + skin conversion + animation over all 7,395 skinned files, ~3 min
./tools/gpu.sh ./node_modules/.bin/bun run tools/render-demo.ts /home/user/work/out --docs   # the picture in docs/img
./node_modules/.bin/bun run tools/decode-images.ts --tsv /home/user/work/analysis/images_ts.tsv --dump /home/user/work/analysis/rgba_dump --every 40
python3 -m venv /home/user/work/venv && /home/user/work/venv/bin/pip install pillow
/home/user/work/venv/bin/python tools/verify-images.py /home/user/work/analysis/images_ts.tsv /home/user/work/analysis/rgba_dump
./node_modules/.bin/bun run tools/verify-xet-tet.ts
./node_modules/.bin/bun run tools/verify-xfiles.ts --crosscheck       # MSZIP container, ~105 s
./node_modules/.bin/bun run tools/verify-xparse.ts                    # generic X reader on 25,313 files, ~100 s
./node_modules/.bin/bun run tools/verify-ksm.ts                       # KME / KSM / KAC, ~45 s
./tools/gpu.sh ./node_modules/.bin/bun run tools/verify-ksm-load.ts   # all 1,031 KSM through the engine loader, ~90 s
./tools/gpu.sh ./node_modules/.bin/bun run tools/verify-xmesh-load.ts --x 50   # 109 KME + every 50th X / Y file through loadXMesh, ~45 s
pip install --target /home/user/work/pycap unicorn pefile capstone                      # CPU emulator + PE / disassembler libraries (ELS_PYLIBS overrides the directory)
./node_modules/.bin/bun run tools/verify-optimizekeys.ts              # OptimizeKeys of the exe (emulated) vs the port, bit for bit: 3,000 synthetic cases + every 400th shipped animation, ~1 min
python3 tools/mutate-optimizekeys.py                                  # 22 mutants of kac-keys.ts against the unit tests (4 survivors are expected: equivalent or unreachable, FINDINGS 16.3), ~1 s
./node_modules/.bin/bun run tools/verify-ess.ts                       # string table
./node_modules/.bin/bun run tools/verify-kim.ts                       # item database, ~2 s
./node_modules/.bin/bun run tools/verify-effects.ts                   # particle / XMeshPlayer scripts, ~4 s
pip install --target /home/user/work/pyav av numpy                                      # FFmpeg (libavcodec) bundled in the `av` wheel: the MPEG-1 oracle
PYTHONPATH=/home/user/work/pyav python3 tools/oracle-mpeg1.py --out /home/user/work/mpeg1_oracle.json data/movie/*.avi
./node_modules/.bin/bun run tools/verify-mpeg1.ts --hashes /home/user/work/mpeg1_oracle.json   # 30 movies, 18,514 pictures, ~22 s
./tools/setup-browser.sh                                                              # puppeteer-core + headless Chromium with WebGPU (SwiftShader), ~1 min (tools/browser.mjs runs it when missing)
./node_modules/.bin/bun run tools/browser-test.ts --shots /home/user/work/shots       # 22 checks of apps/client + apps/server in the browser, ~21 s
./node_modules/.bin/bun run apps/server/src/main.ts --port 8080                       # the asset viewer on http://localhost:8080/ (needs a WebGPU browser for the mesh previews)
```
