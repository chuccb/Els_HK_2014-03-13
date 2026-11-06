#!/usr/bin/env python3
"""Print the decompile of the functions at the given addresses of data/x2.exe.c (blank lines dropped, long lines cut).

  python3 tools/decomp.py 329559D0 3295AF30 [--width 200] [--keep-blank]
"""
import os
import sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
path = os.path.join(root, "data", "x2.exe.c")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
width = 170
if "--width" in sys.argv:
    width = int(sys.argv[sys.argv.index("--width") + 1])
    args = [a for a in args if a != str(width)]
keep_blank = "--keep-blank" in sys.argv
max_lines = 10**9
if "--max" in sys.argv:
    max_lines = int(sys.argv[sys.argv.index("--max") + 1])
    args = [a for a in args if a != str(max_lines)]
want = {a.upper().removeprefix("0X") for a in args}
if not want:
    sys.exit(__doc__)

printing = False
found = set()
emitted = 0
with open(path, encoding="utf-8", errors="replace") as f:
    for line in f:
        if line.startswith("//----- ("):
            addr = line[9:17].upper()
            printing = addr in want
            if printing:
                found.add(addr)
                emitted = 0
                print(f"{'=' * 20} {addr}")
            elif found == want:
                break
            continue
        if printing and (keep_blank or line.strip()):
            emitted += 1
            if emitted <= max_lines:
                print(line.rstrip("\n")[:width])
            elif emitted == max_lines + 1:
                print("  ... (cut)")
for a in sorted(want - found):
    print(f"-- {a}: no function starts there", file=sys.stderr)
