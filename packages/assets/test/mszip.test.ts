import { describe, expect, test } from "bun:test";
import { deflateSync } from "fflate";
import { decompressXFile, isCompressedXFile, MszipError } from "../src/index.ts";
import { inflateInto, InflateError } from "../src/inflate.ts";

function sample(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    // mixture of compressible runs and noise
    out[i] = (i >> 6) % 3 === 0 ? x >>> 24 : (i * 7) & 31;
  }
  return out;
}

describe("inflateInto", () => {
  test("agrees with fflate's deflate at levels 0 (stored), 1 and 9", () => {
    for (const level of [0, 1, 9] as const) {
      for (const n of [0, 1, 100, 5000, 70000]) {
        const data = sample(n, n + level);
        const packed = deflateSync(data, { level });
        const out = new Uint8Array(n);
        expect(inflateInto(packed, 0, packed.length, out, 0, n)).toBe(n);
        expect(Buffer.compare(out, data)).toBe(0);
      }
    }
  });

  test("stops after `limit` bytes and writes at an offset", () => {
    const data = sample(1000, 3);
    const packed = deflateSync(data);
    const out = new Uint8Array(1500);
    expect(inflateInto(packed, 0, packed.length, out, 100, 400)).toBe(500);
    expect(Buffer.compare(out.subarray(100, 500), data.subarray(0, 400))).toBe(0);
    expect(out[99]).toBe(0);
    expect(out[500]).toBe(0);
  });

  test("stored block without the NLEN complement (the MSZIP writer's form) and with it", () => {
    const body = Uint8Array.from([9, 8, 7, 6, 5]);
    const quirk = Uint8Array.from([0x01, 5, 0, ...body]);
    const standard = Uint8Array.from([0x01, 5, 0, 0xfa, 0xff, ...body]);
    for (const stream of [quirk, standard]) {
      const out = new Uint8Array(5);
      expect(inflateInto(stream, 0, stream.length, out, 0, 5)).toBe(5);
      expect([...out]).toEqual([9, 8, 7, 6, 5]);
    }
  });

  test("errors: truncated data, window violations, short final block", () => {
    const packed = deflateSync(sample(2000, 5));
    expect(() => inflateInto(packed, 0, packed.length - 10, new Uint8Array(2000), 0, 2000)).toThrow(InflateError);
    expect(() => inflateInto(packed, 0, packed.length, new Uint8Array(2000), 0, 2001)).toThrow(InflateError);
    // a match that reaches before windowStart
    const withHistory = deflateSync(sample(300, 9), { dictionary: sample(100, 1) });
    const out = new Uint8Array(400);
    out.set(sample(100, 1), 0);
    expect(inflateInto(withHistory, 0, withHistory.length, out, 100, 300, 0)).toBe(400);
    expect(() => inflateInto(withHistory, 0, withHistory.length, out, 100, 300, 100)).toThrow(InflateError);
  });
});

describe("MSZIP X files", () => {
  function pack(payload: Uint8Array, format = "bzip", chunk = 32768): Uint8Array {
    const parts: number[] = [];
    const chunks: Uint8Array[] = [];
    for (let o = 0; o < payload.length; o += chunk) {
      const part = payload.subarray(o, o + chunk);
      const dictionary = payload.subarray(Math.max(0, o - 32768), o);
      const deflated = deflateSync(part, { dictionary: dictionary.length ? dictionary : undefined });
      const hdr = [part.length & 255, part.length >> 8, (deflated.length + 2) & 255, (deflated.length + 2) >> 8, 0x43, 0x4b];
      chunks.push(Uint8Array.from([...hdr, ...deflated]));
    }
    const total = 16 + payload.length;
    const head = [...new TextEncoder().encode(`xof 0303${format}0032`), total & 255, (total >> 8) & 255, (total >> 16) & 255, total >>> 24];
    for (const c of chunks) parts.push(...c);
    return Uint8Array.from([...head, ...parts]);
  }

  test("multi-chunk file: later chunks reference the previous 32 KiB, header becomes bin / txt", () => {
    const payload = sample(100000, 11);
    // make chunk 2 depend on chunk 1: repeat a stretch of it
    payload.copyWithin(40000, 1000, 9000);
    const file = pack(payload);
    expect(isCompressedXFile(file)).toBe(true);
    const out = decompressXFile(file);
    expect(new TextDecoder().decode(out.subarray(0, 16))).toBe("xof 0303bin 0032");
    expect(Buffer.compare(out.subarray(16), payload)).toBe(0);
    const text = decompressXFile(pack(new TextEncoder().encode("Mesh { 0; }"), "tzip"));
    expect(new TextDecoder().decode(text)).toBe("xof 0303txt 0032Mesh { 0; }");
  });

  test("corrupt containers are reported", () => {
    const file = pack(sample(5000, 2));
    expect(() => decompressXFile(file.subarray(0, file.length - 3))).toThrow(MszipError);
    const badSig = file.slice();
    badSig[24] = 0;
    expect(() => decompressXFile(badSig)).toThrow(/CK/);
    expect(() => decompressXFile(Uint8Array.from([1, 2, 3]))).toThrow(MszipError);
    expect(isCompressedXFile(Uint8Array.from(new TextEncoder().encode("xof 0303txt 0032....")))).toBe(false);
  });
});
