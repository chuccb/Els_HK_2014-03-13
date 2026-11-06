#!/usr/bin/env python3
"""Cross-check @els/assets image decoding against Pillow (an independent decoder), entry by entry.

    python3 tools/verify-images.py images_ts.tsv [rgba_dump_dir] [--limit N]

* images_ts.tsv comes from `bun run tools/decode-images.ts --tsv ...` (md5 of the decoded RGBA per entry).
* For every entry the KOM data is decoded with Pillow, converted to RGBA and hashed; equal hashes = identical pixels.
* Entries whose hashes differ are compared pixel by pixel when the TS side dumped them (`--dump ... --every N`), and the
  differences are summarised per container/format (max / mean absolute channel difference, share of differing pixels).
  Pillow rounds 5/6-bit and DXT colour expansion differently from D3DX's bit replication, so small differences are expected
  there; large ones are bugs.
Needs Pillow (`python3 -m venv /home/user/work/venv && /home/user/work/venv/bin/pip install pillow`).
"""
import collections, glob, hashlib, io, os, sys

sys.path.insert(0, os.path.dirname(__file__))
from komlib import KomFile
from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith('--')]
limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
if limit is not None:
    args = [a for a in args if a != str(limit)]
tsv = args[0]
dump = args[1] if len(args) > 1 else None

rows = {}
for line in open(tsv, encoding='utf-8'):
    f = line.rstrip('\n').split('\t')
    rows[f[0].upper()] = f

data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
index = {}
for p in sorted(glob.glob(os.path.join(data_dir, '*.kom'))):
    k = KomFile(p)
    for e in k.entries:
        index[e['name'].upper()] = (p, k, e)

stat = collections.defaultdict(lambda: collections.Counter())
diffs = collections.defaultdict(list)
bad = []
n = 0
handles = {}
for key, f in rows.items():
    if f[2] == 'ERROR':
        continue
    if limit is not None and n >= limit:
        break
    p, k, e = index[key]
    fh = handles.get(p) or handles.setdefault(p, open(p, 'rb'))
    fh.seek(e['offset'])
    data = k.decode(e, fh.read(e['csize']))
    kind = f'{f[1]}/{f[2]}'
    n += 1
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        rgba = im.convert('RGBA').tobytes()
    except Exception as ex:  # Pillow cannot read it
        stat[kind]['pillow-error'] += 1
        bad.append((f[0], kind, f'pillow: {ex}'))
        continue
    if im.size != (int(f[3]), int(f[4])):
        stat[kind]['size-mismatch'] += 1
        bad.append((f[0], kind, f'size {im.size} vs {f[3]}x{f[4]}'))
        continue
    if hashlib.md5(rgba).hexdigest() == f[6]:
        stat[kind]['identical'] += 1
        continue
    stat[kind]['different'] += 1
    if dump:
        dp = os.path.join(dump, f[0] + '.rgba')
        if os.path.exists(dp):
            ours = open(dp, 'rb').read()
            if len(ours) == len(rgba):
                mx = 0
                total = 0
                npx = 0
                for i in range(0, len(rgba), 4):
                    d = max(abs(ours[i + c] - rgba[i + c]) for c in range(4))
                    if d:
                        npx += 1
                        total += d
                        if d > mx:
                            mx = d
                diffs[kind].append((mx, total / max(npx, 1), npx / (len(rgba) // 4), f[0]))
for h in handles.values():
    h.close()

print(f'compared {n} entries')
for kind in sorted(stat):
    c = stat[kind]
    print(f'  {kind:28s} identical={c["identical"]:6d} different={c["different"]:5d} size-mismatch={c["size-mismatch"]} pillow-error={c["pillow-error"]}')
for kind, lst in sorted(diffs.items()):
    lst.sort(reverse=True)
    mx = max(x[0] for x in lst)
    print(f'  differences in {kind}: {len(lst)} dumped files compared, max channel diff {mx}, worst: {lst[0][3]} (max {lst[0][0]}, mean {lst[0][1]:.2f} over {lst[0][2]*100:.1f}% of pixels)')
for b in bad[:20]:
    print('  BAD', *b)
