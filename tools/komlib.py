#!/usr/bin/env python3
"""Minimal KOM (KOG GC TEAM MASSFILE V.0.3.) reader, derived from
KGCMassFileManager::CMassFile::LoadMassFile / _GetMemberFile in x2.exe.c.

Header (0x3C bytes): char strVersionInfo[50]; u32 iTotalFileNo @0x34; u8 bCompressed @0x38
V3 extra: u32 filetime @0x3C; u32 adler32 @0x40; u32 headersize @0x44; XML[headersize] @0x48
data starts @ 0x48 + headersize ; entries are packed sequentially, each CompressedSize bytes (zlib when bCompressed).
"""
import struct, zlib, re, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xml.etree.ElementTree as ET

class KomFile:
    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as f:
            hdr = f.read(0x48)
            self.magic = hdr[:0x34].split(b'\0')[0].decode('ascii')
            (self.total, ) = struct.unpack_from('<I', hdr, 0x34)
            self.compressed = hdr[0x38] != 0
            self.filetime, self.adler, self.headersize = struct.unpack_from('<III', hdr, 0x3c)
            xml = f.read(self.headersize)
        self.data_start = 0x48 + self.headersize
        root = ET.fromstring(xml.decode('utf-8', 'replace'))
        self.entries = []
        off = self.data_start
        for fe in root.findall('File'):
            e = dict(name=fe.get('Name'), size=int(fe.get('Size')), csize=int(fe.get('CompressedSize')),
                     checksum=fe.get('Checksum'), filetime=fe.get('FileTime'), algo=int(fe.get('Algorithm','0')), offset=off)
            off += e['csize']
            self.entries.append(e)
        self.end = off

    def read(self, e):
        with open(self.path, 'rb') as f:
            f.seek(e['offset'])
            raw = f.read(e['csize'])
        return self.decode(e, raw)

    def decode(self, e, raw):
        """Algorithm 0: plain zlib. Algorithm 2: XORCRCDecrypt (see luadecrypt.py) then zlib (.lua/.txt/.kim)."""
        if e['algo'] == 2:
            from luadecrypt import xor_crc_decrypt
            raw = xor_crc_decrypt(raw, e['name'], e['csize'])
        if self.compressed:
            return zlib.decompress(raw)
        return raw

if __name__ == '__main__':
    k = KomFile(sys.argv[1])
    print(k.magic, k.total, k.compressed, len(k.entries), k.end, os.path.getsize(sys.argv[1]))
    for e in k.entries[:20]:
        print(e)
