/**
 * Synthetic TrueType fonts: what the five fonts of the HK client never do.
 *
 * Their glyph programs use 80 of the 119 instructions of the TrueType bytecode, their composites use a few of the twelve flags, their `hmtx` always
 * agrees with the glyph's own bounding box and their `prep` never switches the graphics state off.  An implementation of the bytecode interpreter
 * that is wrong in one of the other places is invisible in any test made of those fonts.  So the differential test (tools/verify-freetype.ts,
 * layer `synth`, run against the exe's own FreeType) also loads these: a font per seed with random simple glyphs, composites with every flag, random hinting
 * programs over every instruction (the arguments are chosen so that most references are valid and some are not), and a random `fpgm` / `prep` /
 * `cvt `.  Everything is derived from the seed with a fixed generator, so the same spec gives the same bytes (the fixture holds the font's SHA-1).
 *
 * The result is not a font that looks like anything; it is a test input.  Nothing in packages/freetype/src imports this file.
 */
export interface SynthSpec {
  name: string;
  seed: number;
  unitsPerEm: number;
  /** glyphs 3 .. 3 + nSimple - 1 are simple glyphs with a random program; 0 is a box, 1 is empty, 2 has contours and no instructions */
  nSimple: number;
  nComposite: number;
  nCvt: number;
  nStore: number;
  nFuncs: number;
  nTwilight: number;
  /** prep ends with INSTCTRL(selector 2, value 2): the glyphs start from the default graphics state */
  instctrl2: boolean;
  /** hmtx: the left side bearing of a glyph is not its xMin (the outline is moved back by `xMin - lsb`) */
  skewLsb: boolean;
  longLoca: boolean;
  /** head.flags bit 3: the ppem is rounded to an integer */
  integerPpem: boolean;
  /** maxp.maxSizeOfInstructions: 0 = the longest program, else this many (a glyph with a longer program is refused: FT_Err_Too_Many_Hints) */
  maxIns: number;
}

export interface SynthFont {
  bytes: Uint8Array;
  nGlyphs: number;
  spec: SynthSpec;
}

// ------------------------------------------------------------------------------------------------------------------ the generator
export class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed | 0;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** 0 .. n - 1 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(a: readonly T[]): T {
    return a[this.int(a.length)]!;
  }
}

class Bytes {
  readonly a: number[] = [];
  u8(v: number): this {
    this.a.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    this.a.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  u32(v: number): this {
    this.a.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }
  bytes(b: ArrayLike<number>): this {
    for (let i = 0; i < b.length; i++) this.a.push(b[i]! & 0xff);
    return this;
  }
  get length(): number {
    return this.a.length;
  }
  pad4(): this {
    while (this.a.length % 4) this.a.push(0);
    return this;
  }
}

const clamp16 = (v: number): number => Math.max(-32768, Math.min(32767, v));

// ------------------------------------------------------------------------------------------------------------------ programs
/** what a program may refer to */
interface Ctx {
  nPts: number; // the points of the zone the glyph's program runs on, without the four phantom points
  nContours: number;
  nCvt: number;
  nStore: number;
  nFuncs: number;
  nTwilight: number;
  /** prep: the twilight zone is the only zone with points */
  prep: boolean;
  /**
   * every reference is valid, nothing divides by zero, nothing is DEBUG: the program of `fpgm` and `prep` is, so that a pedantic load (which turns what the
   * others ignore into an error) gets past them and fails, if it does, in a glyph's own program
   */
  clean: boolean;
  /** the opcode of an IDEF this font defines (0 = none) */
  userOp: number;
}

/** a program is built from statements, each pushes its own arguments and then runs one instruction or a small structure */
class Prog {
  readonly b: number[] = [];
  constructor(
    private readonly g: Rng,
    private readonly c: Ctx,
  ) {}

  /** the arguments, pushed the way the font's own programs do: PUSHB, NPUSHB, PUSHW or NPUSHW (a word is signed) */
  private push(vals: number[]): void {
    if (vals.length === 0) return;
    const bytesOk = vals.every((v) => v >= 0 && v <= 255);
    if (bytesOk && vals.length <= 8 && this.g.chance(0.7)) {
      this.b.push(0xb0 + vals.length - 1, ...vals);
    } else if (bytesOk && this.g.chance(0.5)) {
      this.b.push(0x40, vals.length, ...vals);
    } else if (vals.length <= 8 && this.g.chance(0.6)) {
      this.b.push(0xb8 + vals.length - 1);
      for (const v of vals) this.b.push((clamp16(v) >> 8) & 0xff, clamp16(v) & 0xff);
    } else {
      this.b.push(0x41, vals.length);
      for (const v of vals) this.b.push((clamp16(v) >> 8) & 0xff, clamp16(v) & 0xff);
    }
  }

  private op(code: number, ...args: number[]): void {
    this.push(args);
    this.b.push(code);
  }

  // argument kinds
  private pt(): number {
    const g = this.g;
    const c = this.c;
    const tw = Math.max(1, c.nTwilight);
    if (c.clean) return g.int(c.prep ? tw : Math.min(tw, c.nPts + 4));
    if (g.chance(0.04)) return g.pick([c.nPts + 4, c.nPts + 9, 255, 1000]);
    if (c.prep || g.chance(0.25)) return g.int(tw);
    return g.int(c.nPts + 4);
  }
  private cvt(): number {
    return !this.c.clean && this.g.chance(0.04) ? this.c.nCvt + this.g.int(5) : this.g.int(this.c.nCvt);
  }
  private sto(): number {
    return !this.c.clean && this.g.chance(0.04) ? this.c.nStore + this.g.int(5) : this.g.int(this.c.nStore);
  }
  private dist(): number {
    const g = this.g;
    if (g.chance(0.6)) return g.pick([0, 0, 1, -1, 8, -8, 16, 32, -32, 63, 64, -64, 65, 96, 128, -128, 192, 256, 320, 640]);
    return g.range(-400, 400);
  }
  private vec(): number {
    return this.g.pick([0, 0, 0x4000, -0x4000, 0x2d41, -0x2d41, 0x3fff, 0x1000, 0x3000, -0x2000, 0x1234, -0x0b6a]);
  }
  private small(): number {
    return this.g.chance(0.7) ? this.g.int(8) : this.g.range(-5, 40);
  }
  private zone(): number {
    if (this.c.clean) return 0;
    return this.g.chance(0.5) ? 1 : this.g.chance(0.85) ? 0 : 2;
  }
  private fn(): number {
    return !this.c.clean && this.g.chance(0.05) ? this.c.nFuncs + this.g.int(3) : this.g.int(Math.max(1, this.c.nFuncs));
  }
  private selector(): number {
    return this.g.pick([0x48, 0x68, 0x58, 0x78, 0x08, 0x80, 0x4f, 0xc0, 0x00, 0x41, 0x2a, 0x74]);
  }

  /** a vector made of two unit components (or an odd one) */
  private vecPair(): [number, number] {
    const g = this.g;
    if (g.chance(0.6)) {
      const t = g.next() * Math.PI * 2;
      return [Math.round(Math.cos(t) * 0x4000), Math.round(Math.sin(t) * 0x4000)];
    }
    return [this.vec(), this.vec()];
  }

  /** one statement */
  stmt(depth = 0): void {
    const g = this.g;
    const c = this.c;
    const r = g.next();
    const pointOps = !c.prep || g.chance(0.3);
    if (r < 0.1) {
      // the vectors
      const k = g.int(14);
      if (k < 6) this.b.push(k);
      else if (k === 6) this.op(g.pick([0x06, 0x07]), this.pt(), this.pt());
      else if (k === 7) this.op(g.pick([0x08, 0x09]), this.pt(), this.pt());
      else if (k === 8) this.op(0x0a, ...this.vecPair());
      else if (k === 9) this.op(0x0b, ...this.vecPair());
      else if (k === 10) this.b.push(...g.pick([[0x0c, 0x0b], [0x0d, 0x0a], [0x0c, 0x0b], [0x0d, 0x0a], [0x0c, 0x21, 0x21], [0x0d, 0x21, 0x21]])); // GPV SFVFS, GFV SPVFS, or push and drop
      else if (k === 11) this.b.push(g.pick([0x0c, 0x0d]), 0x23, 0x60); // swap, add: reads the pushed numbers
      else if (k === 12) this.b.push(0x0e);
      else this.op(g.pick([0x86, 0x87]), this.pt(), this.pt());
    } else if (r < 0.18) {
      // reference points and zones
      const k = g.int(7);
      if (k < 3) this.op(0x10 + k, this.pt());
      else this.op(0x13 + (k - 3), this.zone());
    } else if (r < 0.24) {
      // the rounding state and the parameters of the graphics state
      const k = g.int(20);
      if (k < 6) this.b.push(g.pick([0x18, 0x19, 0x3d, 0x7a, 0x7c, 0x7d]));
      else if (k === 6) this.op(0x76, this.selector());
      else if (k === 7) this.op(0x77, this.selector());
      else if (k === 8) this.op(0x17, g.range(0, 4));
      else if (k === 9) this.op(0x1a, g.pick([0, 16, 32, 64, 96]));
      else if (k === 10) this.op(0x1d, g.pick([0, 17, 68, 200, 1000]));
      else if (k === 11) this.op(0x1e, this.dist());
      else if (k === 12) this.op(0x1f, g.range(-100, 200));
      else if (k === 13) this.op(0x5e, g.range(0, 12));
      else if (k === 14) this.op(0x5f, g.range(0, 6));
      else if (k === 15) this.b.push(g.pick([0x4d, 0x4e]));
      else if (k === 16) this.op(g.pick([0x7e, 0x7f]), g.range(0, 90));
      else if (k === 17) this.op(0x85, g.pick([0x0000, 0x00ff, 0x0108, 0x0210, 0x0405, 0x0805, 0x010b, 0x0a0a]));
      else if (k === 18) this.op(0x8d, g.pick([0, 1, 2, 4, 5, 6, -1]));
      else if (c.prep) this.b.push(0x24, 0x21);
      else if (g.chance(0.5)) this.op(0x8e, g.pick([0, 2]), 2); // bit 2: the graphics state the next load starts from
      else if (g.chance(0.6)) this.op(0x8e, g.pick([0, 2]), g.pick([3, 0, 4])); // not a selector
      else this.op(0x8e, 0, 1); // bit 1 is cleared: harmless (a set bit would stop the hinting of every later load)
    } else if (r < 0.5 && pointOps) {
      // moving points
      const k = g.int(26);
      if (k < 2) this.op(0x2e + k, this.pt());
      else if (k < 4) this.op(0x3e + (k - 2), this.pt(), this.cvt());
      else if (k < 8) this.op(0xc0 + g.int(32), this.pt());
      else if (k < 12) this.op(0xe0 + g.int(32), this.pt(), this.cvt());
      else if (k === 12) this.op(0x3a + g.int(2), this.pt(), this.dist());
      else if (k === 13) this.op(0x30 + g.int(2));
      else if (k === 14) this.loopOp(0x32 + g.int(2));
      else if (k === 15 && !c.clean) this.op(0x34 + g.int(2), g.chance(0.1) ? c.nContours + 2 : g.int(Math.max(1, c.nContours)));
      else if (k === 16) this.op(0x36 + g.int(2), this.zone());
      else if (k === 17) {
        // SHPIX: the points below the amount
        const n = g.range(1, 3);
        this.op(0x17, n);
        const args: number[] = [];
        for (let i = 0; i < n; i++) args.push(this.pt());
        args.push(this.dist());
        this.op(0x38, ...args);
      } else if (k === 18) this.loopOp(0x39);
      else if (k === 19) this.loopOp(0x3c);
      else if (k === 20) this.op(0x27, this.pt(), this.pt());
      else if (k === 21) this.op(0x29, this.pt());
      else if (k === 22) this.op(0x0f, this.pt(), this.pt(), this.pt(), this.pt(), this.pt());
      else if (k === 23) this.op(0x48, this.pt(), this.dist());
      else if (k === 24) {
        if (g.chance(0.5)) this.loopOp(0x80);
        else this.op(0x81 + g.int(2), this.pt(), this.pt());
      } else this.delta(g.pick([0x5d, 0x71, 0x72, 0x73, 0x74, 0x75]));
    } else if (r < 0.62) {
      // reading and arithmetic on what is on the stack
      const k = g.int(26);
      if (k === 0) this.op(0x46 + g.int(2), this.pt());
      else if (k === 1) this.op(0x49 + g.int(2), this.pt(), this.pt());
      else if (k === 2) this.b.push(g.pick([0x4b, 0x4c]), 0x21);
      else if (k === 3) this.op(0x56 + g.int(2), this.dist());
      else if (k < 8) this.op(0x50 + g.int(6), this.small(), this.small());
      else if (k === 8) this.op(0x5a + g.int(2), this.small(), this.small());
      else if (k === 9) this.op(0x5c, this.small());
      else if (k < 14) this.op(0x60 + g.int(2), this.dist(), this.dist());
      else if (k === 14) this.op(0x62, this.dist(), !c.clean && g.chance(0.05) ? 0 : g.pick([1, 3, 64, -7, 100, 200]));
      else if (k === 15) this.op(0x63, this.dist(), this.dist());
      else if (k < 19) this.op(0x64 + g.int(4), this.dist());
      else if (k === 19) this.op(0x68 + g.int(8), this.dist());
      else if (k === 20) this.op(0x8b + g.int(2), this.dist(), this.dist());
      else if (k === 21) this.op(0x88, g.pick([0, 1, 2, 4, 32, 8, 64, 37, 1 | 32]));
      else if (k === 22) this.op(0x5c, this.small());
      else if (k === 23) {
        // a result is written where a later statement can read it
        this.op(0x42, this.sto(), this.dist());
      } else if (k === 24) {
        this.op(0x43, this.sto());
        this.op(0x42, this.sto());
      } else if (c.clean) this.op(0x56, this.dist());
      else this.op(0x4f, 0);
    } else if (r < 0.7) {
      // the stack
      const k = g.int(10);
      if (k === 0) this.op(0x20, this.small());
      else if (k === 1) this.op(0x21, this.small());
      else if (k === 2) this.b.push(0x22);
      else if (k === 3) this.op(0x23, this.small(), this.small());
      else if (k === 4) this.b.push(0x24, 0x21);
      else if (k === 5) this.op(0x25, this.small(), this.small(), this.small(), c.clean ? g.range(1, 3) : g.range(0, 4));
      else if (k === 6) this.op(0x26, this.small(), this.small(), this.small(), c.clean ? g.range(1, 3) : g.range(0, 4));
      else if (k === 7) this.op(0x8a, this.small(), this.small(), this.small());
      else this.b.push(0x24, 0x21);
    } else if (r < 0.8) {
      // the cvt and the storage
      const k = g.int(7);
      if (k === 0) this.op(0x44, this.cvt(), this.dist());
      else if (k === 1) this.op(0x45, this.cvt());
      else if (k === 2) this.op(0x70, this.cvt(), g.range(-50, 300));
      else if (k === 3) this.op(0x42, this.sto(), this.dist());
      else if (k === 4) this.op(0x43, this.sto());
      else if (k === 5) {
        this.op(0x45, this.cvt());
        this.op(0x44, this.cvt());
      } else {
        this.op(0x43, this.sto());
        this.op(0x44, this.cvt());
      }
    } else if (r < 0.9 && depth < 2) {
      // control flow
      const k = g.int(6);
      if (k === 0) {
        // IF cond ... ELSE ... EIF
        this.op(0x58, g.int(2));
        const n = g.range(0, 3);
        for (let i = 0; i < n; i++) this.stmt(depth + 1);
        if (g.chance(0.6)) {
          this.b.push(0x1b);
          const m = g.range(0, 3);
          for (let i = 0; i < m; i++) this.stmt(depth + 1);
        }
        this.b.push(0x59);
      } else if (k <= 3) {
        // a jump forward over a block: JMPR (offset), JROT / JROF (offset, condition); the offset counts from the jump itself
        const sub = new Prog(g, c);
        const n = g.range(1, 3);
        for (let i = 0; i < n; i++) sub.stmt(depth + 2);
        const kind = g.pick([0x1c, 0x78, 0x79]);
        const offset = 1 + sub.b.length;
        const cond = kind === 0x78 ? g.pick([1, 1, 0]) : kind === 0x79 ? g.pick([0, 0, 1]) : undefined;
        this.push(cond === undefined ? [offset] : [offset, cond]);
        this.b.push(kind, ...sub.b);
      } else if (k === 4 && c.nFuncs > 0) this.op(0x2b, this.fn());
      else if (c.nFuncs > 0) this.op(0x2a, g.range(0, 3), this.fn());
      else this.b.push(0x22);
    } else if (c.userOp && g.chance(0.5)) {
      this.op(c.userOp, this.small());
    } else if (g.chance(0.5)) {
      this.b.push(0x22); // CLEAR keeps the stack from growing for ever
    } else {
      this.op(0x20, this.small());
    }
  }

  /** an instruction that takes its points from the stack as many times as the loop count says: SLOOP n, n points, the instruction */
  private loopOp(code: number): void {
    const g = this.g;
    const n = g.range(1, 4);
    this.op(0x17, n);
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(this.pt());
    this.op(code, ...pts);
  }

  /** DELTAP / DELTAC: n, then n pairs (argument, point or cvt entry) */
  private delta(code: number): void {
    const g = this.g;
    const n = g.range(1, 3);
    const args: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = g.range(0, 0xff);
      args.push(v, code >= 0x73 && code <= 0x75 ? this.cvt() : this.pt());
    }
    args.push(n);
    this.op(code, ...args);
  }

  /** `n` statements */
  body(n: number): this {
    for (let i = 0; i < n; i++) this.stmt();
    return this;
  }
}

// ------------------------------------------------------------------------------------------------------------------ glyphs
interface Pt {
  x: number;
  y: number;
  on: boolean;
}

interface SimpleGlyph {
  kind: "simple";
  contours: Pt[][];
  ins: number[];
}

interface Component {
  glyph: number;
  flags: number;
  args: [number, number];
  /** 2.14 values: [xx] / [xx, yy] / [xx, xy, yx, yy] */
  transform: number[];
}

interface CompositeGlyph {
  kind: "composite";
  components: Component[];
  ins: number[] | null;
}

type Glyph = SimpleGlyph | CompositeGlyph | { kind: "empty" };

function randomContours(g: Rng, em: number): Pt[][] {
  const nc = 1 + g.int(3);
  const out: Pt[][] = [];
  for (let c = 0; c < nc; c++) {
    const n = 3 + g.int(7);
    const cx = g.range(Math.round(em * 0.2), Math.round(em * 0.8));
    const cy = g.range(Math.round(em * 0.1), Math.round(em * 0.7));
    const rad = g.range(Math.round(em * 0.05), Math.round(em * 0.4));
    const pts: Pt[] = [];
    const allOff = g.chance(0.05);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + g.next() * 0.4;
      const rr = rad * (0.6 + g.next() * 0.6);
      pts.push({ x: Math.round(cx + Math.cos(t) * rr), y: Math.round(cy + Math.sin(t) * rr), on: allOff ? false : g.chance(0.62) });
    }
    if (g.chance(0.15)) pts.forEach((p) => ((p.x = Math.round(p.x / 16) * 16), (p.y = Math.round(p.y / 16) * 16)));
    out.push(pts);
  }
  return out;
}

function encodeSimple(gl: SimpleGlyph): { data: number[]; bbox: [number, number, number, number]; nPoints: number } {
  const pts = gl.contours.flat();
  const w = new Bytes();
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const bbox: [number, number, number, number] = pts.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0];
  w.u16(gl.contours.length);
  for (const v of bbox) w.u16(v & 0xffff);
  let end = -1;
  for (const c of gl.contours) {
    end += c.length;
    w.u16(end);
  }
  w.u16(gl.ins.length).bytes(gl.ins);
  // flags (with the repeat form), then the x and y deltas in the short or long form
  const flags: number[] = [];
  const xd: number[] = [];
  const yd: number[] = [];
  let px = 0;
  let py = 0;
  for (const p of pts) {
    let f = p.on ? 1 : 0;
    const dx = p.x - px;
    const dy = p.y - py;
    if (dx === 0) f |= 0x10;
    else if (Math.abs(dx) < 256) {
      f |= 0x02 | (dx > 0 ? 0x10 : 0);
      xd.push(Math.abs(dx));
    } else {
      xd.push(dx & 0xffff);
    }
    if (dy === 0) f |= 0x20;
    else if (Math.abs(dy) < 256) {
      f |= 0x04 | (dy > 0 ? 0x20 : 0);
      yd.push(Math.abs(dy));
    } else {
      yd.push(dy & 0xffff);
    }
    flags.push(f);
    px = p.x;
    py = p.y;
  }
  for (let i = 0; i < flags.length; ) {
    let j = i + 1;
    while (j < flags.length && flags[j] === flags[i] && j - i < 256) j++;
    if (j - i >= 3) {
      w.u8(flags[i]! | 0x08).u8(j - i - 1);
      i = j;
    } else {
      w.u8(flags[i]!);
      i++;
    }
  }
  // the widths follow the flags: recompute them from the flags in order
  let xi = 0;
  let yi = 0;
  for (const f of flags) {
    if (f & 0x02) w.u8(xd[xi++]!);
    else if (!(f & 0x10)) w.u16(xd[xi++]!);
  }
  for (const f of flags) {
    if (f & 0x04) w.u8(yd[yi++]!);
    else if (!(f & 0x20)) w.u16(yd[yi++]!);
  }
  return { data: w.a, bbox, nPoints: pts.length };
}

function encodeComposite(gl: CompositeGlyph, bbox: [number, number, number, number]): number[] {
  const w = new Bytes();
  w.u16(0xffff);
  for (const v of bbox) w.u16(v & 0xffff);
  gl.components.forEach((c, i) => {
    let f = c.flags & ~0x20;
    if (i < gl.components.length - 1) f |= 0x20;
    if (gl.ins && i === gl.components.length - 1) f |= 0x100;
    else f &= ~0x100;
    w.u16(f).u16(c.glyph);
    if (f & 1) w.u16(c.args[0] & 0xffff).u16(c.args[1] & 0xffff);
    else w.u8(c.args[0]).u8(c.args[1]);
    for (const t of c.transform) w.u16(t & 0xffff);
  });
  if (gl.ins) w.u16(gl.ins.length).bytes(gl.ins);
  return w.a;
}

// ------------------------------------------------------------------------------------------------------------------ tables
function checksum(b: number[]): number {
  let s = 0;
  for (let i = 0; i < b.length; i += 4) s = (s + (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
  return s;
}

export function synthFont(spec: SynthSpec): SynthFont {
  const g = new Rng(spec.seed);
  const em = spec.unitsPerEm;
  const nSimpleBase = 3;
  const nGlyphs = nSimpleBase + spec.nSimple + spec.nComposite;
  const userOp = 0x91;
  const ctx = (nPts: number, nContours: number, prep = false, clean = false): Ctx => ({
    nPts,
    nContours,
    nCvt: spec.nCvt,
    nStore: spec.nStore,
    nFuncs: spec.nFuncs,
    nTwilight: spec.nTwilight,
    prep,
    clean,
    userOp,
  });

  // the font's own programs: functions and one instruction definition in fpgm, the setup in prep
  const fpgm: number[] = [];
  for (let f = 0; f < spec.nFuncs; f++) {
    const body = new Prog(g, { ...ctx(3, 1, false, true), nFuncs: f }); // a function only calls the ones before it
    body.body(g.range(1, 5));
    fpgm.push(0xb0, f, 0x2c, ...body.b, 0x2d);
  }
  {
    const body = new Prog(g, { ...ctx(3, 1, false, true), nFuncs: 0, userOp: 0 });
    body.body(g.range(1, 3));
    fpgm.push(0xb0, userOp, 0x89, ...body.b, 0x2d);
  }
  const prep: number[] = [];
  {
    const p = new Prog(g, ctx(0, 0, true, true));
    // the grayscale flag, to a place the glyph programs read from (GETINFO 32 into storage 0); all three zone pointers on the twilight zone, whose first two
    // points get their position from the cvt
    prep.push(0xb1, 0, 32, 0x88, 0x42);
    prep.push(0xb0, 0, 0x16, 0xb1, 0, 0, 0x3e, 0xb1, 1, 1, 0x3e);
    p.body(g.range(6, 18));
    prep.push(...p.b);
    if (spec.instctrl2) {
      // the scan conversion mode is on and not the default; then the glyphs start from the default state again, so a load that runs no program (the empty glyph)
      // reports the default mode, not this one
      prep.push(0xb8, 0x00, 0xff, 0x85, 0xb0, 4, 0x8d, 0xb1, 2, 2, 0x8e);
    }
  }

  const glyphs: Glyph[] = [];
  glyphs.push({ kind: "simple", contours: [[{ x: 100, y: 0, on: true }, { x: 100, y: 700, on: true }, { x: 500, y: 700, on: true }, { x: 500, y: 0, on: true }]], ins: [] });
  glyphs.push({ kind: "empty" });
  glyphs.push({ kind: "simple", contours: randomContours(g, em), ins: [] });
  for (let i = 0; i < spec.nSimple; i++) {
    const contours = randomContours(g, em);
    const nPts = contours.flat().length;
    const p = new Prog(g, ctx(nPts, contours.length));
    p.body(g.range(2, 14));
    glyphs.push({ kind: "simple", contours, ins: p.b });
  }
  const sizes = glyphs.map((gl) => (gl.kind === "simple" ? encodeSimple(gl).nPoints : 0));
  sizes[0] = 4;
  const ptsOf = new Map<number, number>(sizes.map((n, i) => [i, n]));
  const bboxOf = (gi: number): [number, number, number, number] => {
    const gl = glyphs[gi]!;
    return gl.kind === "simple" ? encodeSimple(gl).bbox : [0, 0, 0, 0];
  };
  for (let i = 0; i < spec.nComposite; i++) {
    const gi = glyphs.length;
    const nComp = g.range(1, 3);
    const components: Component[] = [];
    let total = 0;
    for (let k = 0; k < nComp; k++) {
      // a component is a simple glyph, or (rarely) an earlier composite
      const cand = g.chance(0.15) && gi > nSimpleBase + spec.nSimple ? g.range(nSimpleBase + spec.nSimple, gi - 1) : g.range(0, nSimpleBase + spec.nSimple - 1);
      let flags = 0;
      const xy = k === 0 || g.chance(0.8);
      if (xy) flags |= 0x02;
      if (xy && g.chance(0.3)) flags |= 0x04;
      let args: [number, number];
      if (xy) {
        const big = g.chance(0.3);
        args = big ? [g.range(-300, 300), g.range(-300, 300)] : [g.range(-100, 100), g.range(-100, 100)];
        if (big || args.some((v) => v < -128 || v > 127)) flags |= 0x01;
      } else {
        // matched points: a point of what is built so far, a point of the component (some indices are wrong)
        const base = g.chance(0.05) ? 500 : g.int(Math.max(1, total));
        const comp = g.chance(0.05) ? 500 : g.int(Math.max(1, ptsOf.get(cand) ?? 1));
        args = [base, comp];
        if (base > 255 || comp > 255 || g.chance(0.2)) flags |= 0x01;
      }
      let transform: number[] = [];
      const t = g.next();
      if (t < 0.15) {
        flags |= 0x08;
        transform = [g.range(0x2000, 0x5000)];
      } else if (t < 0.3) {
        flags |= 0x40;
        transform = [g.range(0x2000, 0x5000), g.range(0x2800, 0x4800)];
      } else if (t < 0.45) {
        flags |= 0x80;
        transform = [g.range(0x3000, 0x4000), g.range(-0x1000, 0x1000), g.range(-0x1000, 0x1000), g.range(0x3000, 0x4000)];
      }
      if (g.chance(0.25)) flags |= 0x200;
      if (xy && g.chance(0.25)) flags |= 0x800;
      if (xy && g.chance(0.12)) flags |= 0x1000;
      if (g.chance(0.1)) flags |= 0x400;
      components.push({ glyph: cand, flags, args, transform });
      total += ptsOf.get(cand) ?? 0;
    }
    let ins: number[] | null = null;
    if (g.chance(0.45)) {
      const p = new Prog(g, ctx(total, 1));
      p.body(g.range(1, 8));
      ins = p.b;
    }
    glyphs.push({ kind: "composite", components, ins });
    ptsOf.set(gi, total);
  }
  // the bounding boxes of the composites: the union of what they are made of (offsets are not applied: the loader takes the header's box as it is)
  const encoded: number[][] = [];
  const bboxes: [number, number, number, number][] = [];
  glyphs.forEach((gl) => {
    if (gl.kind === "empty") {
      encoded.push([]);
      bboxes.push([0, 0, 0, 0]);
    } else if (gl.kind === "simple") {
      const e = encodeSimple(gl);
      encoded.push(e.data);
      bboxes.push(e.bbox);
    } else {
      const boxes = gl.components.map((c) => bboxes[c.glyph] ?? bboxOf(c.glyph));
      const bb: [number, number, number, number] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
      encoded.push(encodeComposite(gl, bb));
      bboxes.push(bb);
    }
  });

  // glyf + loca
  const glyf = new Bytes();
  const offsets: number[] = [];
  for (const e of encoded) {
    offsets.push(glyf.length);
    glyf.bytes(e).pad4();
  }
  offsets.push(glyf.length);
  const loca = new Bytes();
  for (const o of offsets) {
    if (spec.longLoca) loca.u32(o);
    else loca.u16(o >> 1);
  }

  // hmtx: the advance, and the left side bearing, which is the glyph's xMin unless the font skews it
  const nHM = nGlyphs - 3;
  const hmtx = new Bytes();
  const advances: number[] = [];
  for (let i = 0; i < nGlyphs; i++) {
    const adv = g.range(Math.round(em * 0.3), Math.round(em * 1.1));
    advances.push(adv);
    const xMin = bboxes[i]![0];
    const lsb = spec.skewLsb && g.chance(0.7) ? xMin + g.pick([-37, -9, 5, 21, 64, 130, -200]) : xMin;
    if (i < nHM) hmtx.u16(adv).u16(lsb & 0xffff);
    else hmtx.u16(lsb & 0xffff);
  }

  // maxp
  const maxPoints = Math.max(...glyphs.map((gl) => (gl.kind === "simple" ? gl.contours.flat().length : 0)));
  const maxContours = Math.max(...glyphs.map((gl) => (gl.kind === "simple" ? gl.contours.length : 0)));
  const maxCompPts = Math.max(...[...ptsOf.values()]);
  const maxIns = Math.max(0, ...glyphs.map((gl) => (gl.kind === "empty" ? 0 : (gl.ins?.length ?? 0))), prep.length, fpgm.length);
  const maxp = new Bytes()
    .u32(0x00010000)
    .u16(nGlyphs)
    .u16(maxPoints)
    .u16(maxContours)
    .u16(maxCompPts)
    .u16(maxContours * 3)
    .u16(2)
    .u16(spec.nTwilight)
    .u16(spec.nStore)
    .u16(spec.nFuncs + 4)
    .u16(4)
    .u16(64)
    .u16(spec.maxIns || maxIns)
    .u16(3)
    .u16(3);

  const allBoxes = bboxes;
  const head = new Bytes()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0)
    .u32(0x5f0f3cf5)
    .u16(spec.integerPpem ? 0x000b : 0x0003)
    .u16(em)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u16(Math.min(...allBoxes.map((b) => b[0])) & 0xffff)
    .u16(Math.min(...allBoxes.map((b) => b[1])) & 0xffff)
    .u16(Math.max(...allBoxes.map((b) => b[2])) & 0xffff)
    .u16(Math.max(...allBoxes.map((b) => b[3])) & 0xffff)
    .u16(0)
    .u16(8)
    .u16(2)
    .u16(spec.longLoca ? 1 : 0)
    .u16(0);

  const hhea = new Bytes()
    .u32(0x00010000)
    .u16(Math.round(em * 0.8))
    .u16(-Math.round(em * 0.2) & 0xffff)
    .u16(0)
    .u16(Math.max(...advances))
    .u16(0)
    .u16(0)
    .u16(Math.max(...allBoxes.map((b) => b[2])) & 0xffff)
    .u16(1)
    .u16(0)
    .u16(0)
    .u32(0)
    .u32(0)
    .u16(0)
    .u16(nHM);

  // cmap: format 4, one segment: code 0x20 + i is glyph i
  const first = 0x20;
  const last = first + nGlyphs - 1;
  const sub = new Bytes()
    .u16(4)
    .u16(16 + 8 * 2)
    .u16(0)
    .u16(4)
    .u16(4)
    .u16(1)
    .u16(0)
    .u16(last)
    .u16(0xffff)
    .u16(0)
    .u16(first)
    .u16(0xffff)
    .u16((0 - first) & 0xffff)
    .u16(1)
    .u16(0)
    .u16(0);
  const cmap = new Bytes().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.a);

  const cvt = new Bytes();
  for (let i = 0; i < spec.nCvt; i++) cvt.u16(g.chance(0.1) ? g.range(-300, 0) & 0xffff : g.range(0, Math.round(em * 1.2)));

  const nameT = new Bytes().u16(0).u16(0).u16(6);
  const post = new Bytes().u32(0x00030000).u32(0).u16(-100 & 0xffff).u16(50).u32(0).u32(0).u32(0).u32(0).u32(0);
  const os2 = new Bytes().u16(0).u16(500).u16(400).u16(5).u16(0);
  while (os2.length < 78) os2.u8(0);

  const tables: [string, number[]][] = [
    ["OS/2", os2.a],
    ["cmap", cmap.a],
    ["cvt ", cvt.a],
    ["fpgm", fpgm],
    ["glyf", glyf.a],
    ["head", head.a],
    ["hhea", hhea.a],
    ["hmtx", hmtx.a],
    ["loca", loca.a],
    ["maxp", maxp.a],
    ["name", nameT.a],
    ["post", post.a],
    ["prep", prep],
  ].filter(([, d]) => (d as number[]).length > 0) as [string, number[]][];

  const out = new Bytes();
  const n = tables.length;
  let sr = 1;
  let es = 0;
  while (sr * 2 <= n) {
    sr *= 2;
    es++;
  }
  out.u32(0x00010000).u16(n).u16(sr * 16).u16(es).u16(n * 16 - sr * 16);
  let off = 12 + 16 * n;
  const dir: number[][] = [];
  for (const [tag, data] of tables) {
    const padded = new Bytes().bytes(data).pad4();
    dir.push(padded.a);
    out.bytes([...tag].map((ch) => ch.charCodeAt(0))).u32(checksum(padded.a)).u32(off).u32(data.length);
    off += padded.length;
  }
  for (const d of dir) out.bytes(d);
  return { bytes: Uint8Array.from(out.a), nGlyphs, spec };
}

/** the sizes (px) and load flags the differential test and the unit test run every glyph of every synthetic font at, in this order (tools/verify-freetype.ts, `synth`) */
export const SYNTH_SIZES = [9, 13, 22];
/**
 * hinted; hinted for a monochrome target (the exe runs `prep` again: the grayscale mode changed); hinted again (and once more); pedantic (the errors the others
 * ignore become results); unhinted.  The same flag sets run more than once per size on purpose: the interpreter's state outlives a load.
 */
export const SYNTH_FLAGS = [8, 0x20008, 8, 0x88, 10];

/** the specs the differential test and the unit test load (a change here changes the bytes: the fixture holds each font's SHA-1) */
export const SYNTH_SPECS: SynthSpec[] = [
  { name: "SYN0", seed: 11, unitsPerEm: 1024, nSimple: 260, nComposite: 90, nCvt: 24, nStore: 8, nFuncs: 4, nTwilight: 8, instctrl2: false, skewLsb: false, longLoca: false, integerPpem: true, maxIns: 0 },
  { name: "SYN1", seed: 22, unitsPerEm: 2048, nSimple: 260, nComposite: 90, nCvt: 24, nStore: 8, nFuncs: 4, nTwilight: 8, instctrl2: true, skewLsb: true, longLoca: true, integerPpem: false, maxIns: 0 },
  { name: "SYN2", seed: 33, unitsPerEm: 1000, nSimple: 260, nComposite: 90, nCvt: 24, nStore: 8, nFuncs: 4, nTwilight: 8, instctrl2: false, skewLsb: true, longLoca: false, integerPpem: false, maxIns: 40 },
];
