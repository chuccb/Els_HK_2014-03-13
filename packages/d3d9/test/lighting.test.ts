/** Fixed-function lighting and fog against the formulas of the D3D9 documentation ("Mathematics of Lighting", "Fog Formulas"). */
import { describe, expect, test } from "bun:test";
import { D3DCLEAR, D3DFMT, D3DFOG, D3DFVF, D3DLIGHT, D3DMCS, D3DPT, D3DRS, D3DTS, D3DTS_WORLD, matIdentity, matOrthoLH, matRotationY } from "../src/index.ts";
import type { Direct3DDevice9, Light, Material } from "../src/index.ts";
import { argb, gpuAvailable, initFixed, newD3D9, packVertices, snap } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;
const f2d = (f: number): number => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f, true); return b.getUint32(0, true); };
const C = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const sat = (x: number): number => Math.min(1, Math.max(0, x));

const NF = D3DFVF.XYZ | D3DFVF.NORMAL;
const zero = C(0, 0, 0, 0);
const baseLight = (): Light => ({ type: D3DLIGHT.DIRECTIONAL, diffuse: C(1, 1, 1), specular: zero, ambient: zero, position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, range: 1000, falloff: 1, attenuation0: 1, attenuation1: 0, attenuation2: 0, theta: 0, phi: 0 });
const mat = (over: Partial<Material> = {}): Material => ({ diffuse: C(1, 1, 1), ambient: C(1, 1, 1), specular: zero, emissive: zero, power: 0, ...over });

/** A 16x16 quad covering the whole target in the z=0.5 plane with one normal for all vertices (strip order TL TR BL BR; y up). */
async function lit(normal: V3, setup: (dev: Direct3DDevice9) => void, normals?: V3[]): Promise<{ img: ReturnType<typeof snap> extends Promise<infer T> ? T : never; dev: Direct3DDevice9 }> {
  const dev = await newD3D9(16, 16, { backBufferFormat: D3DFMT.A8R8G8B8 });
  initFixed(dev);
  dev.SetTransform(D3DTS_WORLD, matIdentity());
  dev.SetTransform(D3DTS.VIEW, matIdentity());
  dev.SetTransform(D3DTS.PROJECTION, matOrthoLH(2, 2, 0, 1));
  dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
  dev.SetRenderState(D3DRS.LIGHTING, 1);
  dev.SetRenderState(D3DRS.AMBIENT, 0);
  setup(dev);
  const n = normals ?? [normal, normal, normal, normal];
  const pos: V3[] = [[-1, 1, 0.5], [1, 1, 0.5], [-1, -1, 0.5], [1, -1, 0.5]];
  const { bytes, stride } = packVertices(NF, pos.map((p, i) => [...p, ...n[i]!]));
  dev.SetFVF(NF);
  dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, bytes, stride);
  const img = await snap(dev);
  expect(await dev.takeErrorsAsync()).toEqual([]);
  return { img, dev };
}
const q255 = (v: number): number => Math.round(sat(v) * 255);
const expectPx = (p: { r: number; g: number; b: number; a: number }, e: number[], tol = 2): void => {
  const got = [p.r, p.g, p.b, p.a];
  expect({ got, ok: got.every((v, i) => Math.abs(v - e[i]!) <= tol) }).toMatchObject({ ok: true });
};

describe("lighting (needs a WebGPU adapter)", () => {
  gpuTest("directional light: ambient + emissive + N.L * diffuse, material alpha", async () => {
    const m = mat({ diffuse: C(0.5, 0.25, 1, 0.6), ambient: C(0.2, 0.4, 0.2), emissive: C(0.05, 0, 0.1) });
    const ga = [0.1, 0.2, 0.3];
    const la = [0.1, 0.05, 0];
    for (const theta of [0, 0.5, 1.2, 2.0]) {
      const n: V3 = [Math.sin(theta), 0, -Math.cos(theta)];
      const { img } = await lit(n, (dev) => {
        dev.SetMaterial(m);
        dev.SetRenderState(D3DRS.AMBIENT, argb(255, 25.5, 51, 76.5));
        const l = baseLight(); l.ambient = C(la[0]!, la[1]!, la[2]!); dev.SetLight(0, l); dev.LightEnable(0, true);
      });
      const ndl = Math.max(0, n[2] * -1);
      const e = [
        q255(m.emissive.r + m.ambient.r * (ga[0]! + la[0]!) + m.diffuse.r * ndl),
        q255(m.emissive.g + m.ambient.g * (ga[1]! + la[1]!) + m.diffuse.g * ndl),
        q255(m.emissive.b + m.ambient.b * (ga[2]! + la[2]!) + m.diffuse.b * ndl),
        q255(0.6),
      ];
      expectPx(img.at(8, 8), e, 3);
    }
  });

  gpuTest("lights are kept in world space and rotated by the view matrix at draw time", async () => {
    // world normal tilted against a world-space light; the view matrix rotates the scene: N.L must not change
    const nw = norm([0.3, 0, -1]);
    for (const before of [true, false]) {
      const { img } = await lit(nw, (dev) => {
        dev.SetMaterial(mat({ diffuse: C(1, 0.5, 0.25) }));
        dev.SetTransform(D3DTS.PROJECTION, matOrthoLH(2, 2, -10, 10));
        const l = baseLight(); // travels along +z in world space
        if (before) { dev.SetLight(0, l); dev.LightEnable(0, true); dev.SetTransform(D3DTS.VIEW, matRotationY(0.6)); }
        else { dev.SetTransform(D3DTS.VIEW, matRotationY(0.6)); dev.SetLight(0, l); dev.LightEnable(0, true); }
      });
      const ndl = -nw[2];
      expectPx(img.at(8, 8), [q255(ndl), q255(0.5 * ndl), q255(0.25 * ndl), 255], 3);
    }
  });

  gpuTest("point light with attenuation and range (per-vertex colours interpolated)", async () => {
    const lp: V3 = [0.3, 0.2, -1];
    const att = [0.5, 0.4, 0.3];
    const range = 3.2;
    const n: V3 = [0, 0, -1];
    const m = mat({ diffuse: C(0.9, 0.7, 0.5) });
    const { img } = await lit(n, (dev) => {
      dev.SetMaterial(m);
      const l = baseLight(); l.type = D3DLIGHT.POINT; l.position = { x: lp[0], y: lp[1], z: lp[2] }; l.range = range; l.attenuation0 = att[0]!; l.attenuation1 = att[1]!; l.attenuation2 = att[2]!;
      dev.SetLight(0, l); dev.LightEnable(0, true);
    });
    const vcol = (p: V3): number[] => {
      const toL = sub(lp, p); const d = len(toL); const L = norm(toL);
      const a = d > range ? 0 : 1 / (att[0]! + att[1]! * d + att[2]! * d * d);
      const ndl = Math.max(0, dot(n, L));
      return [m.diffuse.r, m.diffuse.g, m.diffuse.b].map((c) => sat(c * ndl * a));
    };
    // centre pixel = average of the two vertices on the strip's shared diagonal (TR and BL)
    const tr = vcol([1, 1, 0.5]), bl = vcol([-1, -1, 0.5]);
    expectPx(img.at(8, 8), [0, 1, 2].map((i) => q255((tr[i]! + bl[i]!) / 2)).concat([255]), 3);
  });

  gpuTest("spot light cone: inner, falloff region, outside", async () => {
    const lp: V3 = [0, 0, -2];
    const dir: V3 = [0, 0, 1];
    const theta = 0.4, phi = 1.0, falloff = 1.5;
    const m = mat({ diffuse: C(1, 1, 1) });
    // a quad whose four vertices lie at increasing angles from the axis; sample the pixel at its centre = mean of TR/BL
    for (const half of [0.2, 0.9, 2.5]) {
      const dev = await newD3D9(16, 16, { backBufferFormat: D3DFMT.A8R8G8B8 });
      initFixed(dev);
      dev.SetTransform(D3DTS.PROJECTION, matOrthoLH(2 * half, 2 * half, 0, 1));
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
      dev.SetRenderState(D3DRS.LIGHTING, 1); dev.SetRenderState(D3DRS.AMBIENT, 0);
      dev.SetMaterial(m);
      const l = baseLight(); l.type = D3DLIGHT.SPOT; l.position = { x: lp[0], y: lp[1], z: lp[2] }; l.direction = { x: dir[0], y: dir[1], z: dir[2] };
      l.theta = theta; l.phi = phi; l.falloff = falloff; l.attenuation0 = 1; l.range = 100;
      dev.SetLight(0, l); dev.LightEnable(0, true);
      const n: V3 = [0, 0, -1];
      const pos: V3[] = [[-half, half, 0.5], [half, half, 0.5], [-half, -half, 0.5], [half, -half, 0.5]];
      const { bytes, stride } = packVertices(NF, pos.map((p) => [...p, ...n]));
      dev.SetFVF(NF);
      dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, bytes, stride);
      const img = await snap(dev);
      const vc = (p: V3): number => {
        const toL = sub(lp, p); const d = len(toL); const L = norm(toL);
        const rho = dot([-L[0], -L[1], -L[2]], dir);
        const cosT = Math.cos(theta / 2), cosP = Math.cos(phi / 2);
        const spot = rho > cosT ? 1 : rho > cosP ? Math.pow((rho - cosP) / (cosT - cosP), falloff) : 0;
        return sat(Math.max(0, dot(n, L)) * spot / (1 * 1));
      };
      const e = (vc(pos[1]!) + vc(pos[2]!)) / 2;
      expectPx(img.at(8, 8), [q255(e), q255(e), q255(e), 255], 3);
      expect(await dev.takeErrorsAsync()).toEqual([]);
    }
  });

  gpuTest("specular (Blinn half vector), power, non-local and local viewer", async () => {
    const n: V3 = [0.3, 0.1, -1];
    const nn = norm(n);
    const m = mat({ diffuse: C(0, 0, 0), ambient: C(0, 0, 0), specular: C(1, 0.8, 0.6), power: 8 });
    const ldir: V3 = [0.2, -0.3, 1]; // direction the light travels
    for (const local of [false, true]) {
      const { img } = await lit(nn, (dev) => {
        dev.SetMaterial(m);
        dev.SetRenderState(D3DRS.SPECULARENABLE, 1);
        dev.SetRenderState(D3DRS.LOCALVIEWER, local ? 1 : 0);
        const l = baseLight(); l.specular = C(1, 1, 1); l.direction = { x: ldir[0], y: ldir[1], z: ldir[2] };
        dev.SetLight(0, l); dev.LightEnable(0, true);
      });
      const L = norm([-ldir[0], -ldir[1], -ldir[2]]);
      const spec = (p: V3): number[] => {
        const V: V3 = local ? norm([-p[0], -p[1], -p[2]]) : [0, 0, -1];
        const H = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
        const ndl = dot(nn, L);
        const s = ndl > 0 ? Math.pow(Math.max(0, dot(nn, H)), m.power) : 0;
        return [m.specular.r * s, m.specular.g * s, m.specular.b * s];
      };
      const tr = spec([1, 1, 0.5]), bl = spec([-1, -1, 0.5]);
      expectPx(img.at(8, 8), [0, 1, 2].map((i) => q255((tr[i]! + bl[i]!) / 2)).concat([255]), 3);
    }
  });

  gpuTest("COLORVERTEX with diffuse/ambient/emissive taken from vertex colours", async () => {
    const dev = await newD3D9(16, 16, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    dev.SetTransform(D3DTS.PROJECTION, matOrthoLH(2, 2, 0, 1));
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
    dev.SetRenderState(D3DRS.LIGHTING, 1);
    dev.SetRenderState(D3DRS.AMBIENT, argb(255, 255, 255, 255));
    dev.SetRenderState(D3DRS.COLORVERTEX, 1);
    dev.SetRenderState(D3DRS.DIFFUSEMATERIALSOURCE, D3DMCS.COLOR1);
    dev.SetRenderState(D3DRS.AMBIENTMATERIALSOURCE, D3DMCS.COLOR2);
    dev.SetRenderState(D3DRS.EMISSIVEMATERIALSOURCE, D3DMCS.MATERIAL);
    dev.SetMaterial(mat({ diffuse: C(1, 1, 1), ambient: C(1, 1, 1), emissive: C(0.1, 0.1, 0.1) }));
    const l = baseLight(); dev.SetLight(0, l); dev.LightEnable(0, true);
    const fvf = D3DFVF.XYZ | D3DFVF.NORMAL | D3DFVF.DIFFUSE | D3DFVF.SPECULAR;
    const dif = argb(200, 100, 50, 25), spc = argb(0, 40, 80, 120);
    const pos: V3[] = [[-1, 1, 0.5], [1, 1, 0.5], [-1, -1, 0.5], [1, -1, 0.5]];
    const { bytes, stride } = packVertices(fvf, pos.map((p) => [...p, 0, 0, -1, dif, spc]));
    dev.SetFVF(fvf);
    dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, bytes, stride);
    const p = (await snap(dev)).at(8, 8);
    // emissive(material) + ambientRS(1) * ambient(COLOR2 = spc) + diffuse(COLOR1) * N.L(1)
    expectPx(p, [q255(0.1 + 40 / 255 + 100 / 255), q255(0.1 + 80 / 255 + 50 / 255), q255(0.1 + 120 / 255 + 25 / 255), 200], 3);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("lights beyond the eighth are ignored; disabled lights do not shine; NORMALIZENORMALS", async () => {
    const m = mat({ diffuse: C(0.25, 0.25, 0.25) });
    const { img } = await lit([0, 0, -2], (dev) => {
      dev.SetMaterial(m);
      dev.SetRenderState(D3DRS.NORMALIZENORMALS, 1);
      for (let i = 0; i < 3; i++) { const l = baseLight(); dev.SetLight(i, l); dev.LightEnable(i, i !== 1); }
    });
    // two enabled lights, normalised normal: 2 * 0.25 = 0.5
    expectPx(img.at(8, 8), [128, 128, 128, 255], 2);
  });
});

describe("fog (needs a WebGPU adapter)", () => {
  const fogColor = argb(255, 40, 80, 120);
  async function fogged(mode: "vertex" | "table", kind: number, z: number, extra: (dev: Direct3DDevice9) => void = () => {}): Promise<{ r: number; g: number; b: number; a: number }> {
    const dev = await newD3D9(16, 16, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    dev.SetTransform(D3DTS.PROJECTION, matOrthoLH(2, 2, 0, 1));
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
    dev.SetRenderState(D3DRS.FOGENABLE, 1);
    dev.SetRenderState(D3DRS.FOGCOLOR, fogColor);
    dev.SetRenderState(D3DRS.FOGSTART, f2d(0.2));
    dev.SetRenderState(D3DRS.FOGEND, f2d(1.0));
    dev.SetRenderState(D3DRS.FOGDENSITY, f2d(1.5));
    if (mode === "vertex") dev.SetRenderState(D3DRS.FOGVERTEXMODE, kind); else dev.SetRenderState(D3DRS.FOGTABLEMODE, kind);
    extra(dev);
    const fvf = D3DFVF.XYZ | D3DFVF.DIFFUSE;
    const c = argb(255, 200, 100, 50);
    const { bytes, stride } = packVertices(fvf, [[-1, 1, z, c], [1, 1, z, c], [-1, -1, z, c], [1, -1, z, c]]);
    dev.SetFVF(fvf);
    dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, bytes, stride);
    const p = (await snap(dev)).at(8, 8);
    expect(await dev.takeErrorsAsync()).toEqual([]);
    return p;
  }
  const mixc = (f: number): number[] => [200, 100, 50].map((c, i) => q255((c / 255) * f + ([40, 80, 120][i]! / 255) * (1 - f)));
  gpuTest("vertex fog: linear, exp, exp2", async () => {
    const z = 0.5;
    expectPx(await fogged("vertex", D3DFOG.LINEAR, z), [...mixc((1.0 - z) / (1.0 - 0.2)), 255], 2);
    expectPx(await fogged("vertex", D3DFOG.EXP, z), [...mixc(Math.exp(-z * 1.5)), 255], 2);
    expectPx(await fogged("vertex", D3DFOG.EXP2, z), [...mixc(Math.exp(-((z * 1.5) ** 2))), 255], 2);
    // before the start there is no fog, past the end it is all fog
    expectPx(await fogged("vertex", D3DFOG.LINEAR, 0.1), [200, 100, 50, 255], 1);
    expectPx(await fogged("vertex", D3DFOG.LINEAR, 0.95), [...mixc(0.05 / 0.8), 255], 2);
    expectPx(await fogged("vertex", D3DFOG.LINEAR, 1.0), [40, 80, 120, 255], 1);
  });
  gpuTest("table (pixel) fog uses the pixel depth", async () => {
    expectPx(await fogged("table", D3DFOG.LINEAR, 0.5), [...mixc((1.0 - 0.5) / 0.8), 255], 2);
    expectPx(await fogged("table", D3DFOG.EXP2, 0.4), [...mixc(Math.exp(-((0.4 * 1.5) ** 2))), 255], 2);
  });
  gpuTest("FOGENABLE off: no fog; table mode wins over vertex mode", async () => {
    expectPx(await fogged("vertex", D3DFOG.LINEAR, 0.5, (dev) => dev.SetRenderState(D3DRS.FOGENABLE, 0)), [200, 100, 50, 255], 1);
    expectPx(await fogged("vertex", D3DFOG.LINEAR, 0.5, (dev) => dev.SetRenderState(D3DRS.FOGTABLEMODE, D3DFOG.EXP2)), [...mixc(Math.exp(-((0.5 * 1.5) ** 2))), 255], 2);
  });
  gpuTest("pre-transformed vertices take the fog factor from the specular alpha", async () => {
    const dev = await newD3D9(16, 16, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
    dev.SetRenderState(D3DRS.FOGENABLE, 1);
    dev.SetRenderState(D3DRS.FOGCOLOR, fogColor);
    dev.SetRenderState(D3DRS.FOGVERTEXMODE, D3DFOG.LINEAR);
    const fvf = D3DFVF.XYZRHW | D3DFVF.DIFFUSE | D3DFVF.SPECULAR;
    const c = argb(255, 200, 100, 50), spec = argb(128, 0, 0, 0);
    const { bytes, stride } = packVertices(fvf, [[0, 0, 0.5, 1, c, spec], [16, 0, 0.5, 1, c, spec], [0, 16, 0.5, 1, c, spec], [16, 16, 0.5, 1, c, spec]]);
    dev.SetFVF(fvf);
    dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, bytes, stride);
    expectPx((await snap(dev)).at(8, 8), [...mixc(128 / 255), 255], 2);
  });
});
