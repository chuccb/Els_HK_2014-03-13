#!/usr/bin/env python3
"""Independent re-implementation of CKTDXStringTable::LoadStringTable (328ADEF0) used to cross-check packages/assets/src/ess.ts.

    python3 tools/verify-ess.py [data/general.ess]

Prints: lines, index mismatches, capped (2047-unit) lines, empty texts -- the numbers tools/verify-ess.ts prints as diagnostics.
"""
import re
import struct
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "data/general.ess"
b = open(path, "rb").read()
n = len(b)
pos = 2  # fseek(fp, 2, SEEK_CUR): skip the UTF-16LE BOM
expected = 0
lines = mismatches = capped = empties = 0
while pos + 2 <= n:
    chars = []
    while len(chars) < 2047 and pos + 2 <= n:  # fgetws(buf, 2048, fp)
        c = struct.unpack_from("<H", b, pos)[0]
        pos += 2
        chars.append(c)
        if c == 0x0A:
            break
    if len(chars) == 2047 and chars[-1] != 0x0A:
        capped += 1
    s = "".join(chr(c) for c in chars)
    nul = s.find("\0")
    if nul >= 0:
        s = s[:nul]
    k = s.find("\r\n")
    if k >= 0:
        s = s[:k]
    s = "".join(chr(ord(ch) ^ 0x10) for ch in s)
    t = s.find("\t")
    m = re.match(r"[ \t\n\v\f\r]*[-+]?\d+", s[:t] if t >= 0 else s)
    idx = int(m.group(0)) if m else 0
    content = ""
    if idx == expected and t >= 0:
        content = s[t + 1:]
    else:
        mismatches += 1
    if content == "":
        empties += 1
    lines += 1
    expected += 1
print(f"entries {lines}, index mismatches {mismatches}, capped lines {capped}, empty texts {empties}")
