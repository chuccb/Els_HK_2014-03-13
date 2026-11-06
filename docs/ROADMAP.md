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
| 1a `@els/lua`: interpreter (all 93 opcodes except JIT-only ones), error context, coroutines, metamethods | partial | 8 differential tests + corpus run, see FINDINGS section 4 |
| 1a standard libraries (base, string incl. patterns/format, table, math, bit, coroutine, os/io/debug subset, package/module) | partial | same; `debug`/`io`/`os` approximate |
| 1b Lua **source** compiler (port of `lj_lex.c` / `lj_parse.c`), needed for `data/TutorSystem.lua`, `GameOption*.txt`, `loadstring` | todo | bit-exact bytecode vs `luajit -b -s` on a source corpus |
| 1c yield inside metamethods / `for ... in` iterators implemented in Lua, weak tables, `__gc` | todo | differential tests |
| 1d performance baseline: per-frame cost of the AI/state scripts under the VM | todo | benchmark script |

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
| particle / XMeshPlayer scripts, KSM/KME-like formats, `item.kim`, `general.ess` | custom parsers in the exe | todo |
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

The ~89k global names the scripts use (`g_pObjectMesh`, `D3DXVECTOR3`, `STATE_CHANGE_TYPE`, ...): constants/enums, classes and
methods of the exe's bindings, discovered from the `lua_tinker` registration code in the decompile and from the scripts that
call them. Generated tables + hand ports of the C++ behaviours.

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
