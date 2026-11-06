#!/usr/bin/env python3
"""
FFmpeg (through PyAV) as the oracle of packages/assets/src/mpeg1.ts.

    pip install --target /home/user/work/pyav av numpy
    PYTHONPATH=/home/user/work/pyav python3 tools/oracle-mpeg1.py [--idct simple|auto|...] [--dump DIR] [--out hashes.json] FILE.avi...

For every file the decoded pictures (display order, visible area, planar YUV 4:2:0) are hashed with CRC-32, one hash per plane;
the JSON goes to --out (default stdout) and is what tools/verify-mpeg1.ts compares against.  --dump writes the raw I420 pictures of
each file (DIR/<name>.yuv) so the verifier can report the largest sample difference when a hash does not match.

--pack PREFIX writes the hashes in the compact form the repository keeps (packages/assets/test/fixtures/mpeg1/movies.{json,bin}): PREFIX.json
holds, per file, the picture types as a string ("IPPP...", display order), the size and the offset of the file's hashes in PREFIX.bin, which
is the concatenation of little-endian u32 CRC-32 triples (Y, Cb, Cr) per picture.  tools/verify-mpeg1.ts reads that form by default, so the
shipped movies can be verified without FFmpeg; run this with --pack again to re-record them.

--idct selects the IDCT of libavcodec (`auto` = the default of the build, SIMD on x86; `simple` = the C reference "simple_idct", `int` =
the JPEG reference IDCT, `xvid` ...): the decoder in mpeg1.ts uses the simple IDCT.
"""
import argparse, json, os, struct, sys, zlib

import av


def decode(path, idct):
    c = av.open(path)
    s = c.streams.video[0]
    s.thread_count = 1
    s.codec_context.options = {"idct": idct} if idct else {}
    frames = []
    for pkt in c.demux(s):
        for f in s.codec_context.decode(pkt):
            frames.append(f)
    return s, frames


def planes(f):
    """Y, Cb, Cr of an yuv420p frame as bytes without line padding"""
    out = []
    for i, p in enumerate(f.planes):
        w = f.width if i == 0 else (f.width + 1) // 2
        h = f.height if i == 0 else (f.height + 1) // 2
        buf = bytes(p)
        out.append(b"".join(buf[r * p.line_size:r * p.line_size + w] for r in range(h)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--idct", default="")
    ap.add_argument("--dump")
    ap.add_argument("--out")
    ap.add_argument("--pack")
    a = ap.parse_args()
    res = {}
    for path in a.files:
        s, frames = decode(path, a.idct)
        name = os.path.basename(path)
        hashes, types = [], []
        dump = open(os.path.join(a.dump, name + ".yuv"), "wb") if a.dump else None
        for f in frames:
            if f.format.name != "yuv420p":
                sys.exit("%s: unexpected pixel format %s" % (name, f.format.name))
            pl = planes(f)
            hashes.append([zlib.crc32(b) for b in pl])
            types.append(int(f.pict_type))
            if dump:
                for b in pl:
                    dump.write(b)
        if dump:
            dump.close()
        res[name] = {"width": frames[0].width, "height": frames[0].height, "frames": len(frames), "types": types, "crc": hashes,
                     "codec": s.codec_context.name, "fps": str(s.average_rate)}
        print("%s: %d pictures" % (name, len(frames)), file=sys.stderr)
    if a.pack:
        index, blob = {}, bytearray()
        for name in sorted(res):
            r = res[name]
            index[name] = {"width": r["width"], "height": r["height"], "frames": r["frames"], "types": "".join("?IPBD"[t] for t in r["types"]),
                           "offset": len(blob)}
            for crcs in r["crc"]:
                blob += struct.pack("<3I", *crcs)
        json.dump(index, open(a.pack + ".json", "w"), indent=0)
        open(a.pack + ".bin", "wb").write(blob)
    txt = json.dumps(res)
    if a.out:
        open(a.out, "w").write(txt)
    else:
        print(txt)


if __name__ == "__main__":
    main()
