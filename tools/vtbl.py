#!/usr/bin/env python3
"""The virtual function table of a class, and which slots it overrides.

  PYTHONPATH=/home/user/work/pycap python3 tools/vtbl.py CTOR_ADDR [BASE_CTOR_ADDR] [--all]

CTOR_ADDR is the constructor (the first `mov dword ptr [reg], imm32` into .rdata is the vtable, as in tools/vtstr.py).  Prints
`slot  address  name` for the slots of the table (it ends at the first entry that is not code).  With BASE_CTOR_ADDR only the slots whose
function differs from the base class's are printed (the overrides: the functions a Lua call to the base-class method really reaches);
--all prints every slot and marks the overrides with `*`.  Names come from /home/user/work/analysis/functions.tsv (an identical-code-folded
function carries the name of one of its twins).
"""
import re
import sys

import capstone
import pefile

exe = __file__.rsplit("/tools/", 1)[0] + "/data/x2.exe"
pe = pefile.PE(exe, fast_load=True)
base = pe.OPTIONAL_HEADER.ImageBase
FUNCS = "/home/user/work/analysis/functions.tsv"


def read(va, n):
    return pe.get_data(va - base, n)


def section(va):
    for s in pe.sections:
        if base + s.VirtualAddress <= va < base + s.VirtualAddress + s.Misc_VirtualSize:
            return s
    return None


def vtable_of(ctor):
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    for ins in md.disasm(read(ctor, 0x200), ctor):
        if ins.mnemonic == "mov" and ins.op_str.startswith("dword ptr [") and ", 0x" in ins.op_str:
            imm = int(ins.op_str.rsplit(", ", 1)[1], 16)
            s = section(imm)
            if s is not None and s.Name.startswith(b".rdata"):
                return imm
    sys.exit(f"no vtable store in {ctor:#x}")


def slots(vt):
    out = []
    for i in range(0, 400):
        ptr = int.from_bytes(read(vt + 4 * i, 4), "little")
        s = section(ptr)
        if s is None or not (s.Characteristics & 0x20000000):  # IMAGE_SCN_MEM_EXECUTE
            break
        out.append(ptr)
    return out


names = {}
try:
    for line in open(FUNCS, encoding="utf-8", errors="replace"):
        a = line.rstrip("\n").split("\t")
        if len(a) >= 4:
            m = re.search(r"([\w:~<>,\* ]+?)\(", a[3])
            parts = m.group(1).split() if m else []
            names[int(a[0], 16)] = (parts[-1] if parts else a[3])[:80]
except FileNotFoundError:
    pass


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    show_all = "--all" in sys.argv
    vt = vtable_of(int(args[0], 16))
    mine = slots(vt)
    theirs = slots(vtable_of(int(args[1], 16))) if len(args) > 1 else None
    print(f"vtable {vt:#x}: {len(mine)} slots")
    for i, p in enumerate(mine):
        over = theirs is not None and (i >= len(theirs) or theirs[i] != p)
        if theirs is not None and not over and not show_all:
            continue
        mark = "*" if over else " "
        print(f"{i:3d}{mark} {p:#x}  {names.get(p, '?')}")


main()
