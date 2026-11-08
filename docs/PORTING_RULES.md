# Porting rules

The goal is a *faithful* re-implementation of the Elsword HK client (`data/x2.exe`, build of 2014-03-13) that runs the
original KOM archives and Lua scripts **unmodified**. "Faithful" means: reproduce what the executable does, as read from
the Hex-Rays export `data/x2.exe.c` / `data/x2.exe.h`, and verify it - not "make something that looks similar".

## 1. Source of truth, in order

1. **The decompile** (`data/x2.exe.c`, `.h`). Every behaviour that is ported cites the function address (`//----- (ADDR)`
   marker, 8 hex digits) and, when helpful, the line number in the export. `tools/index_decomp.py` builds an
   address -> name -> line index. **The decompile can be wrong**: Hex-Rays loses XMM / x87 arguments of calls and confuses `float` with
   `double` in SSE code (`OptimizeKeys`, FINDINGS 16.2), so for float-heavy functions read the machine code (`tools/disasm.py START END`).
2. **The data** (`data/*.kom`, `data/ui`, `data/movie`, ...). Formats are confirmed by parsing *every* file of that type,
   not a sample. A decoder is "done" when the whole corpus decodes and an independent check (checksum, reference decoder,
   round trip) agrees.
3. **A native oracle** where one can be built from public source. For Lua this is LuaJIT 2.0.2 itself
   (`tools/setup-oracle.sh`, commit `21af151`, the version string found in the exe), patched only where the exe is
   32-bit/MSVC (`long` is 32 bit, `strtoul`, bytecode header). Differential tests compare the TS implementation against it.
3b. **The exe's own machine code, run on a CPU emulator**, for a pure function whose imports can be stubbed (`tools/peemu.py`, Unicorn; PE mapped
   at its preferred base, so the addresses are those of the decompile). This is the strongest oracle there is, because it *is* the original: the port
   of `OptimizeKeys` is compared with it bit for bit (FINDINGS 16.3), and so is the part of FreeType the exe's text path uses, from the font file to the pixels
   (`tools/oracle-freetype.py`, FINDINGS 17.11: the exe's `FT_Load_Glyph` and `FT_Render_Glyph` run on real fonts, then on generated ones that make the
   port enter every instruction the real ones never do). Say in the docs which imports were replaced by models, because the
   comparison does not cover those. A comparison is only as good as the inputs: count what the inputs make the code do (which instructions ran, which
   branches), and where the real data never reaches a branch, generate data that does (`packages/freetype/test/synth.ts`).
4. Public documentation / memory of other engines come last, and never override 1-3b.

## 2. Rules

* **Reproduce, do not improve.** Quirks of the exe (error texts, `%d` wrapping at 32 bit, table iteration order, `:0:`
  positions caused by stripped bytecode, ...) are part of the contract because scripts and data were tuned against them.
* **32-bit Windows semantics** are the reference: `int`/`long`/pointer are 32 bit, `float` arithmetic in the engine is
  single precision where the exe uses `float` (use `Math.fround` at the same points), UCRT `printf` for number formatting,
  Windows case-insensitive file names (KOM names are matched upper-cased).
* **Port per function, keep the mapping.** Every ported unit has a row in `docs/LEDGER.md` (generated from
  `docs/ledger.tsv` by `tools/ledger.py`): IDA address, name, TS symbol, verification. Unported = a row with status `todo`;
  deliberately not ported = status `n/a` with a reason. Nothing is silently skipped.
* **No fabricated assets or scripts.** If something is missing from `data/`, say so in `docs/FINDINGS.md`; do not invent it.
* **OS / vendor modules are stubbed behind a named interface** (see section 4) and listed in the ledger as `stub`.
* **Everything that can be verified automatically must be.** New code lands with one of: a differential test against the
  oracle, a corpus verification script in `tools/` (like `verify-kom.ts`), or a unit test with expected values taken from
  the decompile or from the data. State what was *not* verified in the commit message / docs.
* **The host API is exactly what the exe registers.** `docs/host_api.tsv` (generated from the decompile) lists every class, method,
  field, global function, constant and object that scripts can see. Do not add anything that is not in it, even when a script
  calls it: the original raises `can't find 'X' class variable. (forgot registering class variable ?)` (`lua_tinker::meta_get`; `packages/host` does the same, see `docs/HOST_API.md`, "members the exe does not register").
* **Be explicit about gaps.** A known deviation goes into `docs/FINDINGS.md` ("Known gaps") the moment it is discovered.
* TypeScript is strict (`strict`, `isolatedModules`, `verbatimModuleSyntax`). Binary data is `Uint8Array`/`DataView`; Lua
  strings are JS *byte strings* (one UTF-16 code unit per byte, 0-255). No `any` in package APIs.

## 2b. Rules for the graphics layer (`packages/d3d9`)

* **Direct3D 9 is the contract, not WebGPU.** The ported engine code calls `Direct3DDevice9` / D3DX with the original names, argument order and
  `HRESULT`s; nothing outside `packages/d3d9` touches WebGPU. Where WebGPU cannot express a D3D9 behaviour the layer emulates it (half-pixel
  offset, `D3DTOP` cascade in WGSL, triangle fans, BGRA / 16-bit formats, Lock / renaming rules, `D3DUSAGE_DYNAMIC` buffers).
* **No oracle exists on this machine** (no Windows, no D3D9 runtime, no reference screenshots), so a device behaviour is verified against
  (1) the D3D9 documentation turned into an analytic expectation (lighting, fog, blend, filters, formats) or a CPU reference, and (2) the exact
  call sequences of the exe. A choice the documentation leaves open is a *flagged assumption* in FINDINGS section 12 and has a test that pins it.
* **Wine's d3dx9 tests are the one source of native D3DX behaviour.** `dlls/d3dx9_36/tests/*.c` of `wine-mirror/wine` must also pass on real
  Windows, so what they expect is what d3dx9 does (`gh api -H "Accept: application/vnd.github.raw" repos/wine-mirror/wine/contents/dlls/d3dx9_36/tests/mesh.c`;
  Wine's *implementation* is only as good as its tests - its controller and `ConvertToIndexedBlendedMesh` are stubs). Before writing a D3DX behaviour
  from the documentation, look there; copy no code (LGPL), re-type the X files and the expected numbers into a test and say so in its header
  (`packages/d3d9/test/loader-native.test.ts` is the model).
* **Every feature the layer does not emulate is reported once through the device's `warn` hook** instead of silently drawing something else.
* **GPU tests skip without an adapter** (`gpuAvailable()`); run them with `./tools/gpu.sh`. A test that saves a picture does so only when
  `D3D9_TEST_OUT` is set, so the suite never writes into the repository.
* Reference screenshots / videos of the real client would turn the assumptions into checks; none are in the repository.

## 2c. Rules for the host classes and the UI classes (`packages/host`, `packages/ui`)

* **A host class is a TS class whose methods carry the registered Lua names** (keep a `_LUA` suffix where the registry has it; a lower camel name is a C++ member that registered functions call), `implements Partial<Class_Methods>`, and is
  registered with `registerImpl(cppClass, TsClass)`. It implements *all* the methods the exe registers for the class, called by a script or not, and nothing else. Method totals count distinct Lua names (the exe registers
  `CKTDGUISlot::SetDraggingSlotColor` twice).
* **A script counts as ported only when every method it calls is ported, and that is shown by running the real script in strict mode** (`tools/ui-census.ts`, `packages/ui/test/census.test.ts`). Record mode counts a stub's inherited-method call
  as ported, so it is a census, not a proof. One manager at a time, each checked by the real scripts it serves.
* **Per method:** `python3 tools/decomp.py ADDR --clean` (addresses are in `docs/host_api.tsv`); `tools/structs.py OUTER_CLASS` and `tools/layout.py CLASS --find OFF` for the member behind a `*((_DWORD *)this + N)`; `tools/cstr-uses.py ADDR` for a
  `const char*` that may be NULL; `tools/vtstr.py CTOR N` for a `vftable[N]` literal; `tools/vtbl.py CTOR BASE_CTOR` for the overrides; `tools/disasm.py ADDR +0x10` for a one-line setter that identical code folding shares between classes (the decompile names
  the other class: check the offset it writes) and for float code that Hex-Rays gets wrong.
* **Hex-Rays pitfalls:** it duplicates tail code, reuses variables, leaks stack arguments into the next call, and shows `_LUA` methods that take a table with no parameters (they read `KLuaManager(L, 1, false)` from the stack). Exe bugs are kept, named in
  the class header and listed in FINDINGS 17.4; where the exe would dereference NULL the port throws a plain `Error` instead of reading garbage.
* **Tests:** one file per class (`widgets.test.ts`, `listbox.test.ts` are the model); real-data tests behind `test.skipIf(!haveData)`; live controls, textures and dialogs are compared through `is()` / `names()` / `some()`, never with `toEqual` /
  `toBe` (a failing comparison prints the whole world graph and bun is killed for memory). The whole suite runs through `tools/test-packages.sh`: `bun test` keeps everything its files load, and one process does not fit 4 GB.
* **Drawing is checked against a picture, not only against a log.** A device log worked out by hand is only as right as the state it starts from: the first logs of the render tests started from the Direct3D defaults, the exe starts from `akStates` (set by
  `CKTDGManager::OnResetDevice`), and only a drawn dialog showed it (the buttons' transparent texels came out as grey boxes). So dialogs are drawn through the device (`packages/ui/test-gpu`), every quad is composed again by a CPU reference written from the Direct3D 9 rules
  (`test-gpu/reference.ts`, itself pinned by hand-worked cases), and the PNG is looked at (`D3D9_TEST_OUT=<dir>`; `docs/img/ui-*.png`). When a picture looks wrong, find who sets the state in the decompile (`grep ms_adwRenderState[N]`, the `KStateID` tables) before touching the drawing code.
* **Behaviour that has no oracle gets a mutation check** (`tools/mutate-ui.py` is the shape: anchors that must match exactly once, a stated reason for every expected survivor, the source restored after each mutant); `tools/mutate-draw.py` does the same for the drawing and for the CPU reference). A mutant that survives because the test inputs were neutral (a factor of 1, an offset of 0, equal colour channels, a rectangle that is not skewed) is a gap in the test, not an equivalent mutant: give every input a different value (`mutate-draw.py` found six such gaps in tests that had passed review).

## 3. How to port a function (checklist)

1. Find it: `grep -n "<name>" /home/user/work/analysis/functions.tsv` (regenerate with `python3 tools/index_decomp.py
   data/x2.exe.c /home/user/work/analysis/functions.tsv`).
2. Read the decompile *and its callees/data* (`x2.exe.h` for structs and enums). Note stack/`__usercall` quirks.
3. Write the TS with a comment `// x2.exe.c L<line> <name> (<addr>)`.
4. Add the verification (see above) and run `bun run typecheck && bun run test`.
5. Update `docs/ledger.tsv` (embedded LuaJIT functions) or `docs/ledger-classes.tsv` (C++ classes); run `python3 tools/ledger.py`.

## 4. Platform boundaries (stubs)

| Original | Replaced by |
|---|---|
| Win32 windowing / messages / IMM32 / DirectInput | DOM events, `KeyboardEvent`/`PointerEvent`, `<input>` for IME |
| Direct3D 9 (`IDirect3DDevice9`, D3DX, the `.fx` effect) | `@els/d3d9`: a D3D9 / D3DX-compatible layer on WebGPU (phase 3, section 2b) |
| FMOD / ogg / wav | WebAudio |
| Anti-cheat (nProtect/HackShield class), BugTrap / KncCrashRpt / SMTP crash reporting | stubbed, always "ok" |
| Auto patcher (WinINet), machine-id, DX enumeration, CPU/GPU benchmark, registry | stubbed with fixed answers |
| Disk files in `data/` | `@els/kom` over `fetch` (HTTP range) or the file system |
| MPEG-1 movies (`data/movie`, played by `bdvid32.dll` in the exe) | software MPEG-1 decoder (`packages/assets`, verified against FFmpeg) -> texture |

The list of stubbed modules is part of the ledger so that a reader can see what is *not* original behaviour.
