#!/usr/bin/env python3
"""
Disassemble a range of data/x2.exe (x86-32, Capstone) where the Hex-Rays decompile is not to be trusted: it loses XMM / x87 arguments of calls and
gets float / double wrong in SSE code (OptimizeKeys, FINDINGS section 16).  Calls and loads through an import slot are annotated with the import's
name (also through the `jmp [slot]` thunks the exe calls most imports by).

    pip install --target /home/user/work/pycap capstone pefile       (ELS_PYLIBS overrides the directory)
    python3 tools/disasm.py 32988610 32988700            # start and end are virtual addresses in hex, as in the decompile's //----- (ADDR) markers
    python3 tools/disasm.py 32988610 +0x100 --exe data/x2.exe

The addresses are the ones of the decompile (x2.exe has no relocations, it is mapped at its preferred base).
"""
import os, sys

sys.path.insert(0, os.environ.get("ELS_PYLIBS", "/home/user/work/pycap"))
import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    exe = os.path.join(ROOT, "data", "x2.exe")
    if "--exe" in sys.argv:
        exe = sys.argv[sys.argv.index("--exe") + 1]
        args = [a for a in args if a != exe]
    if len(args) != 2:
        sys.exit(__doc__)
    pe = pefile.PE(exe, fast_load=True)
    pe.parse_data_directories([pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]])
    base = pe.OPTIONAL_HEADER.ImageBase
    data = open(exe, "rb").read()
    imports = {}
    for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
        dll = entry.dll.decode("ascii", "replace")
        for imp in entry.imports:
            imports[imp.address] = "%s!%s" % (dll, imp.name.decode("ascii", "replace") if imp.name else "#%d" % imp.ordinal)

    def find_offset(addr):
        rva = addr - base
        for s in pe.sections:
            if s.VirtualAddress <= rva < s.VirtualAddress + max(s.Misc_VirtualSize, s.SizeOfRawData):
                return rva - s.VirtualAddress + s.PointerToRawData
        return None

    def offset(addr):
        o = find_offset(addr)
        if o is None:
            raise SystemExit("0x%X is in no section" % addr)
        return o

    def thunk_import(addr):
        """the import behind `jmp dword ptr [slot]` at addr (the exe calls most imports through such thunks)"""
        o = find_offset(addr)
        if o is None or data[o:o + 2] != b"\xff\x25":
            return None
        return imports.get(int.from_bytes(data[o + 2:o + 6], "little"))

    start = int(args[0], 16)
    end = start + int(args[1][1:], 16) if args[1].startswith("+") else int(args[1], 16)
    md = Cs(CS_ARCH_X86, CS_MODE_32)
    code = data[offset(start):offset(start) + (end - start)]
    out = sys.stdout
    for i in md.disasm(code, start):
        note = ""
        for tok in i.op_str.replace("[", " ").replace("]", " ").replace(",", " ").split():
            if tok.startswith("0x"):
                try:
                    v = int(tok, 16)
                except ValueError:
                    continue
                if v in imports:
                    note = "  ; " + imports[v]
                elif i.mnemonic in ("call", "jmp") and thunk_import(v):
                    note = "  ; thunk to " + thunk_import(v)
        try:
            out.write("%08X  %-8s %s%s\n" % (i.address, i.mnemonic, i.op_str, note))
        except BrokenPipeError:  # `| head`
            sys.stderr.close()
            return


main()
