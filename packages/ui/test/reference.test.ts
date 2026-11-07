/**
 * The CPU reference the GPU test of the dialogs compares with (test-gpu/reference.ts): every expected number below is worked out by hand
 * from the Direct3D 9 rules the reference states, so the reference itself is pinned before it judges the device.
 */
import { describe, expect, test } from "bun:test";
import { compareImages, drawQuad, newTarget, sampleBilinear } from "../test-gpu/reference.ts";
import type { RefImage, RefQuad } from "../test-gpu/reference.ts";

/** the four vertices of VertexUI4 for an upright quad; `colors` = left-top, right-top, left-bottom, right-bottom (ARGB) */
function vertices(xl: number, yt: number, xr: number, yb: number, colors: number[] = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff], uv: number[] = [0, 0, 1, 1]): Uint8Array {
  const bytes = new Uint8Array(4 * 28);
  const dv = new DataView(bytes.buffer);
  const corners = [[xl, yt, uv[0]!, uv[1]!], [xr, yt, uv[2]!, uv[1]!], [xl, yb, uv[0]!, uv[3]!], [xr, yb, uv[2]!, uv[3]!]];
  corners.forEach(([x, y, u, v], i) => {
    dv.setFloat32(i * 28, x!, true);
    dv.setFloat32(i * 28 + 4, y!, true);
    dv.setFloat32(i * 28 + 8, 1, true); // z
    dv.setFloat32(i * 28 + 12, 1, true); // rhw
    dv.setUint32(i * 28 + 16, colors[i]! >>> 0, true);
    dv.setFloat32(i * 28 + 20, u!, true);
    dv.setFloat32(i * 28 + 24, v!, true);
  });
  return bytes;
}

const texture = (width: number, height: number, texel: (x: number, y: number) => number[]): RefImage => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(texel(x, y), (y * width + x) * 4);
  return { width, height, rgba };
};

const LINEAR = 2;
const [WRAP, MIRROR, CLAMP] = [1, 2, 3];
const [ZERO, ONE, SRCALPHA, INVSRCALPHA] = [1, 2, 5, 6];

const quad = (v: Uint8Array, tex: RefImage, over: Partial<RefQuad> = {}): RefQuad => ({
  vertices: v, texture: tex, blendEnable: false, srcBlend: ONE, destBlend: ZERO, minFilter: LINEAR, magFilter: LINEAR, addressU: MIRROR, addressV: MIRROR, numDraws: 1, ...over,
});

const px = (img: RefImage, x: number, y: number): number[] => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];

describe("the reference compositor: Direct3D 9's rules for a pre-transformed quad", () => {
  test("a quad whose corners are k - 0.5 covers exactly the pixels k.. and shows the texels one to one (the top-left rule on pixel centres)", () => {
    // texel (x, y) = (20 + 40 x, 30 + 50 y, 7): R 20 60 100 140, G 30 80 130
    const tex = texture(4, 3, (x, y) => [20 + 40 * x, 30 + 50 * y, 7, 255]);
    const target = newTarget(16, 12, 1, 2, 3);
    // x from 9.5 to 13.5 covers the centres 10, 11, 12, 13 (9.5 <= x < 13.5); y from 4.5 to 7.5 covers 5, 6, 7
    drawQuad(target, quad(vertices(9.5, 4.5, 13.5, 7.5), tex));
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) expect(px(target, 10 + x, 5 + y)).toEqual([20 + 40 * x, 30 + 50 * y, 7]);
    expect(px(target, 9, 5)).toEqual([1, 2, 3]);
    expect(px(target, 14, 5)).toEqual([1, 2, 3]);
    expect(px(target, 10, 4)).toEqual([1, 2, 3]);
    expect(px(target, 10, 8)).toEqual([1, 2, 3]);
    let changed = 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) if (px(target, x, y)[2] !== 3) changed++;
    expect(changed).toBe(12);
  });

  test("a centre exactly on the left or top edge is covered, one on the right or bottom edge is not", () => {
    const tex = texture(1, 1, () => [200, 100, 50, 255]);
    const target = newTarget(8, 8, 0, 0, 0);
    drawQuad(target, quad(vertices(2, 3, 5, 6), tex)); // covers x = 2, 3, 4 and y = 3, 4, 5
    let changed = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (px(target, x, y)[0] !== 0) changed++;
    expect(changed).toBe(9);
    expect(px(target, 2, 3)).toEqual([200, 100, 50]);
    expect(px(target, 4, 5)).toEqual([200, 100, 50]);
    expect(px(target, 5, 5)).toEqual([0, 0, 0]);
    expect(px(target, 4, 6)).toEqual([0, 0, 0]);
  });

  test("stretched, the sample is bilinear at the texel centres: 2 texels (0, 255) over 4 pixels are 0 64 191 255 with MIRROR or CLAMP, 64 64 191 191 with WRAP", () => {
    // the centres sit at s = 0.125 0.375 0.625 0.875, so texel coordinates -0.25 0.25 0.75 1.25: weights 0.75 / 0.25 on texels (-1, 0), (0, 1), (0, 1), (1, 2)
    const tex = texture(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    for (const [mode, expected] of [[MIRROR, [0, 64, 191, 255]], [CLAMP, [0, 64, 191, 255]], [WRAP, [64, 64, 191, 191]]] as const) {
      const target = newTarget(4, 1, 9, 9, 9);
      drawQuad(target, quad(vertices(-0.5, -0.5, 3.5, 0.5), tex, { addressU: mode, addressV: mode }));
      expect([0, 1, 2, 3].map((x) => px(target, x, 0)[0])).toEqual([...expected]);
    }
  });

  test("a sub-rectangle of the texture is taken as the texel coordinates say (u 0.25 .. 0.75 of 4 texels over two pixels)", () => {
    const tex = texture(4, 1, (x) => [10 * (x + 1), 0, 0, 255]); // 10 20 30 40
    const target = newTarget(2, 1, 0, 0, 0);
    // u from 0.25 to 0.75, over x -0.5 .. 1.5: the centres are at s = 0.25 and 0.75, u = 0.375 and 0.625, texel coordinates 1.0 and 2.0: texels 20 and 30
    drawQuad(target, quad(vertices(-0.5, -0.5, 1.5, 0.5, undefined, [0.25, 0, 0.75, 1]), tex));
    expect([px(target, 0, 0)[0], px(target, 1, 0)[0]]).toEqual([20, 30]);
  });

  test("the diffuse colour modulates colour and alpha; with blending off the source is written whole", () => {
    const tex = texture(1, 1, () => [255, 200, 100, 255]);
    const target = newTarget(1, 1, 7, 7, 7);
    // 0x80ff8040: alpha 128, red 255, green 128, blue 64 -> (255, 200 * 128 / 255 = 100.39, 100 * 64 / 255 = 25.1)
    drawQuad(target, quad(vertices(-0.5, -0.5, 0.5, 0.5, Array(4).fill(0x80ff8040)), tex));
    expect(px(target, 0, 0)).toEqual([255, 100, 25]);
  });

  test("SRCALPHA / INVSRCALPHA: white with alpha 128 over 100 is 255 * 128 / 255 + 100 * 127 / 255 = 177.8 -> 178; the diffuse alpha counts the same way", () => {
    const blend = { blendEnable: true, srcBlend: SRCALPHA, destBlend: INVSRCALPHA };
    const a = newTarget(1, 1, 100, 100, 100);
    drawQuad(a, quad(vertices(-0.5, -0.5, 0.5, 0.5), texture(1, 1, () => [255, 255, 255, 128]), blend));
    expect(px(a, 0, 0)).toEqual([178, 178, 178]);
    const b = newTarget(1, 1, 100, 100, 100);
    drawQuad(b, quad(vertices(-0.5, -0.5, 0.5, 0.5, Array(4).fill(0x80ffffff)), texture(1, 1, () => [255, 255, 255, 255]), blend));
    expect(px(b, 0, 0)).toEqual([178, 178, 178]);
    // a texel that is transparent leaves the destination alone, whatever its colour is (the grey boxes of the buttons that blended with ONE / ZERO)
    const c = newTarget(1, 1, 100, 100, 100);
    drawQuad(c, quad(vertices(-0.5, -0.5, 0.5, 0.5), texture(1, 1, () => [128, 128, 128, 0]), blend));
    expect(px(c, 0, 0)).toEqual([100, 100, 100]);
    const d = newTarget(1, 1, 100, 100, 100);
    drawQuad(d, quad(vertices(-0.5, -0.5, 0.5, 0.5), texture(1, 1, () => [128, 128, 128, 0])));
    expect(px(d, 0, 0)).toEqual([128, 128, 128]);
  });

  test("ONE / ONE adds and clamps; a picture drawn twice blends twice, each time into the rounded 8-bit surface", () => {
    const add = newTarget(1, 1, 100, 100, 100);
    drawQuad(add, quad(vertices(-0.5, -0.5, 0.5, 0.5), texture(1, 1, () => [200, 50, 0, 255]), { blendEnable: true, srcBlend: ONE, destBlend: ONE }));
    expect(px(add, 0, 0)).toEqual([255, 150, 100]);
    const twice = newTarget(1, 1, 100, 100, 100);
    // first: 178 (177.8); second: 128 + 178 * 127 / 255 = 216.65 -> 217
    drawQuad(twice, quad(vertices(-0.5, -0.5, 0.5, 0.5), texture(1, 1, () => [255, 255, 255, 128]), { blendEnable: true, srcBlend: SRCALPHA, destBlend: INVSRCALPHA, numDraws: 2 }));
    expect(px(twice, 0, 0)).toEqual([217, 217, 217]);
  });

  test("the colour is interpolated over the triangle: left black, right white over 4 pixels is 255 * (0.125 0.375 0.625 0.875) = 32 96 159 223", () => {
    const tex = texture(1, 1, () => [255, 255, 255, 255]);
    const target = newTarget(4, 1, 0, 0, 0);
    drawQuad(target, quad(vertices(-0.5, -0.5, 3.5, 0.5, [0xff000000, 0xffffffff, 0xff000000, 0xffffffff]), tex));
    expect([0, 1, 2, 3].map((x) => px(target, x, 0)[0])).toEqual([32, 96, 159, 223]);
  });

  test("the strip is two triangles, not a bilinear patch: corners white / black / black / white over 2 x 2 pixels give 128 0 / 0 128", () => {
    // centres at (s, t) = (0.25, 0.25) (0.75, 0.25) (0.25, 0.75) (0.75, 0.75); the triangle (v0, v1, v2) holds s + t <= 1: weights (1 - s - t, s, t) = (0.5, 0.25, 0.25),
    // then on the diagonal (0, 0.75, 0.25) and (0, 0.25, 0.75), both black; the triangle (v2, v1, v3): (s + t - 1) on v3 = 0.5 white -> 127.5 -> 128
    const tex = texture(1, 1, () => [255, 255, 255, 255]);
    const target = newTarget(2, 2, 0, 0, 0);
    drawQuad(target, quad(vertices(-0.5, -0.5, 1.5, 1.5, [0xffffffff, 0xff000000, 0xff000000, 0xffffffff]), tex));
    expect([px(target, 0, 0)[0], px(target, 1, 0)[0], px(target, 0, 1)[0], px(target, 1, 1)[0]]).toEqual([128, 0, 0, 128]);
  });

  test("parts of the quad off the target are cut away", () => {
    const tex = texture(1, 1, () => [255, 0, 0, 255]);
    const target = newTarget(3, 3, 0, 0, 0);
    drawQuad(target, quad(vertices(-5.5, 1.5, 1.5, 100.5), tex)); // x: -5..1, y: 2..100
    expect(px(target, 0, 2)).toEqual([255, 0, 0]);
    expect(px(target, 1, 2)).toEqual([255, 0, 0]);
    expect(px(target, 2, 2)).toEqual([0, 0, 0]);
    expect(px(target, 0, 1)).toEqual([0, 0, 0]);
  });

  test("what is not modelled is an error, not a guess", () => {
    const tex = texture(1, 1, () => [1, 2, 3, 255]);
    const target = newTarget(4, 4, 0, 0, 0);
    const skewed = vertices(0, 0, 2, 2);
    new DataView(skewed.buffer).setFloat32(28, 2.5, true); // the right-top corner no longer lines up with the right-bottom one
    expect(() => drawQuad(target, quad(skewed, tex))).toThrow("upright");
    expect(() => drawQuad(target, { ...quad(vertices(0, 0, 2, 2), tex), texture: null })).toThrow("without a texture");
    expect(() => drawQuad(target, quad(vertices(0, 0, 2, 2), tex, { minFilter: 1 }))).toThrow("linear");
    expect(() => drawQuad(target, quad(vertices(0, 0, 2, 2), tex, { addressU: 4 }))).toThrow("addressing mode 4");
    expect(() => drawQuad(target, quad(vertices(0, 0, 2, 2), tex, { blendEnable: true, srcBlend: 11 }))).toThrow("blend factor 11");
    const perspective = vertices(0, 0, 2, 2);
    new DataView(perspective.buffer).setFloat32(12, 0.5, true);
    expect(() => drawQuad(target, quad(perspective, tex))).toThrow("rhw");
    expect(() => drawQuad(target, quad(new Uint8Array(28), tex))).toThrow("four 28-byte vertices");
  });

  test("sampleBilinear: the middle of two texels is their mean; the edge of a mirrored texture repeats its border texel", () => {
    const tex = texture(2, 2, (x, y) => [x === 0 ? 0 : 100, y === 0 ? 0 : 200, 0, 255]);
    const out = [0, 0, 0, 0];
    sampleBilinear(tex, 0.5, 0.5, MIRROR, MIRROR, out); // the point between all four texels
    expect(out.map((c) => Math.round(c * 255))).toEqual([50, 100, 0, 255]);
    sampleBilinear(tex, 0, 0, MIRROR, MIRROR, out); // the corner: texel coordinates -0.5, which mirror to texel 0 on both sides
    expect(out.map((c) => Math.round(c * 255))).toEqual([0, 0, 0, 255]);
  });

  test("compareImages counts the pixels that are off by more than the tolerance in a colour channel; alpha does not count", () => {
    const a = newTarget(2, 1, 10, 10, 10);
    const b = newTarget(2, 1, 10, 10, 10);
    b.rgba[0] = 13; // pixel 0: red off by 3
    b.rgba[7] = 0; // pixel 1: alpha only
    expect(compareImages(a, b, 3)).toMatchObject({ pixels: 2, over: 0, max: 3 });
    const d = compareImages(a, b, 2);
    expect(d).toMatchObject({ pixels: 2, over: 1, max: 3 });
    expect(d.firstOver).toEqual({ x: 0, y: 0, a: [10, 10, 10], b: [13, 10, 10] });
    expect(d.mean).toBeCloseTo(3 / 6, 12);
    expect(() => compareImages(a, newTarget(1, 1, 0, 0, 0), 0)).toThrow("sizes");
  });
});
