import { describe, expect, test } from "bun:test";
import { compareIgnoreCase, parseTet, parseXet, readFormatString } from "../src/index.ts";

/** A format string: u16 length, UTF-16LE units, 0 terminator. */
const wstr = (s: string): number[] => [s.length & 255, s.length >> 8, ...[...s].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]), 0, 0];
const u32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const u16 = (v: number): number[] => [v & 255, v >> 8];
const f32 = (v: number): number[] => [...new Uint8Array(Float32Array.of(v).buffer)];

/** Lay out strings one after another starting at `base`; returns offsets in order plus the bytes. */
function strings(base: number, list: string[]): { offsets: number[]; bytes: number[] } {
  const offsets: number[] = [];
  const bytes: number[] = [];
  for (const s of list) { offsets.push(base + bytes.length); bytes.push(...wstr(s)); }
  return { offsets, bytes };
}

function buildTet(entries: Array<{ key: string; rect: number[] }>): Uint8Array {
  const n = entries.length;
  const st = strings(12 + 44 * n, entries.map((e) => e.key));
  return Uint8Array.from([...u32(0x20544554), ...u32(256), ...u32(n), ...st.offsets.flatMap(u32), ...entries.flatMap((e) => e.rect.flatMap(f32)), ...st.bytes]);
}

function buildXet(opts: { changes?: Array<[string, string]>; ani?: Array<{ name: string; transition: number; max: number; first: number; num: number }>; events?: Array<{ org: string; change: string; start: number; end: number }>; stage1?: [string, number] }): Uint8Array {
  const changes = opts.changes ?? [], ani = opts.ani ?? [], events = opts.events ?? [];
  const base = 36 + 8 * changes.length + 16 * ani.length + 16 * events.length;
  const all = [...changes.flat(), ...ani.map((a) => a.name), ...events.flatMap((e) => [e.org, e.change]), ...(opts.stage1 ? [opts.stage1[0]] : [])];
  const st = strings(base, all);
  let k = 0;
  const next = (): number => st.offsets[k++]!;
  const chg = changes.flatMap(() => [...u32(next()), ...u32(next())]);
  const an = ani.flatMap((a) => [...u32(next()), ...f32(a.transition), ...f32(a.max), ...u16(a.num), ...u16(a.first)]);
  const ev = events.flatMap((e) => [...u32(next()), ...u32(next()), ...f32(e.start), ...f32(e.end)]);
  const s1 = opts.stage1 ? [...u32(next()), ...u32(opts.stage1[1])] : [0, 0, 0, 0, 0, 0, 0, 0];
  return Uint8Array.from([...u32(0x20544558), ...u32(256), ...u32(changes.length), ...u32(ani.length), ...u32(events.length), ...s1, 0, 0, 0, 0, 0, 0, 0, 0, ...chg, ...an, ...ev, ...st.bytes]);
}

describe("format strings", () => {
  test("GetString rules: offset 0, zero length, bad terminator and out-of-range are empty", () => {
    const b = Uint8Array.from([0, 0, 0, 0, ...wstr("ABC"), ...u16(2), 65, 0, 66, 0, 99, 0, ...u16(0), 0, 0]);
    expect(readFormatString(b, 4)).toBe("ABC");
    expect(readFormatString(b, 0)).toBe("");
    expect(readFormatString(b, 14)).toBe(""); // terminator is not 0
    expect(readFormatString(b, 22)).toBe(""); // zero length
    expect(readFormatString(b, 1000)).toBe("");
    expect(readFormatString(b, b.length - 1)).toBe("");
  });
});

describe("TET", () => {
  const rect = (x: number, y: number, w: number, h: number): number[] => [x, y, x + w, y + h, x, y + h, x + w, y, w, h];
  test("entries are found by exact key", () => {
    const f = parseTet(buildTet([{ key: "ARIEL_BG", rect: rect(251, 12, 259, 340) }, { key: "RURIEL_BG", rect: rect(0, 0, 4, 8) }]))!;
    expect(f.rects.size).toBe(2);
    const r = f.getTexUV("ARIEL_BG")!;
    expect(r.leftTop).toEqual([251, 12]);
    expect(r.rightBottom).toEqual([510, 352]);
    expect(r.leftBottom).toEqual([251, 352]);
    expect(r.rightTop).toEqual([510, 12]);
    expect(r.rectSize).toEqual([259, 340]);
    expect(f.getTexUV("RURIEL_BG")!.rectSize).toEqual([4, 8]);
    expect(f.getTexUV("ariel_bg")).toBeUndefined(); // wcscmp: case-sensitive
    expect(f.getTexUV("")).toBeUndefined();
  });

  test("the exe rejects short files, wrong magic or version, and tables that do not fit", () => {
    const good = buildTet([{ key: "A", rect: rect(0, 0, 1, 1) }]);
    expect(parseTet(good)).toBeDefined();
    expect(parseTet(good.subarray(0, 40))).toBeUndefined();
    expect(parseTet(good.subarray(0, 8))).toBeUndefined();
    const badVersion = good.slice();
    badVersion[5] = 2;
    expect(parseTet(badVersion)).toBeUndefined();
    const badMagic = good.slice();
    badMagic[0] = 0x58;
    expect(parseTet(badMagic)).toBeUndefined();
  });
});

describe("XET", () => {
  test("change textures, multi-texture stage and animation events", () => {
    const f = parseXet(buildXet({
      changes: [["ANCIENT_CRAB_A.TGA", "ANCIENT_CRAB_A_A.TGA"], ["ANCIENT_CRAB_B.TGA", "ANCIENT_CRAB_B_B.TGA"]],
      ani: [{ name: "Smile", transition: 0.5, max: 2, first: 1, num: 1 }, { name: "Wait", transition: 0.25, max: 3, first: 0, num: 1 }],
      events: [{ org: "FACE.TGA", change: "FACE_WAIT.TGA", start: 0, end: 1.5 }, { org: "FACE.TGA", change: "FACE_SMILE.TGA", start: 0.5, end: 1 }],
      stage1: ["BLEND.TGA", 4],
    }))!;
    expect(f.changeTextures).toEqual([{ orgTexName: "ANCIENT_CRAB_A.TGA", changeTexName: "ANCIENT_CRAB_A_A.TGA" }, { orgTexName: "ANCIENT_CRAB_B.TGA", changeTexName: "ANCIENT_CRAB_B_B.TGA" }]);
    expect(f.multiStage1).toEqual({ blendTexName: "BLEND.TGA", colorOp: 4 });
    expect(f.multiStage2).toEqual({ blendTexName: "", colorOp: 0 });
    expect(f.aniData.map((a) => a.name)).toEqual(["Smile", "Wait"]);
    expect(f.aniData[0]!.events).toEqual([{ orgTexName: "FACE.TGA", changeTexName: "FACE_SMILE.TGA", start: 0.5, end: 1 }]);
    expect(f.aniData[1]!.transitionTime).toBe(0.25);
    expect(f.findAniDataIndex("SMILE")).toBe(0);
    expect(f.findAniDataIndex("wait")).toBe(1);
    expect(f.findAniDataIndex("missing")).toBe(-1);
    expect(f.findAniDataIndex("")).toBe(-1);
  });

  test("a table sorted case-sensitively defeats the exe's case-insensitive binary search (shipped data has such files)", () => {
    const entry = (name: string): { name: string; transition: number; max: number; first: number; num: number } => ({ name, transition: 0, max: 1, first: 0, num: 0 });
    const ordinal = parseXet(buildXet({ ani: [entry("CR_Wait"), entry("ComboX4")] }))!; // 'R' < 'o' in ordinal order
    expect(ordinal.findAniDataIndex("CR_Wait")).toBe(-1);
    expect(ordinal.findAniDataIndex("ComboX4")).toBe(-1);
    const folded = parseXet(buildXet({ ani: [entry("ComboX4"), entry("CR_Wait")] }))!;
    expect(folded.findAniDataIndex("CR_Wait")).toBe(1);
    expect(folded.findAniDataIndex("COMBOX4")).toBe(0);
  });

  test("not an XET file => undefined (the exe treats it as 'no data'); truncated tables throw", () => {
    expect(parseXet(Uint8Array.from([1, 2, 3]))).toBeUndefined();
    expect(parseXet(new Uint8Array(40))).toBeUndefined();
    const f = buildXet({ changes: [["A", "B"]] });
    expect(() => parseXet(f.subarray(0, 40))).toThrow(RangeError);
  });

  test("_wcsicmp ordering", () => {
    expect(compareIgnoreCase("abc", "ABC")).toBe(0);
    expect(compareIgnoreCase("ab", "ABC")).toBeLessThan(0);
    expect(compareIgnoreCase("CR_X", "ComboX")).toBeGreaterThan(0);
    expect(compareIgnoreCase("_", "a")).toBeLessThan(0); // 0x5F < 0x61 after lower-casing
  });
});
