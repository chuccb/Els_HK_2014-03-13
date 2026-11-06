# Roadmap

Scope decisions (confirmed with the project owner): **hybrid** (the C++ engine of the exe is re-implemented in TypeScript, the
game logic that lives in the client's Lua scripts runs unmodified; the server is a new Bun implementation), delivered as a
**vertical slice** first (boot -> login -> character select, then one field/dungeon), server persistence with **bun:sqlite**,
and **faithful** behaviour (reproduce the exe, verified against the decompile).

Status legend: `done` verified, `partial` works but not fully verified, `todo`.

## Phase 1 - Foundation

| Item | Status | Verification |
|---|---|---|
| 1a `@els/kom`: KOM archive reader (zlib, XORCRC algorithm 2, Adler-32, HTTP range source) | done | all 173 archives / 97,891 entries: size + Adler-32 OK (`tools/verify-kom.ts`) |
| 1a `@els/lua`: LuaJIT 2.0.2 bytecode loader/disassembler | done | identical to the oracle's `jit.bc` listing for all 4,498 scripts (`tools/verify-lua-bytecode.ts`) |
| 1a `@els/lua`: interpreter (every opcode that can occur in a precompiled file; the JIT-only `I*`/`J*` loop and function variants never occur), error context, coroutines, metamethods | partial | 9 differential tests + the stub-environment corpus (3 flavors x 4,498 scripts, all byte-identical to the native oracle), see FINDINGS sections 4 and 6 |
| 1a standard libraries (base, string incl. patterns/format, table, math, bit, coroutine, os/io/debug subset, package/module) | partial | same; the library surface (names) equals the oracle's; `debug`/`io`/`os`/`package` are approximate |
| 1b Lua **source** compiler (port of `lj_lex.c` / `lj_parse.c`), needed for `data/TutorSystem.lua`, `GameOption*.txt`, `loadstring` | todo | bit-exact bytecode vs `luajit -b -s` on a source corpus |
| 1c yield inside metamethods / `for ... in` iterators implemented in Lua, weak tables, `__gc` | todo | differential tests |
| 1d performance baseline: per-frame cost of the AI/state scripts under the VM (the in-process corpus run executes ~44k script functions in about a minute) | todo | benchmark script |
| 1e numerics: `pow`/`exp`/`log`/trig through the CRT / x87 sequences of the exe instead of V8's libm (last-ulp differences) | todo | differential test against values captured from the exe |

## Phase 2 - Asset decoders (`packages/assets`)

Census of the KOMs (`bun run tools/census.ts`): `tga` 23,784 (2.4 GB), `dds` 31,593, `x` 13,305 (1.2 GB meshes), `y` 13,148
(animation), `ogg` 5,625, `lua` 4,498, `xet` 4,552, `tet` 1,247, `wav` 67, particle/XMeshPlayer `txt` 40, `kim` 1 (`item.kim`,
18 MB), fonts 5, `fx` 4, plus loose `data/ui`, `data/movie` (30 MPEG-1), `data/music`, `general.ess` (string table).

| Format | Notes | Status |
|---|---|---|
| TGA | all 23,784 must decode; cross-check with a reference decoder | todo |
| DDS (DXT1/3/5, A8R8G8B8, ...) | upload as WebGPU BC textures or software-decode | todo |
| X meshes (`.x`, `.y`) | formats of `CKTDXDeviceXMesh` / `CKTDXDeviceXSkinMesh`, MSZIP-compressed blocks | todo |
| XET / TET | text templates parsed by the exe | todo |
| particle / XMeshPlayer text scripts (39 `.txt` entries, e.g. `GameMajorParticle*.txt`), `item.kim` (18 MB, "KIM"), `general.ess` (string table, algorithm known) | custom parsers in the exe (`CKTDGParticleSystem`, `CKTDGXMeshPlayer`, `CKTDXStringTable`) | todo |
| audio | `ogg`/`wav` are decoded by the browser (WebAudio) | todo |
| MPEG-1 movies | software decoder | todo |

Acceptance: every file of the type decodes; outputs compared with independent decoders or checksums where possible.

## Phase 3 - Graphics: D3D9-compatible layer on WebGPU (`packages/gfx`)

Fixed-function + the game's `.fx` effects (e.g. `GCSkin.fx`) mapped to WGSL; render states, texture stages, vertex declarations,
skinned meshes, sprite/particle rendering, render targets. Tested with Dawn on lavapipe in the sandbox (image diffs).

## Phase 4 - UI framework

`CKTDGUIDialog` family driven by the `DLG_*.lua` scripts (textures from `.tet` templates), fonts, IME, controls, layout at
the original resolutions.

## Phase 5 - `lua_tinker`-equivalent host API

Ground truth, extracted from the decompile by `tools/bindings.py` (`docs/HOST_API.md`, `docs/host_api.tsv`): the exe registers
**122 classes with 1,418 methods and 34 fields, 93 global objects, 5 global functions and 19 global constants** in 81 functions
(`CKTDXApp::RegisterLuabind`, `CX2Main::RegisterLuabind`, and the `OpenScriptFile` of every manager, which declares the globals
`g_pItemManager`, `g_pWorld`, ... for the script it is about to run). Every method row carries the C++ function and its IDA address.
`docs/SCRIPT_API_USAGE.md` (`tools/api-census.ts`) shows what the 4,498 scripts actually use, `docs/SCRIPT_GRAPH.md`
(`tools/script-graph.ts`) which scripts the exe loads. Findings that shape the work:

* The scripts are mostly **declarative data** (item/NPC/quest/skill/world templets, particle and UI definitions) fed to the C++
  managers through `AddXxxTemplet(...)` calls; only 176 global names are read without being assigned by a script, and 55 of
  them are the `g_p*` manager objects. The work is therefore the *managers* (templet parsing and validation), not a large API.
* Enum constants (`XUF_DODUM_*`, world ids, ...) come from `Enum.lua` / `DungeonEnum.lua` (`CX2Main::LoadLuaEnum`), not from the
  exe; the exe itself registers only `NF_*` (nation flags: `NF_HK` = 769) and a few more constants.
* Scripts call methods the exe does **not** register (`AddSpawnMonsterGroup` x522, `AddRandomSocketGroupInfo`, `AddWeddingHallItem`,
  ...). Those scripts belong to other builds and are not reachable from this exe's loader (checked on the load graph); the port must
  not invent the missing methods: the original fails with `attempt to call method 'X' (a nil value)`.
* Method names of the exe and of the scripts must match exactly, including typos (`AddSocektGroupDataForCashAvatar_LUA`).
* Argument types come from the `lua_tinker::functor/mem_functor` templates (`float`, `D3DXVECTOR3`, `char const *`, enums, ...);
  `D3DXVECTOR2/3/COLOR` are userdata with `x/y/z` fields registered through `class_mem`.

Plan: generate typed TS stubs from `docs/host_api.tsv`, then implement the managers in the order the boot and the slice need them
(see phase 6); the ledger (`docs/LEDGER.md`) tracks the C++ classes.

## Phase 6 - Boot, login, character select (the slice)

`CX2StateStartUp`, `CX2StateLogin`, `CX2StateJoin`, server select, character select, with `apps/server` implementing the
client's packet protocol subset (`ENUM_EVENT_ID`, `SERVER_EVENT_ID`) over WebSocket and persisting to bun:sqlite.

## Later

Field/dungeon gameplay (physics, `KGCLineMap`, units, skills, AI), sound, networking breadth, anything the slice needs next.

## Platform stubs

Anti-cheat, crash reporting (BugTrap / KncCrashRpt / SMTP), auto patcher (WinINet), machine id, DX enumeration,
CPU/GPU benchmark and registry access are stubbed; DirectInput / IMM32 / Win32 map to the DOM; FMOD maps to WebAudio. See
`docs/PORTING_RULES.md` section 4. Reference screenshots, videos and packet captures from the real game would help verify
phases 3-6 (rendering, UI layout, protocol) - none are in the repository.
