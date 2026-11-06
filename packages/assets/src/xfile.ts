/**
 * DirectX `.x` file reader (text and binary; MSZIP-compressed files are inflated first, see mszip.ts).
 *
 * What the client uses (tools/verify-xfiles.ts): 25,204 `bzip` (binary + MSZIP), 105 `txt`, 4 `bin`. `D3DXLoadMeshFromXInMemory`
 * and `D3DXLoadSkinMeshFromXof` read them in the exe; this module reproduces the *file format* (templates + data objects)
 * and leaves the mesh semantics (frame transforms, skinning, animation evaluation) to a later layer (docs/ROADMAP.md, phase 2).
 *
 * Format summary (Microsoft "DirectX file format"; verified on the whole corpus):
 *   header  "xof " + version "0303" + format ("txt " | "bin " | "tzip" | "bzip") + float size ("0032" | "0064")
 *   binary  16-bit tokens: NAME 1 (u32 len + bytes), STRING 2 (u32 len + bytes, then a separator token), INTEGER 3 (u32),
 *           GUID 5 (16 bytes), INTEGER_LIST 6 (u32 n + n x u32), FLOAT_LIST 7 (u32 n + n floats), braces/brackets/separators
 *           10..20, TEMPLATE 31, primitive types 40..51, ARRAY 52. All integer members are stored as 32 bits, FLOAT / DOUBLE
 *           members in the file's float size; consecutive members of one kind share a list.
 *   text    whitespace separated tokens, `;` and `,` separate values, `//` and `#` start comments.
 *   data    `Type [name] { [<guid>] members... children... }`; a child is a nested object or a reference `{ name }`.
 */
import { decompressXFile, isCompressedXFile } from "./mszip.ts";

export class XFileError extends Error {
  constructor(message: string, readonly offset?: number) {
    super(offset === undefined ? message : `${message} (at ${offset})`);
    this.name = "XFileError";
  }
}

export type XValue = number | string | XValue[] | { [member: string]: XValue };

export interface XTemplateMember {
  /** primitive type name (WORD, DWORD, FLOAT, ...) or the name of another template */
  type: string;
  name: string;
  /** array dimensions: a constant or the name of an earlier member of the same template */
  dims: Array<number | string>;
}

export interface XTemplate {
  name: string;
  guid: string;
  members: XTemplateMember[];
  /** `[...]` open, `[A, B]` restricted, absent = closed (children are still accepted) */
  restriction: "closed" | "open" | string[];
}

export interface XObject {
  readonly kind: "object";
  type: string;
  name: string;
  guid: string;
  data: { [member: string]: XValue };
  children: XNode[];
}

export interface XReference {
  readonly kind: "ref";
  name: string;
  guid: string;
  /** the referenced object when it was defined earlier in the file */
  target: XObject | undefined;
}

export type XNode = XObject | XReference;

export interface XFile {
  format: "txt" | "bin";
  floatSize: 32 | 64;
  templates: ReadonlyMap<string, XTemplate>;
  objects: XObject[];
}

const PRIMITIVES = new Set(["WORD", "DWORD", "FLOAT", "DOUBLE", "CHAR", "UCHAR", "SWORD", "SDWORD", "VOID", "STRING", "LPSTR", "UNICODE", "CSTRING"]);

/** Structural token shared by both readers. */
type Tok =
  | { k: "name"; v: string }
  | { k: "guid"; v: string }
  | { k: "int"; v: number }
  | { k: "data"; v: string } // binary only: a list / string token, i.e. member data rather than structure
  | { k: "p"; v: string }; // one of { } [ ] ( ) < > . , ;

interface Source {
  atEnd(): boolean;
  /** next structural token without consuming it (separators `,` `;` are skipped when `skipSeparators`) */
  peek(skipSeparators?: boolean): Tok | undefined;
  next(): Tok;
  readInt(): number;
  readFloat(): number;
  readString(): string;
  position(): number;
}

// ---------------------------------------------------------------------------------------------------------------- binary

const TOK = {
  NAME: 1, STRING: 2, INTEGER: 3, GUID: 5, INTEGER_LIST: 6, FLOAT_LIST: 7, OBRACE: 10, CBRACE: 11, OPAREN: 12, CPAREN: 13,
  OBRACKET: 14, CBRACKET: 15, OANGLE: 16, CANGLE: 17, DOT: 18, COMMA: 19, SEMICOLON: 20, TEMPLATE: 31, ARRAY: 52,
} as const;
const TYPE_TOKENS: Record<number, string> = { 40: "WORD", 41: "DWORD", 42: "FLOAT", 43: "DOUBLE", 44: "CHAR", 45: "UCHAR", 46: "SWORD", 47: "SDWORD", 48: "VOID", 49: "LPSTR", 50: "UNICODE", 51: "CSTRING" };
const PUNCT_TOKENS: Record<number, string> = { 10: "{", 11: "}", 12: "(", 13: ")", 14: "[", 15: "]", 16: "<", 17: ">", 18: ".", 19: ",", 20: ";" };

class BinarySource implements Source {
  private p = 16;
  private intLeft = 0;
  private floatLeft = 0;
  private readonly dv: DataView;
  private peeked: { tok: Tok; end: number } | undefined;
  constructor(private readonly b: Uint8Array, private readonly floatBytes: number) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  position(): number { return this.p; }
  atEnd(): boolean { return this.p >= this.b.length && this.intLeft === 0 && this.floatLeft === 0; }
  private u16(o: number): number {
    if (o + 2 > this.b.length) throw new XFileError("unexpected end of binary data", o);
    return this.dv.getUint16(o, true);
  }
  private u32(o: number): number {
    if (o + 4 > this.b.length) throw new XFileError("unexpected end of binary data", o);
    return this.dv.getUint32(o, true);
  }
  private text(o: number, n: number): string {
    if (o + n > this.b.length) throw new XFileError("string overruns the file", o);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[o + i]!);
    return s;
  }
  private scan(): { tok: Tok; end: number } | undefined {
    if (this.intLeft > 0 || this.floatLeft > 0) throw new XFileError("structure expected inside a numeric list", this.p);
    if (this.p >= this.b.length) return undefined;
    const id = this.u16(this.p);
    const o = this.p + 2;
    if (id === TOK.NAME) {
      const n = this.u32(o);
      return { tok: { k: "name", v: this.text(o + 4, n) }, end: o + 4 + n };
    }
    if (id === TOK.GUID) {
      const d1 = this.u32(o), d2 = this.u16(o + 4), d3 = this.u16(o + 6);
      let tail = "";
      for (let i = 0; i < 8; i++) tail += this.b[o + 8 + i]!.toString(16).padStart(2, "0");
      const g = `${d1.toString(16).padStart(8, "0")}-${d2.toString(16).padStart(4, "0")}-${d3.toString(16).padStart(4, "0")}-${tail.slice(0, 4)}-${tail.slice(4)}`;
      return { tok: { k: "guid", v: g }, end: o + 16 };
    }
    if (id === TOK.INTEGER) return { tok: { k: "int", v: this.u32(o) }, end: o + 4 };
    // template array dimensions may be written as a one-element integer list
    if (id === TOK.INTEGER_LIST && this.u32(o) === 1) return { tok: { k: "int", v: this.u32(o + 4) }, end: o + 8 };
    if (id === TOK.INTEGER_LIST || id === TOK.FLOAT_LIST || id === TOK.STRING) return { tok: { k: "data", v: id === TOK.STRING ? "string" : "list" }, end: this.p };
    if (id === TOK.TEMPLATE) return { tok: { k: "name", v: "template" }, end: o };
    if (id === TOK.ARRAY) return { tok: { k: "name", v: "array" }, end: o };
    const prim = TYPE_TOKENS[id];
    if (prim !== undefined) return { tok: { k: "name", v: prim }, end: o };
    const punct = PUNCT_TOKENS[id];
    if (punct !== undefined) return { tok: { k: "p", v: punct }, end: o };
    throw new XFileError(`unknown token ${id}`, this.p);
  }
  peek(skipSeparators = false): Tok | undefined {
    for (;;) {
      this.peeked ??= this.scan();
      const t = this.peeked?.tok;
      if (skipSeparators && t?.k === "p" && (t.v === ";" || t.v === ",")) { this.p = this.peeked!.end; this.peeked = undefined; continue; }
      return t;
    }
  }
  next(): Tok {
    const t = this.peek();
    if (!t) throw new XFileError("unexpected end of file", this.p);
    this.p = this.peeked!.end;
    this.peeked = undefined;
    return t;
  }
  private takeInt(): number {
    if (this.intLeft === 0) {
      this.peeked = undefined;
      const id = this.u16(this.p);
      if (id === TOK.INTEGER) { const v = this.u32(this.p + 2); this.p += 6; return v; }
      if (id !== TOK.INTEGER_LIST) throw new XFileError(`integer expected, token ${id}`, this.p);
      this.intLeft = this.u32(this.p + 2);
      this.p += 6;
      if (this.intLeft === 0) return this.takeInt();
    }
    const v = this.u32(this.p);
    this.p += 4;
    this.intLeft--;
    return v;
  }
  readInt(): number {
    return this.takeInt();
  }
  readFloat(): number {
    if (this.floatLeft === 0) {
      this.peeked = undefined;
      const id = this.u16(this.p);
      if (id !== TOK.FLOAT_LIST) throw new XFileError(`float list expected, token ${id}`, this.p);
      this.floatLeft = this.u32(this.p + 2);
      this.p += 6;
      if (this.floatLeft === 0) return this.readFloat();
    }
    if (this.p + this.floatBytes > this.b.length) throw new XFileError("unexpected end of binary data", this.p);
    const v = this.floatBytes === 4 ? this.dv.getFloat32(this.p, true) : this.dv.getFloat64(this.p, true);
    this.p += this.floatBytes;
    this.floatLeft--;
    return v;
  }
  readString(): string {
    this.peeked = undefined;
    if (this.intLeft > 0 || this.floatLeft > 0) throw new XFileError("string expected inside a numeric list", this.p);
    const id = this.u16(this.p);
    if (id !== TOK.STRING) throw new XFileError(`string expected, token ${id}`, this.p);
    const n = this.u32(this.p + 2);
    const s = this.text(this.p + 6, n);
    this.p += 6 + n;
    const sep = this.u16(this.p);
    if (sep !== TOK.COMMA && sep !== TOK.SEMICOLON) throw new XFileError("string without separator", this.p);
    this.p += 2;
    return s;
  }
}

// -------------------------------------------------------------------------------------------------------------------- text

class TextSource implements Source {
  private readonly toks: Array<Tok | { k: "num"; v: number; raw: string } | { k: "str"; v: string }> = [];
  private i = 0;
  constructor(text: string) {
    const re = /\s+|\/\/[^\n]*|#[^\n]*|"((?:[^"\\]|\\.)*)"|<([0-9a-fA-F-]{36})>|([{}()[\];,.<>])|([^\s{}()[\];,<>"]+)/y;
    let m: RegExpExecArray | null;
    let p = 0;
    while (p < text.length) {
      re.lastIndex = p;
      m = re.exec(text);
      if (!m) throw new XFileError(`unreadable text near ${JSON.stringify(text.slice(p, p + 20))}`, p);
      p = re.lastIndex;
      if (m[1] !== undefined) this.toks.push({ k: "str", v: m[1].replace(/\\(.)/g, "$1") });
      else if (m[2] !== undefined) this.toks.push({ k: "guid", v: m[2].toLowerCase() });
      else if (m[3] !== undefined) this.toks.push({ k: "p", v: m[3] });
      else if (m[4] !== undefined) {
        const raw = m[4];
        if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw)) this.toks.push({ k: "num", v: Number(raw), raw });
        else if (raw === ".") this.toks.push({ k: "p", v: "." });
        else this.toks.push({ k: "name", v: raw });
      }
    }
  }
  position(): number { return this.i; }
  atEnd(): boolean { return this.i >= this.toks.length; }
  peek(skipSeparators = false): Tok | undefined {
    if (skipSeparators) {
      while (this.i < this.toks.length) {
        const t = this.toks[this.i]!;
        if (t.k === "p" && (t.v === ";" || t.v === ",")) this.i++;
        else break;
      }
    }
    const t = this.toks[this.i];
    if (!t) return undefined;
    if (t.k === "num") return /^[-+]?\d+$/.test(t.raw) ? { k: "int", v: t.v } : { k: "name", v: t.raw };
    if (t.k === "str") return { k: "name", v: t.v };
    return t;
  }
  next(): Tok {
    const t = this.peek();
    if (!t) throw new XFileError("unexpected end of file", this.i);
    this.i++;
    return t;
  }
  private skipSep(): void {
    while (this.i < this.toks.length) {
      const t = this.toks[this.i]!;
      if (t.k === "p" && (t.v === ";" || t.v === ",")) this.i++;
      else break;
    }
  }
  private number(): number {
    this.skipSep();
    const t = this.toks[this.i];
    if (!t || t.k !== "num") throw new XFileError("number expected", this.i);
    this.i++;
    return t.v;
  }
  readInt(): number { return this.number(); }
  readFloat(): number { return this.number(); }
  readString(): string {
    this.skipSep();
    const t = this.toks[this.i];
    if (!t || t.k !== "str") throw new XFileError("string expected", this.i);
    this.i++;
    return t.v;
  }
}

// ---------------------------------------------------------------------------------------------------------------- parser

class Parser {
  readonly templates = new Map<string, XTemplate>();
  readonly byName = new Map<string, XObject>();
  constructor(private readonly src: Source) {}

  expectPunct(p: string): void {
    const t = this.src.next();
    if (t.k !== "p" || t.v !== p) throw new XFileError(`'${p}' expected, got ${JSON.stringify(t.v)}`, this.src.position());
  }

  parseTemplate(): void {
    const nameTok = this.src.next();
    if (nameTok.k !== "name") throw new XFileError("template name expected", this.src.position());
    this.expectPunct("{");
    const g = this.src.next();
    if (g.k !== "guid") throw new XFileError("template GUID expected", this.src.position());
    const tpl: XTemplate = { name: nameTok.v, guid: g.v, members: [], restriction: "closed" };
    for (;;) {
      const t = this.src.next();
      if (t.k === "p" && t.v === "}") break;
      if (t.k === "p" && t.v === "[") {
        const items: string[] = [];
        let open = false;
        for (;;) {
          const r = this.src.next();
          if (r.k === "p" && r.v === "]") break;
          if (r.k === "p" && r.v === ".") open = true;
          else if (r.k === "name") items.push(r.v);
        }
        tpl.restriction = open ? "open" : items;
        continue;
      }
      if (t.k !== "name") throw new XFileError(`template member expected, got ${JSON.stringify(t.v)}`, this.src.position());
      let isArray = false;
      let type = t.v;
      if (type === "array") {
        isArray = true;
        const ty = this.src.next();
        if (ty.k !== "name") throw new XFileError("array element type expected", this.src.position());
        type = ty.v;
      }
      const nm = this.src.peek(true);
      let name = `_${tpl.members.length}`;
      if (nm && nm.k === "name") { name = nm.v; this.src.next(); }
      const dims: Array<number | string> = [];
      if (isArray) {
        for (;;) {
          const b = this.src.peek(false);
          if (!(b && b.k === "p" && b.v === "[")) break;
          this.src.next();
          const d = this.src.next();
          if (d.k === "int") dims.push(d.v);
          else if (d.k === "name") dims.push(d.v);
          else throw new XFileError(`array dimension expected in template ${tpl.name}.${name}, got ${JSON.stringify(d)}`, this.src.position());
          this.expectPunct("]");
        }
      }
      const semi = this.src.peek(false);
      if (semi && semi.k === "p" && semi.v === ";") this.src.next();
      tpl.members.push({ type, name, dims });
    }
    this.templates.set(tpl.name, tpl);
  }

  private readPrimitive(type: string): XValue {
    switch (type) {
      case "FLOAT": case "DOUBLE": return this.src.readFloat();
      case "STRING": case "LPSTR": case "CSTRING": case "UNICODE": return this.src.readString();
      default: return this.src.readInt();
    }
  }

  private readStruct(tpl: XTemplate): { [member: string]: XValue } {
    const out: { [member: string]: XValue } = {};
    for (const m of tpl.members) out[m.name] = this.readMember(m, out);
    return out;
  }

  private readMember(m: XTemplateMember, scope: { [member: string]: XValue }): XValue {
    const element = (): XValue => {
      if (PRIMITIVES.has(m.type)) return this.readPrimitive(m.type);
      const t = this.templates.get(m.type);
      if (!t) throw new XFileError(`unknown template '${m.type}'`, this.src.position());
      return this.readStruct(t);
    };
    const build = (level: number): XValue => {
      if (level === m.dims.length) return element();
      const d = m.dims[level]!;
      const n = typeof d === "number" ? d : scope[d];
      if (typeof n !== "number") throw new XFileError(`array size '${String(d)}' is not a number`, this.src.position());
      const arr: XValue[] = new Array<XValue>(n);
      for (let i = 0; i < n; i++) arr[i] = build(level + 1);
      return arr;
    };
    return build(0);
  }

  /** After `type [name]` and `{` have been consumed. */
  private parseBody(type: string, name: string): XObject {
    const tpl = this.templates.get(type);
    if (!tpl) throw new XFileError(`data object of unknown template '${type}'`, this.src.position());
    let guid = "";
    const g = this.src.peek(true);
    if (g && g.k === "guid") { guid = g.v; this.src.next(); }
    const obj: XObject = { kind: "object", type, name, guid, data: this.readStruct(tpl), children: [] };
    if (name) this.byName.set(name, obj);
    for (;;) {
      const t = this.src.peek(true);
      if (!t) throw new XFileError(`object '${type}' is not closed`, this.src.position());
      if (t.k === "p" && t.v === "}") { this.src.next(); break; }
      if (t.k === "p" && t.v === "{") {
        this.src.next();
        const r = this.src.next();
        let refName = "", refGuid = "";
        if (r.k === "name") refName = r.v;
        else if (r.k === "guid") refGuid = r.v;
        else throw new XFileError("reference expected", this.src.position());
        const g2 = this.src.peek(true);
        if (g2 && g2.k === "guid") { refGuid = g2.v; this.src.next(); }
        this.expectPunct("}");
        obj.children.push({ kind: "ref", name: refName, guid: refGuid, target: this.byName.get(refName) });
        continue;
      }
      if (t.k === "name") {
        this.src.next();
        obj.children.push(this.parseObjectAfterType(t.v));
        continue;
      }
      throw new XFileError(`unexpected ${JSON.stringify(t.v)} inside '${type}'`, this.src.position());
    }
    return obj;
  }

  parseObjectAfterType(type: string): XObject {
    let name = "";
    let t = this.src.next();
    if (t.k === "name") { name = t.v; t = this.src.next(); }
    else if (t.k === "int") { name = String(t.v); t = this.src.next(); }
    if (t.k !== "p" || t.v !== "{") throw new XFileError(`'{' expected after '${type} ${name}'`, this.src.position());
    return this.parseBody(type, name);
  }

  parseFile(): XObject[] {
    const objects: XObject[] = [];
    for (;;) {
      const t = this.src.peek(true);
      if (!t) break;
      if (t.k !== "name") throw new XFileError(`top level: name expected, got ${JSON.stringify(t.v)}`, this.src.position());
      this.src.next();
      if (t.v === "template") this.parseTemplate();
      else objects.push(this.parseObjectAfterType(t.v));
    }
    if (!this.src.atEnd()) throw new XFileError("trailing data after the last object", this.src.position());
    return objects;
  }
}

/** Standard templates of the DirectX file format, used when a file does not declare the ones it needs. */
const STANDARD_TEMPLATES = `
template Header { <3d82ab43-62da-11cf-ab39-0020af71e433> WORD major; WORD minor; DWORD flags; }
template Vector { <3d82ab5e-62da-11cf-ab39-0020af71e433> FLOAT x; FLOAT y; FLOAT z; }
template Coords2d { <f6f23f44-7686-11cf-8f52-0040333594a3> FLOAT u; FLOAT v; }
template Matrix4x4 { <f6f23f45-7686-11cf-8f52-0040333594a3> array FLOAT matrix[16]; }
template ColorRGBA { <35ff44e0-6c7c-11cf-8f52-0040333594a3> FLOAT red; FLOAT green; FLOAT blue; FLOAT alpha; }
template ColorRGB { <d3e16e81-7835-11cf-8f52-0040333594a3> FLOAT red; FLOAT green; FLOAT blue; }
template IndexedColor { <1630b820-7842-11cf-8f52-0040333594a3> DWORD index; ColorRGBA indexColor; }
template TextureFilename { <a42790e1-7810-11cf-8f52-0040333594a3> STRING filename; }
template Material { <3d82ab4d-62da-11cf-ab39-0020af71e433> ColorRGBA faceColor; FLOAT power; ColorRGB specularColor; ColorRGB emissiveColor; [...] }
template MeshFace { <3d82ab5f-62da-11cf-ab39-0020af71e433> DWORD nFaceVertexIndices; array DWORD faceVertexIndices[nFaceVertexIndices]; }
template MeshTextureCoords { <f6f23f40-7686-11cf-8f52-0040333594a3> DWORD nTextureCoords; array Coords2d textureCoords[nTextureCoords]; }
template MeshNormals { <f6f23f43-7686-11cf-8f52-0040333594a3> DWORD nNormals; array Vector normals[nNormals]; DWORD nFaceNormals; array MeshFace faceNormals[nFaceNormals]; }
template MeshVertexColors { <1630b821-7842-11cf-8f52-0040333594a3> DWORD nVertexColors; array IndexedColor vertexColors[nVertexColors]; }
template MeshMaterialList { <f6f23f42-7686-11cf-8f52-0040333594a3> DWORD nMaterials; DWORD nFaceIndexes; array DWORD faceIndexes[nFaceIndexes]; [Material] }
template Mesh { <3d82ab44-62da-11cf-ab39-0020af71e433> DWORD nVertices; array Vector vertices[nVertices]; DWORD nFaces; array MeshFace faces[nFaces]; [...] }
template FrameTransformMatrix { <f6f23f41-7686-11cf-8f52-0040333594a3> Matrix4x4 frameMatrix; }
template Frame { <3d82ab46-62da-11cf-ab39-0020af71e433> [...] }
template FloatKeys { <10dd46a9-775b-11cf-8f52-0040333594a3> DWORD nValues; array FLOAT values[nValues]; }
template TimedFloatKeys { <f406b180-7b3b-11cf-8f52-0040333594a3> DWORD time; FloatKeys tfkeys; }
template AnimationKey { <10dd46a8-775b-11cf-8f52-0040333594a3> DWORD keyType; DWORD nKeys; array TimedFloatKeys keys[nKeys]; }
template AnimationOptions { <e2bf56c0-840f-11cf-8f52-0040333594a3> DWORD openclosed; DWORD positionquality; }
template Animation { <3d82ab4f-62da-11cf-ab39-0020af71e433> [...] }
template AnimationSet { <3d82ab50-62da-11cf-ab39-0020af71e433> [Animation] }
template AnimTicksPerSecond { <9e415a43-7ba6-4a73-8743-b73d47e88476> DWORD AnimTicksPerSecond; }
template XSkinMeshHeader { <3cf169ce-ff7c-44ab-93c0-f78f62d172e2> WORD nMaxSkinWeightsPerVertex; WORD nMaxSkinWeightsPerFace; WORD nBones; }
template VertexDuplicationIndices { <b8d65549-d7c9-4995-89cf-53a9a8b031e3> DWORD nIndices; DWORD nOriginalVertices; array DWORD indices[nIndices]; }
template SkinWeights { <6f0d123b-bad2-4167-a0d0-80224f25fabb> STRING transformNodeName; DWORD nWeights; array DWORD vertexIndices[nWeights]; array FLOAT weights[nWeights]; Matrix4x4 matrixOffset; }
template FVFData { <b6e70a0e-8ef9-4e83-94ad-ecc8b0c04897> DWORD dwFVF; DWORD nDWords; array DWORD data[nDWords]; }
template VertexElement { <f752461c-1e23-48f6-b9f8-8350850f336f> DWORD Type; DWORD Method; DWORD Usage; DWORD UsageIndex; }
template DeclData { <bf22e553-292c-4781-9fea-62bd554bdd93> DWORD nElements; array VertexElement Elements[nElements]; DWORD nDWords; array DWORD data[nDWords]; }
`;

let standardCache: Map<string, XTemplate> | undefined;
function standardTemplates(): Map<string, XTemplate> {
  if (!standardCache) {
    const p = new Parser(new TextSource(STANDARD_TEMPLATES));
    p.parseFile();
    standardCache = p.templates as Map<string, XTemplate>;
  }
  return standardCache;
}

/** Parse a complete X file (any of the four formats). */
export function parseXFile(input: Uint8Array): XFile {
  const bytes = isCompressedXFile(input) ? decompressXFile(input) : input;
  if (bytes.length < 16 || bytes[0] !== 0x78 || bytes[1] !== 0x6f || bytes[2] !== 0x66 || bytes[3] !== 0x20) throw new XFileError("not an X file (missing 'xof ' header)");
  const tag = String.fromCharCode(...bytes.subarray(4, 16));
  if (!tag.startsWith("0303")) throw new XFileError(`unsupported X file version '${tag.slice(0, 4)}'`);
  const fmt = tag.slice(4, 8);
  const floatSize = tag.slice(8, 12) === "0064" ? 64 : tag.slice(8, 12) === "0032" ? 32 : 0;
  if (floatSize === 0) throw new XFileError(`unsupported float size '${tag.slice(8, 12)}'`);
  let src: Source;
  let format: "txt" | "bin";
  if (fmt === "bin ") { src = new BinarySource(bytes, floatSize / 8); format = "bin"; }
  else if (fmt === "txt ") {
    let s = "";
    for (let i = 16; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
    src = new TextSource(s);
    format = "txt";
  } else throw new XFileError(`unsupported X file format '${fmt}'`);
  const parser = new Parser(src);
  for (const [k, v] of standardTemplates()) parser.templates.set(k, v);
  const objects = parser.parseFile();
  return { format, floatSize, templates: parser.templates, objects };
}
