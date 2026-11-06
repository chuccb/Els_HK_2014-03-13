#!/usr/bin/env python3
"""XORCRCDecrypt port (from IncludeLua_ in x2.exe.c @328C2930) — analysis helper.

The KOM entry is stored (zlib-compressed) then encrypted with a CRC32-keyed stream cipher.
Key material: s_aiXorKeys[5] ^ 0x38D2DFA4 (20 bytes), seeded with CRC over (lowercase UTF-16 name bytes + csize LE bytes).
"""
import struct, zlib

KEYS = [-868397061, 1497161391, -817744418, -566968968, 1387481717]

def _crc_table():
    t = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = (c >> 1) ^ 0xEDB88320 if c & 1 else c >> 1
        t.append(c)
    return t
TABLE = _crc_table()

def xor_crc_decrypt(data: bytes, name: str, csize: int) -> bytes:
    key = bytearray()
    for k in KEYS:
        key += struct.pack('<I', (k & 0xFFFFFFFF) ^ 0x38D2DFA4)
    # build name buffer: lowercase wchar (low byte, high byte if nonzero), max 260 chars
    buf = bytearray()
    for ch in name[:260]:
        c = ord(ch.lower()) & 0xFFFF
        buf.append(c & 0xFF)
        if c >> 8:
            buf.append(c >> 8)
    v22 = csize
    for _ in range(4):
        if v22 == 0:
            break
        buf.append(v22 & 0xFF)
        v22 >>= 8
    n = len(buf)
    state = 0xFFFFFFFF
    if n:
        ki = 0
        for b in buf:
            state = TABLE[(state & 0xFF) ^ (b ^ key[ki])] ^ (state >> 8)
            ki = (ki + 1) % 20
    rot = n % 20
    rkey = key[rot:] + key[:rot] if rot else bytes(key)
    out = bytearray(data)
    ki = 0
    for i in range(min(csize, len(out))):
        k = (state & 0xFF) ^ rkey[ki]
        t = k ^ ((~out[i]) & 0xFF)
        T = TABLE[t]
        out[i] = (T ^ k) & 0xFF
        state = (((T & 0xFFFFFF00) | t) ^ (state >> 8)) & 0xFFFFFFFF
        ki = (ki + 1) % 20
    return bytes(out)

def decode_lua(raw: bytes, name: str, csize: int) -> bytes:
    return zlib.decompress(xor_crc_decrypt(raw, name, csize))
