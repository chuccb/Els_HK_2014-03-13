#!/usr/bin/env python3
"""Where does a function use its `const char *` parameters?  (Is a NULL one tolerated?)

  python3 tools/cstr-uses.py ADDR... [--aliases]

Prints, per function, the parameter names of type `const char *` / `char *` and every line of the body that mentions one of them or
calls `ConvertUtf8ToWCHAR`.  `lua_tinker::read<const char*>` is `lua_tostring`: a Lua value that is no string or number reads as NULL.
`ConvertUtf8ToWCHAR(dest, NULL, n)` (328C1010) leaves `dest` as it was (an empty local stays empty); `strlen(NULL)` would crash.
"""
import os
import re
import sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
want = {a.upper().removeprefix("0X") for a in sys.argv[1:] if not a.startswith("--")}
printing = False
sig: list[str] = []
body: list[str] = []


def flush(addr: str) -> None:
    text = "\n".join(sig)
    params = re.findall(r"(?:const )?char \*(\w+)", text)
    print("=" * 20, addr, "params:", ", ".join(params) or "(none)")
    names = set(params)
    # one level of aliases: `v4 = pFileName;`
    for line in body:
        m = re.match(r"\s*(\w+) = (\w+);", line)
        if m and m.group(2) in names:
            names.add(m.group(1))
    for line in body:
        if "ConvertUtf8ToWCHAR" in line or any(re.search(rf"\b{re.escape(n)}\b", line) for n in names):
            print("  ", line.strip()[:200])


addr = ""
with open(os.path.join(root, "data", "x2.exe.c"), encoding="utf-8", errors="replace") as f:
    for line in f:
        if line.startswith("//----- ("):
            if printing:
                flush(addr)
            addr = line[9:17].upper()
            printing = addr in want
            sig, body = [], []
            continue
        if not printing or not line.strip():
            continue
        (body if line.startswith("{") or body else sig).append(line.rstrip("\n"))
if printing:
    flush(addr)
