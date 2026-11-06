#!/usr/bin/env python3
"""
Small MPEG-1 elementary streams for packages/assets/test/mpeg1.test.ts, made with FFmpeg's mpeg1video encoder (through PyAV), together with
the CRC-32 of every decoded picture (planar YUV, visible area, display order) as FFmpeg decodes it.  The movies of the game only use I and P
pictures with the default quantiser matrices; these streams cover what they do not: B pictures (bidirectional prediction, skipped macroblocks
in B pictures, picture re-ordering), custom quantiser matrices (loaded by rewriting the sequence headers: this build's encoder ignores the
intra_matrix / inter_matrix options), sizes that are not a multiple of 16, large vectors (f_code > 1), per-macroblock quantiser changes,
16 bit escape levels, address increments above 33 (macroblock_escape) and full-pel vectors (the full_pel bits of the picture headers are
set in a copy; the stream stays valid and FFmpeg's decoder says what it decodes to).  FFmpeg's encoder writes one slice per picture;
slices that start inside a row are covered by hand made streams in the test.

    pip install --target /home/user/work/pyav av numpy
    PYTHONPATH=/home/user/work/pyav python3 tools/gen-mpeg1-fixtures.py

writes packages/assets/test/fixtures/mpeg1/*.m1v and expected.json.  (Re-running changes the files if the FFmpeg version changes; the test
only needs the committed ones.)
"""
import json, os, struct, sys, zlib
import av
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "assets", "test", "fixtures", "mpeg1")


def source(n, w, h, seed, fast=1, noisy=False, drift=1.0, flat=False):
    """synthetic pictures: a textured background drifting slowly, a fast square, a static block, noise bursts"""
    rng = np.random.RandomState(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    frames = []
    for t in range(n):
        base = 128 + 55 * np.sin((xx + t * 0.7 * drift) / 7.0) + 40 * np.cos((yy - t * 0.4 * drift) / 5.0)
        img = np.stack([base, 255 - 0.8 * base + 20 * np.sin(xx / 13.0), 90 + yy * 0.6 + 30 * np.cos(t / 3.0)], -1)
        if flat:
            img[:] = (60, 80, 100)
        x0 = int((t * 5 * fast) % max(1, w - 18))
        img[h // 4: h // 4 + 16, x0: x0 + 16] = (250, 30, 30)
        y0 = int((t * 3 * fast) % max(1, h - 14))
        img[y0: y0 + 12, w // 2: w // 2 + 12] = (30, 220, 40)
        img[h - 14: h - 2, 2: 14] = (20, 20, 240)  # static
        if noisy and t % 4 == 1:
            img[h // 2: h // 2 + 12, 6: 26] = rng.randint(0, 255, size=(12, min(20, w - 6), 3))
        frames.append(np.clip(img, 0, 255).astype(np.uint8))
    return frames


def encode(path, frames, w, h, gop=9, bf=2, bit_rate=None, options=None):
    c = av.open(path, "w", format="mpeg1video")
    s = c.add_stream("mpeg1video", rate=24)
    s.width, s.height, s.pix_fmt = w, h, "yuv420p"
    if bit_rate:
        s.bit_rate = bit_rate
    cc = s.codec_context
    cc.gop_size, cc.max_b_frames = gop, bf
    cc.thread_count = 1
    cc.options = dict(options or {})
    for t, a in enumerate(frames):
        f = av.VideoFrame.from_ndarray(a, format="rgb24").reformat(format="yuv420p")
        f.pts = t
        for p in s.encode(f):
            c.mux(p)
    for p in s.encode():
        c.mux(p)
    c.close()


def start_codes(d):
    i = 0
    while True:
        i = d.find(b"\x00\x00\x01", i)
        if i < 0 or i + 3 >= len(d):
            return
        yield i, d[i + 3]
        i += 3


def flip_full_pel(data):
    """set full_pel_forward_vector / full_pel_backward_vector in every P / B picture header"""
    b = bytearray(data)
    for i, code in start_codes(bytes(data)):
        if code != 0:
            continue
        # temporal_reference 10, picture_coding_type 3, vbv_delay 16 = 29 bits, then full_pel_forward (bit 29)
        ptype = (b[i + 5] >> 3) & 7
        if ptype in (2, 3):
            b[i + 7] |= 0x04  # bit 29 counted from the start of byte i + 4: byte 3 (i + 7), bit 5 from the left = 0x04
        if ptype == 3:
            # full_pel_forward 1 + forward_f_code 3 = bits 29..32, then full_pel_backward = bit 33: byte 4 (i + 8), bit 1 from the left = 0x40
            b[i + 8] |= 0x40
    return bytes(b)


def bits_of(b):
    return "".join(format(x, "08b") for x in b)


def bytes_of(bits):
    assert len(bits) % 8 == 0
    return bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))


def load_matrices(data, intra, inter):
    """rewrite every sequence header so that it carries the given quantiser matrices (64 values each, zigzag order); the pictures then
    decode to something else than they were encoded from, which is fine: FFmpeg's decoder is the reference"""
    out, pos = bytearray(), 0
    while True:
        j = data.find(b"\x00\x00\x01\xb3", pos)
        if j < 0:
            out += data[pos:]
            break
        out += data[pos:j + 4]
        hdr = bits_of(data[j + 4:j + 12])
        assert hdr[62:64] == "00", "the stream already loads matrices"
        new = hdr[:62] + "1" + "".join(format(v, "08b") for v in intra) + "1" + "".join(format(v, "08b") for v in inter)
        out += bytes_of(new)
        pos = j + 12
    return bytes(out)


def oracle(path):
    c = av.open(path)
    s = c.streams.video[0]
    s.thread_count = 1
    crcs, types = [], []
    for pkt in c.demux(s):
        for f in s.codec_context.decode(pkt):
            out = []
            for i, p in enumerate(f.planes):
                w = f.width if i == 0 else (f.width + 1) // 2
                hh = f.height if i == 0 else (f.height + 1) // 2
                buf = bytes(p)
                out.append(zlib.crc32(b"".join(buf[r * p.line_size: r * p.line_size + w] for r in range(hh))))
            crcs.append(out)
            types.append(int(f.pict_type))
    return {"width": s.codec_context.width, "height": s.codec_context.height, "crc": crcs, "types": types}


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = {}
    # name: (frames, w, h, encode kwargs)
    jobs["ipb_64x48"] = (source(19, 64, 48, 1), 64, 48, dict(gop=9, bf=2))
    jobs["ipb_50x34"] = (source(19, 50, 34, 2, noisy=True), 50, 34, dict(gop=7, bf=2))
    jobs["fast_96x64"] = (source(14, 96, 64, 4, fast=4, noisy=True), 96, 64, dict(gop=6, bf=0, options={"me_range": "64"}))
    jobs["lowrate_80x48"] = (source(20, 80, 48, 5, noisy=True), 80, 48, dict(gop=10, bf=2, bit_rate=60000, options={"qmin": "2", "qmax": "31"}))
    jobs["qscale1_64x32"] = (source(8, 64, 32, 8, noisy=True), 64, 32, dict(gop=4, bf=1, options={"qmin": "1", "qmax": "1"}))
    jobs["wide_640x32"] = (source(9, 640, 32, 9, fast=0.6, flat=True), 640, 32, dict(gop=9, bf=2, options={"qmin": "8", "qmax": "8"}))
    jobs["adaptive_96x64"] = (source(16, 96, 64, 10, noisy=True), 96, 64, dict(gop=8, bf=2, bit_rate=120000, options={"border_mask": "0.5"}))
    expected = {}
    for name, (frames, w, h, kw) in jobs.items():
        path = os.path.join(OUT, name + ".m1v")
        encode(path, frames, w, h, **kw)
        expected[name] = oracle(path)
    # full-pel copy of a stream with small vectors: doubling a vector must not make a macroblock point outside the picture (the standard
    # forbids it, and FFmpeg then skips the prediction); the stream itself is a normal one
    path = os.path.join(OUT, "small_64x48.m1v")
    encode(path, source(19, 64, 48, 7, fast=0.5), 64, 48, gop=9, bf=2, options={"me_range": "5"})
    src = open(path, "rb").read()
    os.remove(path)
    path = os.path.join(OUT, "fullpel_64x48.m1v")
    open(path, "wb").write(flip_full_pel(src))
    expected["fullpel_64x48"] = oracle(path)
    # custom matrices (values 8..90, as the standard allows 1..255), loaded by every sequence header of a copy of the first stream
    zz = [(8 + (k * 5) % 37 + k) for k in range(64)]
    zi = [(10 + (k * 11) % 53 + k // 2) for k in range(64)]
    base = open(os.path.join(OUT, "ipb_64x48.m1v"), "rb").read()
    path = os.path.join(OUT, "loadmatrix_64x48.m1v")
    open(path, "wb").write(load_matrices(base, zz, zi))
    expected["loadmatrix_64x48"] = oracle(path)
    json.dump(expected, open(os.path.join(OUT, "expected.json"), "w"), indent=0)
    for name, e in expected.items():
        d = open(os.path.join(OUT, name + ".m1v"), "rb").read()
        print("%-16s %5d bytes, %2d pictures, types %s" % (name, len(d), len(e["crc"]), "".join("?IPBD"[t] for t in e["types"])))


if __name__ == "__main__":
    main()
