/**
 * A CPU reference for what the quads of the UI do to a picture.  It is written from the rules of Direct3D 9 for pre-transformed
 * (`D3DFVF_XYZRHW`) triangle strips on the fixed-function pipeline, not from `@els/d3d9`, so that a dialog drawn through the device can be
 * compared with it:
 *
 *  - Rasterisation: the centre of pixel (x, y) is the integer point (x, y); the pixel is covered when it lies in [left, right) x [top, bottom)
 *    (the top-left rule), so a quad whose corners are k - 0.5 covers exactly the pixels k, k + 1, ... (the "half-pixel offset").
 *  - Attributes (diffuse colour, u, v) are interpolated linearly over the triangle in screen space (rhw = 1: no perspective correction);
 *    the strip is the triangles (v0, v1, v2) and (v2, v1, v3).
 *  - Sampling: bilinear (min and mag filter LINEAR, one mip level) at the texel centres (k + 0.5) / size, with the addressing mode of the
 *    sampler (WRAP, MIRROR or CLAMP).
 *  - Texture stage 0: colour and alpha are the texture times the diffuse colour (`D3DTOP_MODULATE`).
 *  - Blending: `source * SRCBLEND + destination * DESTBLEND` when alpha blending is on, the source alone when it is off; the target is an
 *    8-bit surface without alpha (X8R8G8B8: the destination alpha reads as 1), rounded to the nearest level after each draw.
 *
 * The alpha test, the z buffer and the culling are not modelled; the UI turns the first two off, and the quads are drawn clockwise.
 */

export interface RefImage {
  readonly width: number;
  readonly height: number;
  /** width * height * 4 bytes, R G B A, first row at the top */
  readonly rgba: Uint8Array;
}

/** one `DrawPrimitive` of the UI: a quad as the four 28-byte vertices of `VertexUI4`, and the device state it is drawn with */
export interface RefQuad {
  /** 4 vertices: x, y, z, rhw (float), diffuse (ARGB dword), u, v (float); left-top, right-top, left-bottom, right-bottom */
  readonly vertices: Uint8Array;
  readonly texture: RefImage | null;
  readonly blendEnable: boolean;
  readonly srcBlend: number;
  readonly destBlend: number;
  readonly minFilter: number;
  readonly magFilter: number;
  readonly addressU: number;
  readonly addressV: number;
  /** how many times the same primitive is drawn (the picture's draw count) */
  readonly numDraws: number;
}

const D3DTEXF_LINEAR = 2;

const wrapIndex = (i: number, n: number, mode: number): number => {
  switch (mode) {
    case 1: return ((i % n) + n) % n; // D3DTADDRESS_WRAP
    case 2: { // D3DTADDRESS_MIRROR
      const m = ((i % (2 * n)) + 2 * n) % (2 * n);
      return m < n ? m : 2 * n - 1 - m;
    }
    case 3: return i < 0 ? 0 : i >= n ? n - 1 : i; // D3DTADDRESS_CLAMP
    default: throw new Error(`reference: addressing mode ${mode} is not modelled`);
  }
};

/** the bilinear sample of `tex` at (u, v), each channel in 0..1 */
export function sampleBilinear(tex: RefImage, u: number, v: number, addressU: number, addressV: number, out: number[]): void {
  const tx = u * tex.width - 0.5;
  const ty = v * tex.height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const xa = wrapIndex(x0, tex.width, addressU);
  const xb = wrapIndex(x0 + 1, tex.width, addressU);
  const ya = wrapIndex(y0, tex.height, addressV);
  const yb = wrapIndex(y0 + 1, tex.height, addressV);
  const p = tex.rgba;
  const w = tex.width;
  const oaa = (ya * w + xa) * 4;
  const oba = (ya * w + xb) * 4;
  const oab = (yb * w + xa) * 4;
  const obb = (yb * w + xb) * 4;
  for (let c = 0; c < 4; c++) {
    const top = p[oaa + c]! * (1 - fx) + p[oba + c]! * fx;
    const bottom = p[oab + c]! * (1 - fx) + p[obb + c]! * fx;
    out[c] = (top * (1 - fy) + bottom * fy) / 255;
  }
}

/** `D3DBLEND_*` factors that need no more than the source and the destination of an opaque target */
function factor(mode: number, sc: number, sa: number, dc: number): number {
  switch (mode) {
    case 1: return 0; // ZERO
    case 2: return 1; // ONE
    case 3: return sc; // SRCCOLOR
    case 4: return 1 - sc; // INVSRCCOLOR
    case 5: return sa; // SRCALPHA
    case 6: return 1 - sa; // INVSRCALPHA
    case 7: return 1; // DESTALPHA (X8R8G8B8: alpha reads as 1)
    case 8: return 0; // INVDESTALPHA
    case 9: return dc; // DESTCOLOR
    case 10: return 1 - dc; // INVDESTCOLOR
    default: throw new Error(`reference: blend factor ${mode} is not modelled`);
  }
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** draw one quad onto `target` (RGBA, modified in place) */
export function drawQuad(target: RefImage, q: RefQuad): void {
  if (q.vertices.length !== 4 * 28) throw new Error("reference: a quad is four 28-byte vertices");
  if (!q.texture) throw new Error("reference: a quad without a texture is not modelled");
  if (q.minFilter !== D3DTEXF_LINEAR || q.magFilter !== D3DTEXF_LINEAR) throw new Error("reference: only linear filtering is modelled");
  const dv = new DataView(q.vertices.buffer, q.vertices.byteOffset, q.vertices.byteLength);
  const X: number[] = [];
  const Y: number[] = [];
  const U: number[] = [];
  const V: number[] = [];
  const C: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const o = i * 28;
    X.push(dv.getFloat32(o, true));
    Y.push(dv.getFloat32(o + 4, true));
    if (dv.getFloat32(o + 12, true) !== 1) throw new Error("reference: rhw is not 1 (perspective is not modelled)");
    const argb = dv.getUint32(o + 16, true);
    C.push([((argb >>> 16) & 255) / 255, ((argb >>> 8) & 255) / 255, (argb & 255) / 255, (argb >>> 24) / 255]);
    U.push(dv.getFloat32(o + 20, true));
    V.push(dv.getFloat32(o + 24, true));
  }
  if (!(X[0] === X[2] && X[1] === X[3] && Y[0] === Y[1] && Y[2] === Y[3] && X[0]! < X[1]! && Y[0]! < Y[2]!)) {
    throw new Error("reference: only an upright quad (left-top, right-top, left-bottom, right-bottom) is modelled");
  }
  const xl = X[0]!;
  const xr = X[1]!;
  const yt = Y[0]!;
  const yb = Y[2]!;
  const x0 = Math.max(0, Math.ceil(xl));
  const x1 = Math.min(target.width, Math.ceil(xr)); // exclusive: x < right
  const y0 = Math.max(0, Math.ceil(yt));
  const y1 = Math.min(target.height, Math.ceil(yb));
  const tex: number[] = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (let py = y0; py < y1; py++) {
    const t = (py - yt) / (yb - yt);
    for (let px = x0; px < x1; px++) {
      const s = (px - xl) / (xr - xl);
      if (s + t <= 1) { w[0] = 1 - s - t; w[1] = s; w[2] = t; w[3] = 0; } // the triangle (v0, v1, v2)
      else { w[0] = 0; w[1] = 1 - t; w[2] = 1 - s; w[3] = s + t - 1; } // the triangle (v2, v1, v3)
      let u = 0;
      let v = 0;
      const col = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const wi = w[i]!;
        if (wi === 0) continue;
        u += wi * U[i]!;
        v += wi * V[i]!;
        for (let c = 0; c < 4; c++) col[c]! += wi * C[i]![c]!;
      }
      sampleBilinear(q.texture, u, v, q.addressU, q.addressV, tex);
      const sr = clamp01(tex[0]! * col[0]!);
      const sg = clamp01(tex[1]! * col[1]!);
      const sb = clamp01(tex[2]! * col[2]!);
      const sa = clamp01(tex[3]! * col[3]!);
      const o = (py * target.width + px) * 4;
      for (let n = 0; n < q.numDraws; n++) {
        if (q.blendEnable) {
          const dr = target.rgba[o]! / 255;
          const dg = target.rgba[o + 1]! / 255;
          const db = target.rgba[o + 2]! / 255;
          target.rgba[o] = Math.round(255 * clamp01(sr * factor(q.srcBlend, sr, sa, dr) + dr * factor(q.destBlend, sr, sa, dr)));
          target.rgba[o + 1] = Math.round(255 * clamp01(sg * factor(q.srcBlend, sg, sa, dg) + dg * factor(q.destBlend, sg, sa, dg)));
          target.rgba[o + 2] = Math.round(255 * clamp01(sb * factor(q.srcBlend, sb, sa, db) + db * factor(q.destBlend, sb, sa, db)));
        } else {
          target.rgba[o] = Math.round(255 * sr);
          target.rgba[o + 1] = Math.round(255 * sg);
          target.rgba[o + 2] = Math.round(255 * sb);
        }
        target.rgba[o + 3] = 255;
      }
    }
  }
}

/** a target cleared to an opaque colour */
export function newTarget(width: number, height: number, r: number, g: number, b: number): RefImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

export interface Difference {
  pixels: number;
  /** pixels with a channel (R, G or B) off by more than `tolerance` */
  over: number;
  /** the largest difference of any channel */
  max: number;
  /** the mean absolute difference of the colour channels */
  mean: number;
  /** a pixel that is over, for the message of a failure */
  firstOver: { x: number; y: number; a: number[]; b: number[] } | null;
}

/** how far two pictures of the same size are apart (the alpha channel does not count) */
export function compareImages(a: RefImage, b: RefImage, tolerance: number): Difference {
  if (a.width !== b.width || a.height !== b.height) throw new Error("compareImages: sizes differ");
  let over = 0;
  let max = 0;
  let sum = 0;
  let firstOver: Difference["firstOver"] = null;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.rgba[i * 4 + c]! - b.rgba[i * 4 + c]!);
      sum += d;
      if (d > worst) worst = d;
    }
    if (worst > max) max = worst;
    if (worst > tolerance) {
      over++;
      firstOver ??= { x: i % a.width, y: Math.floor(i / a.width), a: [...a.rgba.subarray(i * 4, i * 4 + 3)], b: [...b.rgba.subarray(i * 4, i * 4 + 3)] };
    }
  }
  return { pixels: n, over, max, mean: sum / (3 * n), firstOver };
}
