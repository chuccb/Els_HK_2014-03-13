#!/usr/bin/env python3
"""Who calls a function of x2.exe, or points at it?

  PYTHONPATH=/home/user/work/pycap python3 tools/xrefs.py ADDR_OR_NAME...

A target is an address (`32D62C10`, `0x32D62C10`) or a name that occurs in exactly one function signature of data/x2.exe.c
(`CX2MemoryHolder::GetVillageMapFrontDLG`).  Per target the tool prints

  * every `call rel32` (E8) and `jmp rel32` (E9, a tail call or a thunk) whose destination is the target, with the function that
    contains the instruction (the last function of the decompile that starts at or before it), and
  * every 4-byte little-endian copy of the target's address in any section: a vtable slot, a table of function pointers, a
    `push imm32` / `mov reg, imm32` that takes the address (x86-32 code holds absolute addresses, so this is all there is; the
    image has no position-independent code).

No line at all for a target means that nothing in the exe can reach it, short of code that builds the address at run time (the
exe has none that does for a member function).  The scan is a byte-pattern search: a hit may in theory sit inside another
instruction, so look at a surprising one with `tools/disasm.py ADDR +0x20`.  Indirect calls through a vtable show up as the slot.

Used for FINDINGS 17.30: the four `CX2MemoryHolder::Get{Village,Local}Map{Back,Front}DLG` functions that open the only two of the
32 state scripts named by the exe have no caller and no pointer; `ReleaseLocalMapDLG` has one caller.
"""
import bisect
import os
import re
import struct
import sys

import pefile

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def load_index() -> tuple[list[int], list[str]]:
    """The functions of the decompile: start addresses (sorted) and their first signature line."""
    starts: list[int] = []
    sigs: list[str] = []
    marker = re.compile(r"^//----- \(([0-9A-Fa-f]{8})\) -+$")
    want_sig = False
    with open(os.path.join(root, "data", "x2.exe.c"), encoding="utf-8", errors="replace") as f:
        for line in f:
            m = marker.match(line)
            if m:
                starts.append(int(m.group(1), 16))
                sigs.append("")
                want_sig = True
                continue
            if want_sig and line.strip() and not line.startswith("//"):
                sigs[-1] = line.strip()
                want_sig = False
    order = sorted(range(len(starts)), key=lambda i: starts[i])
    return [starts[i] for i in order], [sigs[i] for i in order]


def resolve(arg: str, starts: list[int], sigs: list[str]) -> int:
    a = arg.upper().removeprefix("0X")
    if re.fullmatch(r"[0-9A-F]{8}", a):
        return int(a, 16)
    hits = [i for i, s in enumerate(sigs) if arg in s]
    if len(hits) != 1:
        sys.exit(f"{arg!r}: {len(hits)} functions match" + "".join(f"\n  {starts[i]:08X} {sigs[i][:120]}" for i in hits[:8]))
    return starts[hits[0]]


def owner(addr: int, starts: list[int], sigs: list[str]) -> str:
    i = bisect.bisect_right(starts, addr) - 1
    if i < 0:
        return "(before the first function)"
    name = re.sub(r"\s+", " ", sigs[i])[:110]
    return f"{starts[i]:08X} {name} +0x{addr - starts[i]:X}"


def main() -> None:
    targets_arg = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not targets_arg:
        sys.exit(__doc__)
    starts, sigs = load_index()
    targets = {resolve(a, starts, sigs): a for a in targets_arg}
    pe = pefile.PE(os.path.join(root, "data", "x2.exe"), fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    with open(os.path.join(root, "data", "x2.exe"), "rb") as f:
        data = f.read()
    found: dict[int, list[str]] = {t: [] for t in targets}
    for sec in pe.sections:
        name = sec.Name.rstrip(b"\0").decode()
        raw = data[sec.PointerToRawData : sec.PointerToRawData + sec.SizeOfRawData]
        va0 = base + sec.VirtualAddress
        if sec.Characteristics & 0x20000000:  # IMAGE_SCN_MEM_EXECUTE
            for opcode, kind in ((b"\xe8", "call"), (b"\xe9", "jmp")):
                i = 0
                while True:
                    i = raw.find(opcode, i)
                    if i < 0 or i + 5 > len(raw):
                        break
                    dest = (va0 + i + 5 + struct.unpack_from("<i", raw, i + 1)[0]) & 0xFFFFFFFF
                    if dest in found:
                        found[dest].append(f"{kind:4} from {va0 + i:08X} in {owner(va0 + i, starts, sigs)}")
                    i += 1
        for t in targets:
            pattern = struct.pack("<I", t)
            j = 0
            while True:
                j = raw.find(pattern, j)
                if j < 0:
                    break
                found[t].append(f"ptr  at   {va0 + j:08X} in {name}" + (f" ({owner(va0 + j, starts, sigs)})" if sec.Characteristics & 0x20000000 else ""))
                j += 1
    for t, arg in targets.items():
        print(f"== {t:08X} {owner(t, starts, sigs).rsplit(' +', 1)[0][9:]}")
        for line in found[t] or ["no call, no jump, no pointer"]:
            print("  ", line)


if __name__ == "__main__":
    main()
