import { describe, expect, test } from "bun:test";
import { parseXFile, XFileError } from "../src/index.ts";
import type { XObject } from "../src/index.ts";

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("text X files", () => {
  const text = `xof 0303txt 0032
// a user template next to the built-in ones
template Pair {
  <00000000-0000-0000-0000-000000000001>
  FLOAT a;
  FLOAT b;
}
Pair p1 { 1.5; 2.5;; }
Frame Root {
  FrameTransformMatrix {
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    5.0, 6.0, 7.0, 1.0;;
  }
  Mesh {
    3;
    0.0;0.0;0.0;,
    1.0;0.0;0.0;,
    0.0;1.0;0.0;;
    1;
    3;0,1,2;;
    MeshMaterialList {
      1;
      1;
      0;
      Material {
        1.0;0.5;0.25;1.0;;
        8.0;
        0.0;0.0;0.0;;
        0.0;0.0;0.0;;
        TextureFilename { "a.tga"; }
      }
    }
  }
}
AnimationSet Walk {
  Animation {
    { Root }
    AnimationKey { 2; 2; 0; 3; 1.0,2.0,3.0;;, 4800; 3; 4.0,5.0,6.0;;; }
  }
}
`;

  test("user templates, nested objects, arrays of structs, references", () => {
    const f = parseXFile(enc(text));
    expect(f.format).toBe("txt");
    expect(f.floatSize).toBe(32);
    expect(f.templates.has("Pair")).toBe(true);
    expect(f.templates.has("Mesh")).toBe(true); // the standard templates are built in
    expect(f.objects.map((o) => `${o.type}:${o.name}`)).toEqual(["Pair:p1", "Frame:Root", "AnimationSet:Walk"]);
    expect(f.objects[0]!.data).toEqual({ a: 1.5, b: 2.5 });

    const frame = f.objects[1]!;
    const kids = frame.children.filter((c): c is XObject => c.kind === "object");
    expect(kids.map((c) => c.type)).toEqual(["FrameTransformMatrix", "Mesh"]);
    expect((kids[0]!.data.frameMatrix as { matrix: number[] }).matrix.slice(12)).toEqual([5, 6, 7, 1]);

    const mesh = kids[1]!;
    expect(mesh.data.nVertices).toBe(3);
    expect(mesh.data.vertices).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    expect(mesh.data.faces).toEqual([{ nFaceVertexIndices: 3, faceVertexIndices: [0, 1, 2] }]);
    const list = mesh.children[0] as XObject;
    expect(list.type).toBe("MeshMaterialList");
    expect(list.data.faceIndexes).toEqual([0]);
    const material = list.children[0] as XObject;
    expect(material.type).toBe("Material");
    expect(material.data.faceColor).toEqual({ red: 1, green: 0.5, blue: 0.25, alpha: 1 });
    expect(material.data.power).toBe(8);
    expect((material.children[0] as XObject).data.filename).toBe("a.tga");

    const anim = f.objects[2]!.children[0] as XObject;
    const ref = anim.children[0]!;
    expect(ref.kind).toBe("ref");
    if (ref.kind === "ref") expect(ref.target).toBe(frame); // references resolve to the object defined earlier
    const key = anim.children[1] as XObject;
    expect(key.data.keyType).toBe(2);
    expect(key.data.nKeys).toBe(2);
    expect(key.data.keys).toEqual([
      { time: 0, tfkeys: { nValues: 3, values: [1, 2, 3] } },
      { time: 4800, tfkeys: { nValues: 3, values: [4, 5, 6] } },
    ]);
  });

  test("errors carry the offset", () => {
    expect(() => parseXFile(enc("xof 0303txt 0032\nFrame { Mesh { 1; 0.0;0.0;"))).toThrow(XFileError);
    expect(() => parseXFile(enc("not an x file at all"))).toThrow(XFileError);
    expect(() => parseXFile(enc("xof 0303txt 0032\nNoSuchTemplate { 1; }"))).toThrow(XFileError);
  });
});

/** Binary token writer (little endian, 32-bit floats). */
class B {
  readonly b: number[] = [...enc("xof 0303bin 0032")];
  u16(v: number): this { this.b.push(v & 255, (v >> 8) & 255); return this; }
  u32(v: number): this { for (let i = 0; i < 4; i++) this.b.push((v >>> (8 * i)) & 255); return this; }
  f32(v: number): this { const t = new DataView(new ArrayBuffer(4)); t.setFloat32(0, v, true); for (let i = 0; i < 4; i++) this.b.push(t.getUint8(i)); return this; }
  name(s: string): this { this.u16(1).u32(s.length); for (const c of s) this.b.push(c.charCodeAt(0)); return this; }
  str(s: string): this { this.u16(2).u32(s.length); for (const c of s) this.b.push(c.charCodeAt(0)); return this.u16(20); }
  ints(v: number[]): this { this.u16(6).u32(v.length); for (const x of v) this.u32(x); return this; }
  floats(v: number[]): this { this.u16(7).u32(v.length); for (const x of v) this.f32(x); return this; }
  guid(): this { this.u16(5); for (let i = 0; i < 16; i++) this.b.push(i + 1); return this; }
  tok(id: number): this { return this.u16(id); }
  bytes(): Uint8Array { return Uint8Array.from(this.b); }
}
const OBRACE = 10, CBRACE = 11, OBRACKET = 14, CBRACKET = 15, DOT = 18, SEMI = 20, TEMPLATE = 31, ARRAY = 52, DWORD = 41, LPSTR = 49;

describe("binary X files", () => {
  /** template Item { <guid> DWORD n; array DWORD values[n]; STRING label; [...] } followed by one Item and a nested Item */
  function build(): Uint8Array {
    const w = new B();
    w.tok(TEMPLATE).name("Item").tok(OBRACE).guid();
    w.tok(DWORD).name("n").tok(SEMI);
    w.tok(ARRAY).tok(DWORD).name("values").tok(OBRACKET).name("n").tok(CBRACKET).tok(SEMI); // dimension by name, then ...
    w.tok(LPSTR).name("label").tok(SEMI);
    w.tok(OBRACKET).tok(DOT).tok(DOT).tok(DOT).tok(CBRACKET); // ... the "open template" restriction (regression: must not be read as a 2nd dimension)
    w.tok(CBRACE);
    w.name("Item").name("first").tok(OBRACE);
    w.ints([3]).ints([10, 20, 30]).str("hi");
    w.name("Item").name("inner").tok(OBRACE).ints([0]).str("").tok(CBRACE); // an empty array writes no list token
    w.tok(CBRACE);
    w.name("AnimTicksPerSecond").tok(OBRACE).ints([4800]).tok(CBRACE); // built-in template, no definition in the file
    w.name("Mesh").tok(OBRACE).ints([1]).floats([1, 2, 3]).ints([1]).ints([3, 0, 0, 0]).tok(CBRACE);
    return w.bytes();
  }

  test("template definition with a named array dimension and an open restriction, STRING members, nested objects", () => {
    const f = parseXFile(build());
    expect(f.format).toBe("bin");
    const item = f.templates.get("Item")!;
    expect(item.members.map((m) => [m.type, m.name, m.dims])).toEqual([["DWORD", "n", []], ["DWORD", "values", ["n"]], ["LPSTR", "label", []]]);
    expect(item.restriction).toBe("open");
    expect(f.objects.map((o) => o.type)).toEqual(["Item", "AnimTicksPerSecond", "Mesh"]);
    const first = f.objects[0]!;
    expect(first.name).toBe("first");
    expect(first.data).toEqual({ n: 3, values: [10, 20, 30], label: "hi" });
    const inner = first.children[0] as XObject;
    expect(inner.name).toBe("inner");
    expect(inner.data).toEqual({ n: 0, values: [], label: "" });
    expect(f.objects[1]!.data.AnimTicksPerSecond).toBe(4800);
  });

  test("float lists feed FLOAT members, truncated data is an error", () => {
    const f = parseXFile(build());
    const mesh = f.objects[2]!;
    expect(mesh.data.nVertices).toBe(1);
    expect(mesh.data.vertices).toEqual([{ x: 1, y: 2, z: 3 }]);
    expect(mesh.data.faces).toEqual([{ nFaceVertexIndices: 3, faceVertexIndices: [0, 0, 0] }]);
    const bytes = build();
    expect(() => parseXFile(bytes.subarray(0, bytes.length - 9))).toThrow(XFileError);
  });
});
