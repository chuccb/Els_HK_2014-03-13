# Porting rules

The goal is a *faithful* re-implementation of the Elsword HK client (`data/x2.exe`, build of 2014-03-13) that runs the
original KOM archives and Lua scripts **unmodified**. "Faithful" means: reproduce what the executable does, as read from
the Hex-Rays export `data/x2.exe.c` / `data/x2.exe.h`, and verify it - not "make something that looks similar".

## 1. Source of truth, in order

1. **The decompile** (`data/x2.exe.c`, `.h`). Every behaviour that is ported cites the function address (`//----- (ADDR)`
   marker, 8 hex digits) and, when helpful, the line number in the export. `tools/index_decomp.py` builds an
   address -> name -> line index.
2. **The data** (`data/*.kom`, `data/ui`, `data/movie`, ...). Formats are confirmed by parsing *every* file of that type,
   not a sample. A decoder is "done" when the whole corpus decodes and an independent check (checksum, reference decoder,
   round trip) agrees.
3. **A native oracle** where one can be built from public source. For Lua this is LuaJIT 2.0.2 itself
   (`tools/setup-oracle.sh`, commit `21af151`, the version string found in the exe), patched only where the exe is
   32-bit/MSVC (`long` is 32 bit, `strtoul`, bytecode header). Differential tests compare the TS implementation against it.
4. Public documentation / memory of other engines come last, and never override 1-3.

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
* **Be explicit about gaps.** A known deviation goes into `docs/FINDINGS.md` ("Known gaps") the moment it is discovered.
* TypeScript is strict (`strict`, `isolatedModules`, `verbatimModuleSyntax`). Binary data is `Uint8Array`/`DataView`; Lua
  strings are JS *byte strings* (one UTF-16 code unit per byte, 0-255). No `any` in package APIs.

## 3. How to port a function (checklist)

1. Find it: `grep -n "<name>" /home/user/work/analysis/functions.tsv` (regenerate with `python3 tools/index_decomp.py
   data/x2.exe.c /home/user/work/analysis/functions.tsv`).
2. Read the decompile *and its callees/data* (`x2.exe.h` for structs and enums). Note stack/`__usercall` quirks.
3. Write the TS with a comment `// x2.exe.c L<line> <name> (<addr>)`.
4. Add the verification (see above) and run `bun run typecheck && bun run test`.
5. Update `docs/ledger.tsv`; run `python3 tools/ledger.py`.

## 4. Platform boundaries (stubs)

| Original | Replaced by |
|---|---|
| Win32 windowing / messages / IMM32 / DirectInput | DOM events, `KeyboardEvent`/`PointerEvent`, `<input>` for IME |
| Direct3D 9 (`IDirect3DDevice9`, effects `.fx`) | a D3D9-compatible layer on WebGPU (phase 3) |
| FMOD / ogg / wav | WebAudio |
| Anti-cheat (nProtect/HackShield class), BugTrap / KncCrashRpt / SMTP crash reporting | stubbed, always "ok" |
| Auto patcher (WinINet), machine-id, DX enumeration, CPU/GPU benchmark, registry | stubbed with fixed answers |
| Disk files in `data/` | `@els/kom` over `fetch` (HTTP range) or the file system |
| MPEG-1 movies (`data/movie`) | software MPEG-1 decoder -> texture |

The list of stubbed modules is part of the ledger so that a reader can see what is *not* original behaviour.
