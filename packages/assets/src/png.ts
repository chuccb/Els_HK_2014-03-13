/**
 * Minimal PNG decoder (non-interlaced, bit depth 1-16, colour types 0/2/3/4/6, tRNS for palettes). One entry of the client uses
 * it (`HQ_Shop_Common_Elite_AC_FACE2_30035.dds` is a 64x64 8-bit RGB PNG with a `.dds` name).
 */
import { unzlibSync } from "fflate";
import { ImageFormatError } from "./image.ts";
import type { DecodedImage, SourceFormat } from "./image.ts";

export function decodePng(b: Uint8Array): DecodedImage {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v)) throw new ImageFormatError("PNG: bad signature", "png");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let p = 8;
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p, false);
    const type = String.fromCharCode(b[p + 4]!, b[p + 5]!, b[p + 6]!, b[p + 7]!);
    const body = b.subarray(p + 8, p + 8 + len);
    if (body.length < len) throw new ImageFormatError("PNG: truncated chunk", "png");
    if (type === "IHDR") {
      width = dv.getUint32(p + 8, false); height = dv.getUint32(p + 12, false);
      depth = b[p + 16]!; ctype = b[p + 17]!; interlace = b[p + 20]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (width === 0 || height === 0) throw new ImageFormatError("PNG: missing IHDR", "png");
  if (interlace !== 0) throw new ImageFormatError("PNG: interlaced images are not supported", "png");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (channels === undefined || ![1, 2, 4, 8, 16].includes(depth)) throw new ImageFormatError(`PNG: unsupported colour type ${ctype} / depth ${depth}`, "png");
  if (ctype === 3 && !palette) throw new ImageFormatError("PNG: palette missing", "png");

  let total = 0;
  for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  for (let i = 0, o = 0; i < idat.length; o += idat[i]!.length, i++) z.set(idat[i]!, o);
  const raw = unzlibSync(z);
  const bpp = Math.max(1, (channels * depth) >> 3); // bytes per complete pixel for filtering
  const stride = (width * channels * depth + 7) >> 3;
  if (raw.length < (stride + 1) * height) throw new ImageFormatError("PNG: truncated image data", "png");
  const img = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? img[dst + x - bpp]! : 0;
      const up = y > 0 ? img[dst - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? img[dst - stride + x - bpp]! : 0;
      let v = raw[src + x]!;
      switch (ft) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += up; break;
        case 3: v += (a + up) >> 1; break;
        case 4: {
          const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
          break;
        }
        default: throw new ImageFormatError(`PNG: bad filter type ${ft}`, "png");
      }
      img[dst + x] = v & 255;
    }
  }
  const out = new Uint8Array(width * height * 4);
  const sample = (row: number, idx: number): number => {
    // idx-th sample of the row (channels interleaved)
    if (depth === 8) return img[row + idx]!;
    if (depth === 16) return img[row + idx * 2]!; // high byte
    const perByte = 8 / depth;
    const byte = img[row + Math.floor(idx / perByte)]!;
    return (byte >> (8 - depth - (idx % perByte) * depth)) & ((1 << depth) - 1);
  };
  const scale = (v: number): number => (depth >= 8 ? v : Math.round((v * 255) / ((1 << depth) - 1)));
  let hasAlpha = ctype === 4 || ctype === 6 || (ctype === 3 && trns !== undefined);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      if (ctype === 0) { const v = scale(sample(row, x)); out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = 255; }
      else if (ctype === 2) { out[d] = sample(row, x * 3); out[d + 1] = sample(row, x * 3 + 1); out[d + 2] = sample(row, x * 3 + 2); out[d + 3] = 255; }
      else if (ctype === 3) {
        const i = sample(row, x);
        out[d] = palette![i * 3] ?? 0; out[d + 1] = palette![i * 3 + 1] ?? 0; out[d + 2] = palette![i * 3 + 2] ?? 0; out[d + 3] = trns?.[i] ?? 255;
      } else if (ctype === 4) { const v = sample(row, x * 2); out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = sample(row, x * 2 + 1); }
      else { out[d] = sample(row, x * 4); out[d + 1] = sample(row, x * 4 + 1); out[d + 2] = sample(row, x * 4 + 2); out[d + 3] = sample(row, x * 4 + 3); }
    }
  }
  if (!hasAlpha) hasAlpha = false;
  const format: SourceFormat = hasAlpha ? "A8R8G8B8" : "X8R8G8B8";
  return { width, height, rgba: out, container: "png", format, hasAlpha };
}
