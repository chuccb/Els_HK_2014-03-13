/**
 * Format census of every .tga / .dds entry of the KOMs (reads and inflates all of them, ~3 GB, about a minute):
 *   bun run tools/census-images.ts [--json out.json]
 * TGA: image type, bits per pixel, descriptor (alpha bits, origin), colour map, id field, footer; DDS: pixel format / FourCC,
 * mip counts, cube/volume flags, dimension distribution.
 */
import { writeFileSync } from "node:fs";
import { indexAllKoms } from "./komindex.ts";

const jsonPath = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : undefined;
const index = await indexAllKoms();
const hist = (): Map<string, number> => new Map();
const inc = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
const tga = { type: hist(), bpp: hist(), desc: hist(), cmap: hist(), idlen: hist(), footer: hist(), size: hist(), truncated: 0, n: 0 };
const dds = { fmt: hist(), mips: hist(), caps2: hist(), size: hist(), flags: hist(), header: hist(), n: 0, bad: 0 };
const samples: Record<string, string> = {};

for (const [key, hit] of index) {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  if (ext !== "TGA" && ext !== "DDS") continue;
  const d = await hit.kom.read(hit.entry);
  if (ext === "TGA") {
    tga.n++;
    if (d.length < 18) { tga.truncated++; continue; }
    const idlen = d[0]!, cmapType = d[1]!, type = d[2]!;
    const w = d[12]! | (d[13]! << 8), h = d[14]! | (d[15]! << 8), bpp = d[16]!, desc = d[17]!;
    inc(tga.type, String(type));
    inc(tga.bpp, `${type}/${bpp}`);
    inc(tga.desc, `0x${desc.toString(16)}`);
    inc(tga.cmap, `${cmapType}:${d[5]! | (d[6]! << 8)}x${d[7]}`);
    inc(tga.idlen, idlen === 0 ? "0" : ">0");
    const tail = d.length >= 26 ? String.fromCharCode(...d.subarray(d.length - 18, d.length - 2)) : "";
    inc(tga.footer, tail === "TRUEVISION-XFILE" ? "TRUEVISION-XFILE" : "none");
    inc(tga.size, `${w}x${h}`);
    const rle = type >= 9 ? 1 : 0;
    const need = 18 + idlen + (d[5]! | (d[6]! << 8)) * (d[7]! >> 3) + (rle ? 0 : w * h * (bpp >> 3));
    if (!rle && d.length < need) tga.truncated++;
    samples[`tga ${type}/${bpp}/0x${desc.toString(16)}`] ??= hit.entry.name;
  } else {
    dds.n++;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (d.length < 128 || dv.getUint32(0, true) !== 0x20534444) { dds.bad++; continue; }
    const hsize = dv.getUint32(4, true), flags = dv.getUint32(8, true), h = dv.getUint32(12, true), w = dv.getUint32(16, true);
    const mips = dv.getUint32(28, true), pfFlags = dv.getUint32(80, true), fourcc = dv.getUint32(84, true), bits = dv.getUint32(88, true);
    const masks = [92, 96, 100, 104].map((o) => dv.getUint32(o, true).toString(16)).join(",");
    const cc = pfFlags & 4 ? String.fromCharCode(fourcc & 255, (fourcc >> 8) & 255, (fourcc >> 16) & 255, (fourcc >> 24) & 255).replace(/[^ -~]/g, (c) => `#${c.charCodeAt(0)}`) : `RGB(${pfFlags.toString(16)}) ${bits}bpp masks ${masks}`;
    const fmt = pfFlags & 4 && fourcc === 0x30315844 ? "DX10" : cc;
    inc(dds.fmt, fmt);
    inc(dds.mips, String(mips));
    inc(dds.caps2, `0x${dv.getUint32(112, true).toString(16)}`);
    inc(dds.flags, `0x${flags.toString(16)}`);
    inc(dds.header, String(hsize));
    inc(dds.size, `${w}x${h}`);
    samples[`dds ${fmt}`] ??= hit.entry.name;
  }
}
const top = (m: Map<string, number>, n = 12): Array<[string, number]> => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const out = {
  tga: { n: tga.n, truncated: tga.truncated, type: top(tga.type), typeBpp: top(tga.bpp), desc: top(tga.desc), cmap: top(tga.cmap), idlen: top(tga.idlen), footer: top(tga.footer), sizes: top(tga.size, 15) },
  dds: { n: dds.n, bad: dds.bad, fmt: top(dds.fmt, 20), mips: top(dds.mips), caps2: top(dds.caps2), flags: top(dds.flags), header: top(dds.header), sizes: top(dds.size, 15) },
  samples,
};
console.log(JSON.stringify(out, null, 1));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(out, null, 1));
