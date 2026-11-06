#!/usr/bin/env python3
"""Generate the coverage ledger of the port, keyed by IDA address.

    python3 tools/ledger.py [functions.tsv]        (default /home/user/work/analysis/functions.tsv)

Inputs
  functions.tsv          address, first line, last line, signature of every function of data/x2.exe.c
                         (python3 tools/index_decomp.py data/x2.exe.c /home/user/work/analysis/functions.tsv)
  docs/ledger.tsv        rules for the embedded LuaJIT runtime: regex on the function name -> status, TS location,
                         verification, note (first matching rule wins)
  docs/ledger-classes.tsv rules for the C++ engine: regex on the class name -> status, TS location, note (first match wins,
                         default `todo`)

Outputs
  docs/LEDGER.md         summary + every ported LuaJIT function by address + the C++ classes by function count
  docs/ledger-classes.generated.tsv   every C++ class with its function count, address range and status

Status values: done (ported and verified as noted), partial (ported with known gaps), stub (platform stub, see
docs/PORTING_RULES.md), n/a (deliberately not ported; reason in the note), todo.
"""
import collections
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNCS = sys.argv[1] if len(sys.argv) > 1 else "/home/user/work/analysis/functions.tsv"


def name_of(sig: str) -> str:
    """Function name of a Hex-Rays signature, e.g. `int __cdecl A::B<int, char>::f(int)` -> `A::B<int, char>::f`."""
    i = sig.find("(")
    head = re.sub(r"@<\w+>", "", sig[:i] if i >= 0 else sig)
    toks, cur, depth = [], "", 0
    for ch in head:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        if ch in " *&" and depth == 0:
            if cur:
                toks.append(cur)
                cur = ""
        else:
            cur += ch
    if cur:
        toks.append(cur)
    return toks[-1] if toks else sig


def class_of(name: str) -> str:
    """Class (or namespace) of `A::B<T>::method`: everything before the last top-level `::`."""
    depth, cut = 0, -1
    for i, ch in enumerate(name):
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        elif ch == ":" and depth == 0 and name[i : i + 2] == "::":
            cut = i
    return name[:cut] if cut > 0 else name


def load_rules(path):
    rules = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            while len(cols) < 5:
                cols.append("")
            rx, status, ts, ver, note = cols[:5]
            rules.append((re.compile(rx), status, ts, ver, note))
    return rules


def classify(rules, name):
    for rx, status, ts, ver, note in rules:
        if rx.search(name):
            return status, ts, ver, note
    return None


funcs = []
with open(FUNCS, encoding="utf-8") as f:
    for line in f:
        addr, start, end, sig = line.rstrip("\n").split("\t")
        funcs.append((addr, int(start), int(end), sig, name_of(sig)))

# ---------------------------------------------------------------- LuaJIT runtime
lua_rules = load_rules(os.path.join(ROOT, "docs", "ledger.tsv"))
lua_names = re.compile(
    r"^(lj_|lua_(?!tinker)|luaL_|luaopen_|ffh_|recff_|fold_|asm_|emit_|ir_|snap_|rec_|gc_|cp_|ctype_|trace_|"
    r"bcread_|cpparser|reader_|strscan_|io_|alloc_|tmalloc_|prepend_alloc|segment_holding|add_segment|release_unused|"
    r"setptmode|callhook|fillbuf|save_grow|adjuststack|panic$)"
)
by_status = collections.Counter()
by_group = collections.defaultdict(lambda: collections.Counter())
lua_rows = []
unclassified = []
for addr, s, e, sig, name in funcs:
    if "::" in name or not lua_names.search(name):
        continue
    c = classify(lua_rules, name)
    if c is None:
        unclassified.append((addr, name))
        by_status["unclassified"] += 1
        continue
    status, ts, ver, note = c
    by_status[status] += 1
    if status in ("done", "partial", "stub", "todo"):
        lua_rows.append((addr, s, name, status, ts, ver, note))
    by_group[note.split(";")[0] if status == "n/a" else status][status] += 1

# ---------------------------------------------------------------- C++ classes
cls_rules = load_rules(os.path.join(ROOT, "docs", "ledger-classes.tsv"))
classes = collections.OrderedDict()
n_cpp = 0
for addr, s, e, sig, name in funcs:
    if "::" not in name:
        continue
    cls = class_of(name)
    c = classes.setdefault(cls, {"n": 0, "first": addr, "line": s, "lines": 0})
    c["n"] += 1
    c["lines"] += e - s + 1
    n_cpp += 1
cls_status = {}
for cls, c in classes.items():
    r = classify(cls_rules, cls)
    cls_status[cls] = r if r else ("todo", "", "", "")
cstat_funcs = collections.Counter()
cstat_classes = collections.Counter()
for cls, c in classes.items():
    st = cls_status[cls][0]
    cstat_funcs[st] += c["n"]
    cstat_classes[st] += 1

with open(os.path.join(ROOT, "docs", "ledger-classes.generated.tsv"), "w", encoding="utf-8") as o:
    o.write("class\tfunctions\tbody_lines\tfirst_address\tstatus\tts\tnote\n")
    for cls, c in sorted(classes.items(), key=lambda kv: -kv[1]["n"]):
        st, ts, ver, note = cls_status[cls]
        o.write(f"{cls}\t{c['n']}\t{c['lines']}\t{c['first']}\t{st}\t{ts}\t{note}\n")

# ---------------------------------------------------------------- LEDGER.md
total_lua = sum(by_status.values())
md = []
md.append("# Coverage ledger (generated by `tools/ledger.py` - do not edit)\n")
md.append("Keyed by the function address of the Hex-Rays export `data/x2.exe.c` (`//----- (ADDR)` markers). The rules live in "
          "`docs/ledger.tsv` (embedded LuaJIT) and `docs/ledger-classes.tsv` (C++ engine); update them when porting.\n")
md.append(f"The export contains **{len(funcs)}** functions: **{total_lua}** belong to the embedded LuaJIT 2.0.2 / C runtime "
          f"(by name), **{n_cpp}** are methods of **{len(classes)}** C++ classes, the rest are free functions / CRT.\n")
md.append("## Embedded LuaJIT 2.0.2 runtime\n")
md.append("| status | functions |\n|---|---|")
for st in ("done", "partial", "stub", "n/a", "todo", "unclassified"):
    if by_status[st]:
        md.append(f"| {st} | {by_status[st]} |")
md.append("")
md.append("Deliberately not ported (`n/a`): the JIT compiler and its IR/assembler (the VM is an interpreter, which LuaJIT guarantees "
          "to be semantically equivalent; nothing in the client reads `jit.*`), the FFI (flag 0 in all 4,498 scripts), the garbage "
          "collector and allocator (JS GC), and the C API used by the engine's own bindings (replaced by the host API of phase 5).\n")
md.append("### Ported / partial / todo functions by address\n")
md.append("| address | function | status | TS | verification | note |\n|---|---|---|---|---|---|")
for addr, s, name, st, ts, ver, note in sorted(lua_rows):
    md.append(f"| {addr} | `{name}` (L{s}) | {st} | {ts} | {ver} | {note} |")
md.append("")
if unclassified:
    md.append(f"### Unclassified ({len(unclassified)})\n")
    md.append(", ".join(f"`{n}`@{a}" for a, n in sorted(unclassified)) + "\n")
failed = [(a, s, sig) for a, s, e, sig, n in funcs if sig.startswith("#error")]
md.append(f"## Functions the decompiler could not handle ({len(failed)})\n")
md.append("`#error` bodies in the export (mostly \"call analysis failed\"): their logic is not available in `x2.exe.c` and needs disassembly of "
          "`data/x2.exe` if the port depends on them.\n")
md.append(", ".join(f"{a} (L{s})" for a, s, sig in failed) + "\n")
md.append("## C++ engine classes\n")
md.append(f"{len(classes)} classes / {n_cpp} methods. Status by class: " +
          ", ".join(f"{k} {v}" for k, v in sorted(cstat_classes.items())) + "; by method: " +
          ", ".join(f"{k} {v}" for k, v in sorted(cstat_funcs.items())) + ".\n")
md.append("The complete list is `docs/ledger-classes.generated.tsv`. The 60 largest classes:\n")
md.append("| class | methods | first address | status | TS / note |\n|---|---|---|---|---|")
for cls, c in sorted(classes.items(), key=lambda kv: -kv[1]["n"])[:60]:
    st, ts, ver, note = cls_status[cls]
    md.append(f"| `{cls}` | {c['n']} | {c['first']} | {st} | {ts} {note} |")
md.append("")
with open(os.path.join(ROOT, "docs", "LEDGER.md"), "w", encoding="utf-8") as o:
    o.write("\n".join(md) + "\n")
print(f"functions={len(funcs)} lua-runtime={total_lua} {dict(by_status)} classes={len(classes)} methods={n_cpp} "
      f"class-status={dict(cstat_classes)}")
