#!/usr/bin/env python3
"""Read what Hex-Rays shows as `Class::`vftable'[N]`: a string (or other data) that sits right after the class's vtable.

  PYTHONPATH=/home/user/work/pycap python3 tools/vtstr.py CTOR_ADDR N [M ...]

CTOR_ADDR is the constructor (any function that stores the vtable pointer into `this` with `mov dword ptr [reg], imm32`); the first such
immediate in .rdata is the vtable, element N is `vtable + 4 * N` -- for a literal the address of the characters.  Prints the wide and the
narrow reading of the data at that address.
"""
import sys

import capstone
import pefile

exe = __file__.rsplit("/tools/", 1)[0] + "/data/x2.exe"
pe = pefile.PE(exe, fast_load=True)
base = pe.OPTIONAL_HEADER.ImageBase


def read(va, n):
    return pe.get_data(va - base, n)


def in_rdata(va):
    for s in pe.sections:
        if s.Name.startswith(b".rdata") and base + s.VirtualAddress <= va < base + s.VirtualAddress + s.Misc_VirtualSize:
            return True
    return False


if len(sys.argv) < 3:
    sys.exit(__doc__)
ctor = int(sys.argv[1], 16)
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
md.detail = True
vt = None
for ins in md.disasm(read(ctor, 0x200), ctor):
    if ins.mnemonic == "mov" and ins.op_str.startswith("dword ptr [") and ", 0x" in ins.op_str:
        imm = int(ins.op_str.rsplit(", ", 1)[1], 16)
        if in_rdata(imm):
            vt = imm
            break
if vt is None:
    sys.exit("no vtable store found in the first 0x200 bytes")
print("vtable", hex(vt))
for a in sys.argv[2:]:
    n = int(a)
    slot = vt + 4 * n
    raw = read(slot, 4)
    ptr = int.from_bytes(raw, "little")
    b = read(slot, 128)
    wide = b.decode("utf-16le", errors="replace").split("\x00")[0]
    narrow = b.split(b"\x00")[0].decode("latin1")
    print(f"[{n}] at {hex(slot)}: dword {hex(ptr)}  wide={wide!r}  narrow={narrow!r}")
