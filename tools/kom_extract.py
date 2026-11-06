#!/usr/bin/env python3
"""Extract entries from all data/*.kom into an output directory.

Usage: kom_extract.py OUTDIR [ext1,ext2,...|all] [name-substring-filter]
"""
import sys, glob, os, zlib
sys.path.insert(0, os.path.dirname(__file__))
from komlib import KomFile

out = sys.argv[1]
exts = sys.argv[2].lower().split(',') if len(sys.argv) > 2 else ['all']
flt = sys.argv[3].lower() if len(sys.argv) > 3 else None
n = 0
for p in sorted(glob.glob(os.path.join(os.path.dirname(__file__), '..', 'data', '*.kom'))):
    k = KomFile(p)
    with open(p, 'rb') as f:
        for e in k.entries:
            x = os.path.splitext(e['name'])[1].lower().lstrip('.')
            if 'all' not in exts and x not in exts:
                continue
            if flt and flt not in e['name'].lower():
                continue
            f.seek(e['offset'])
            raw = f.read(e['csize'])
            data = k.decode(e, raw)
            dst = os.path.join(out, e['name'])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'wb') as o:
                o.write(data)
            n += 1
print('extracted', n)
