#!/usr/bin/env python3
"""Print struct / enum definitions of data/x2.exe.h (the IDA type library) by name.

  python3 tools/structs.py CKTDGUIRadioButton CKTDGUICheckBox [--vtbl]

A name matches `struct __cppobj [attrs] NAME`, `struct NAME` or `enum NAME` at the start of a definition (`NAME_vtbl` with --vtbl).
"""
import os
import re
import sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
names = {a for a in sys.argv[1:] if not a.startswith("--")}
if "--vtbl" in sys.argv:
    names |= {n + "_vtbl" for n in names}
if not names:
    sys.exit(__doc__)
head = re.compile(r"^(?:struct|enum|union)\s+(?:__cppobj\s+|/\*VFT\*/\s+|__declspec\(align\(\d+\)\)\s+)*([\w:<>, *]+?)(?:\s*:\s*[\w:<>, ]+)?\s*$")
out = False
with open(os.path.join(root, "data", "x2.exe.h"), encoding="utf-8", errors="replace") as f:
    for line in f:
        if not out:
            m = head.match(line.rstrip())
            if m and m.group(1).strip() in names:
                out = True
                print(line.rstrip())
        else:
            print(line.rstrip())
            if line.startswith("};"):
                out = False
                print()
