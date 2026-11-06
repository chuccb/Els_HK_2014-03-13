#!/usr/bin/env python3
"""Build a function index (address, name, line range) for the IDA/Hex-Rays export x2.exe.c.

Usage: python3 tools/index_decomp.py data/x2.exe.c build/analysis/functions.tsv
"""
import re, sys, os

src = sys.argv[1]
out = sys.argv[2]
os.makedirs(os.path.dirname(out), exist_ok=True)

marker = re.compile(r'^//----- \(([0-9A-Fa-f]{8})\) -+$')
funcs = []  # (addr, start_line, sig)
with open(src, 'r', encoding='utf-8', errors='replace') as f:
    pending = None
    for ln, line in enumerate(f, 1):
        m = marker.match(line)
        if m:
            if funcs and funcs[-1][3] is None:
                pass
            pending = [m.group(1).upper(), ln, None, None]
            funcs.append(pending)
            continue
        if pending is not None and pending[2] is None:
            # first non-empty/non-comment line after marker is the signature (may span multiple lines)
            s = line.rstrip('\n')
            if s.strip() == '' or s.startswith('//'):
                continue
            pending[2] = s
            pending[3] = ln

with open(out, 'w', encoding='utf-8') as o:
    total = ln
    for i, (addr, start, sig, sigln) in enumerate(funcs):
        end = funcs[i+1][1]-1 if i+1 < len(funcs) else total
        o.write(f"{addr}\t{start}\t{end}\t{(sig or '').strip()}\n")
print(len(funcs), 'functions indexed ->', out)
