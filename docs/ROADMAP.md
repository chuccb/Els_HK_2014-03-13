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

Census of the KOMs (`bun run tools/census.ts`): `tga` 23,784 (2.4 GB), `dds` 31,593, `x` 13,305 (skin meshes + animations, 1.2 GB), `y` 13,148
(static meshes), `ogg` 5,625, `lua` 4,498, `xet` 4,552, `tet` 1,247, `wav` 67, particle/XMeshPlayer `txt` 40, `kim` 1 (`item.kim`,
18 MB), fonts 5, `fx` 4, plus loose `data/ui`, `data/movie` (30 MPEG-1), `data/music`, `general.ess` (string table).

| Format | Notes | Status |
|---|---|---|
| TGA | done: 23,780 of 23,784 decode as TGA (the other 4 are BMP/JPEG under a `.tga` name); pixel-identical to Pillow except 16 bpp (rounding / alpha bit, FINDINGS section 8) | `packages/assets` (`tga.ts`), `tools/decode-images.ts`, `tools/verify-images.py` |
| DDS (DXT1/3/5, R8G8B8, A8R8G8B8, X8R8G8B8, A4R4G4B4) + BMP + PNG | done (level 0 only, as the exe asks D3DX for 1 mip level); identical to Pillow; JPEG (2 files) is left to the platform decoder; FourCC 63 bump map (1 file) and volume slices (45) are not decoded | `dds.ts`, `bmp.ts`, `png.ts`; GPU upload as BC textures comes with phase 3 |
| X-file container + generic reader (`.x` 12,274 / `.y` 13,039 DirectX-format files) | MSZIP (`bzip`) with the stored-block quirk, text + binary X templates and data objects; all 25,313 files parse, 0 errors, 0 mesh consistency problems (FINDINGS section 9) | `mszip.ts`, `inflate.ts`, `xfile.ts`, `tools/verify-xfiles.ts`, `tools/verify-xparse.ts` |
| KOG mesh formats: KME (109 `.y`), KSM (1,031 `.x`) + KAC animation block | decoded from the loaders (`LoadKMEMesh`, `LoadKSkinnedMesh`, `ReadKSM`, `UnpackKeys`); 1,140 files, 0 errors, 0 invariant violations | `ksm.ts`, `tools/verify-ksm.ts` |
| mesh semantics (todo): X `Mesh` -> vertex/index/attribute buffers with frame transforms (static `.y`), `SkinWeights` -> bones, `AnimationSet` -> keys (quaternion convention), `OptimizeKeys`, D3DX controller / track blending, weld + optimize of static meshes | needs the renderer to check against; assumptions are listed in FINDINGS section 9 | todo |
| XET / TET | done: binary tables (not text), 5,799 files parse with 0 structural problems; exact `FindAniDataIndex` (16 shipped files defeat it, kept) | `xet.ts`, `tools/verify-xet-tet.ts` |
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
