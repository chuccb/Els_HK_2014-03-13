/**
 * Visual milestone of the D3D9 layer: real assets of the original client drawn through the same D3DX / device calls the exe makes,
 * on a software WebGPU device, saved as PNG.
 *
 *   ./tools/gpu.sh ./node_modules/.bin/bun run tools/render-demo.ts [outDir] [--docs]     (default /home/user/work/out; --docs also writes docs/img/d3d9-demo.png at half size)
 *
 * Scene: the HK loading screen (loose `dlg_first_loading0_hk.tga`, a 1024x768 24 bpp TGA) as a pre-transformed quad, and the basic
 * Elsword sword (`MESH_ELSWORD_BASIC_WEAPON.X`, data017.kom) with its texture, lit by one directional light.  The mesh goes through
 * the sequence CKTDXDeviceXMesh::_Load uses (LoadMeshFromX -> CloneMeshFVF(338) -> white vertex colours -> WeldVertices ->
 * Optimize(ATTRSORT | VERTEXCACHE) -> GetAttributeTable) and is drawn one subset at a time.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodePng } from "@els/assets";
import {
  D3DCLEAR, D3DCULL, D3DFMT, D3DLIGHT, D3DPOOL, D3DPT, D3DRS, D3DTS, D3DTS_WORLD, D3DX_FILTER, D3DXCreateTextureFromFileInMemoryEx, D3DXLoadMeshFromXInMemory, D3DXMESH, D3DXMESHOPT,
  D3DXWeldVertices, D3DXComputeBoundingSphere, matLookAtLH, matPerspectiveFovLH, matRotationY, matRotationX, matMultiply, matTranslation, zeroWeldEpsilons, D3DTEXF, D3DSAMP, D3DTADDRESS,
} from "../packages/d3d9/src/index.ts";
import type { Direct3DDevice9, Direct3DTexture9 } from "../packages/d3d9/src/index.ts";
import { newD3D9, packVertices } from "../packages/d3d9/test/gpu-helper.ts";
import { indexAllKoms } from "./komindex.ts";

const outDir = process.argv[2] ?? "/home/user/work/out";
mkdirSync(outDir, { recursive: true });
const W = 1024, H = 768;
const dev = await newD3D9(W, H, { backBufferFormat: D3DFMT.A8R8G8B8 });
const idx = await indexAllKoms();

function loadTexture(bytes: Uint8Array): Direct3DTexture9 {
  const r = D3DXCreateTextureFromFileInMemoryEx(dev, bytes, 0, 0, 1, 0, D3DFMT.UNKNOWN, D3DPOOL.MANAGED, D3DX_FILTER.NONE, D3DX_FILTER.NONE, 0);
  if (r.hr < 0 || !r.tex) throw new Error(`texture load failed 0x${(r.hr >>> 0).toString(16)}`);
  return r.tex;
}
async function komBytes(name: string): Promise<Uint8Array> {
  const e = idx.get(name.toUpperCase());
  if (!e) throw new Error(`${name} not in any KOM`);
  return e.kom.read(e.entry);
}

// ------------------------------------------------------------------ background: the loading screen as the UI draws it
const bg = loadTexture(new Uint8Array(readFileSync("data/dlg_first_loading0_hk.tga")));
dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0xff202030, 1, 0);
dev.BeginScene();
dev.SetRenderState(D3DRS.ZENABLE, 0);
dev.SetRenderState(D3DRS.LIGHTING, 0);
dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.NONE);
dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 0);
dev.SetTexture(0, bg);
dev.SetSamplerState(0, D3DSAMP.MINFILTER, D3DTEXF.LINEAR); dev.SetSamplerState(0, D3DSAMP.MAGFILTER, D3DTEXF.LINEAR);
dev.SetSamplerState(0, D3DSAMP.ADDRESSU, D3DTADDRESS.CLAMP); dev.SetSamplerState(0, D3DSAMP.ADDRESSV, D3DTADDRESS.CLAMP);
dev.SetFVF(324); // XYZRHW | DIFFUSE | TEX1, the dynamic-VB format of CKTDGDynamicVBManager
const white = 0xffffffff;
const quad = packVertices(324, [
  [-0.5, -0.5, 0, 1, white, 0, 0], [W - 0.5, -0.5, 0, 1, white, 1, 0], [-0.5, H - 0.5, 0, 1, white, 0, 1], [W - 0.5, H - 0.5, 0, 1, white, 1, 1],
]);
dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, quad.bytes, quad.stride);

// ------------------------------------------------------------------ the sword, loaded the way CKTDXDeviceXMesh does
const loaded = D3DXLoadMeshFromXInMemory(await komBytes("MESH_ELSWORD_BASIC_WEAPON.X"), D3DXMESH.MANAGED, dev);
if (loaded.hr < 0 || !loaded.mesh) throw new Error("mesh load failed");
let mesh = loaded.mesh;
if (mesh.GetFVF() !== 338) mesh = mesh.CloneMeshFVF(D3DXMESH.MANAGED, 338, dev).mesh!;
{
  const vb = mesh.LockVertexBuffer(0).data!, dv = new DataView(vb.buffer, vb.byteOffset, vb.byteLength);
  for (let v = 0; v < mesh.GetNumVertices(); v++) dv.setUint32(v * 36 + 24, 0xffffffff, true); // MESH_VERTEX.color
  mesh.UnlockVertexBuffer();
}
D3DXWeldVertices(mesh, 0, zeroWeldEpsilons(), loaded.adjacency);
mesh = mesh.Optimize(D3DXMESHOPT.ATTRSORT | D3DXMESHOPT.VERTEXCACHE | D3DXMESH.MANAGED, null).mesh!;
const table = mesh.GetAttributeTable();
const textures: (Direct3DTexture9 | null)[] = [];
for (const m of loaded.materials) textures.push(m.pTextureFilename ? loadTexture(await komBytes(m.pTextureFilename)) : null);

// bounding sphere of the whole mesh: camera distance
const bs = D3DXComputeBoundingSphere(mesh.vb.cpu, 0, mesh.GetNumVertices(), mesh.GetNumBytesPerVertex());
const main = table.find((t) => textures[t.AttribId]);
const sub = main ? D3DXComputeBoundingSphere(mesh.vb.cpu, main.VertexStart * 36, main.VertexCount, 36) : bs;

function drawSword(dev: Direct3DDevice9, world: Float32Array, viewport: { x: number; y: number; width: number; height: number }): void {
  dev.SetViewport({ ...viewport, minZ: 0, maxZ: 1 });
  dev.Clear([{ left: viewport.x, top: viewport.y, right: viewport.x + viewport.width, bottom: viewport.y + viewport.height }], D3DCLEAR.ZBUFFER, 0, 1, 0);
  dev.SetRenderState(D3DRS.ZENABLE, 1);
  dev.SetRenderState(D3DRS.ZWRITEENABLE, 1);
  dev.SetRenderState(D3DRS.LIGHTING, 1);
  dev.SetRenderState(D3DRS.AMBIENT, 0xff606060);
  dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.CCW);
  dev.SetRenderState(D3DRS.NORMALIZENORMALS, 1);
  dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 0);
  const c = sub.center;
  const dist = sub.radius * 2.6;
  dev.SetTransform(D3DTS_WORLD, world);
  dev.SetTransform(D3DTS.VIEW, matLookAtLH({ x: 0, y: 0, z: -dist }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }));
  dev.SetTransform(D3DTS.PROJECTION, matPerspectiveFovLH(Math.PI / 4, viewport.width / viewport.height, dist * 0.1, dist * 4));
  dev.SetLight(0, {
    type: D3DLIGHT.DIRECTIONAL, diffuse: { r: 1, g: 0.97, b: 0.9, a: 1 }, specular: { r: 0, g: 0, b: 0, a: 1 }, ambient: { r: 0, g: 0, b: 0, a: 1 },
    position: { x: 0, y: 0, z: 0 }, direction: { x: -0.45, y: -0.5, z: 0.74 }, range: 1000, falloff: 0, attenuation0: 1, attenuation1: 0, attenuation2: 0, theta: 0, phi: 0,
  });
  dev.LightEnable(0, true);
  void c;
  // CKTDXDeviceXMesh::Render: per attribute group SetMaterial + SetTexture (an untextured group keeps the previous texture) + DrawSubset
  for (const t of table) {
    const m = loaded.materials[t.AttribId]!;
    dev.SetMaterial(m.MatD3D);
    const tex = textures[t.AttribId];
    if (tex) dev.SetTexture(0, tex);
    else continue; // the demo leaves out the untextured attack-line helper boxes (the game hides them via the skin-mesh path)
    mesh.DrawSubset(t.AttribId);
  }
}

// the sword, rotated so that its long axis (z) lies diagonally: three poses side by side
const third = Math.floor(W / 3);
const poses = [matMultiply(matRotationX(-Math.PI / 2 + 0.2), matRotationY(0.6)), matMultiply(matRotationX(-Math.PI / 2), matRotationY(-0.9)), matMultiply(matTranslation(-sub.center.x, -sub.center.y, -sub.center.z), matMultiply(matRotationX(0.3), matRotationY(2.2)))];
poses.forEach((rot, i) => {
  const world = i === 2 ? rot : matMultiply(matTranslation(-sub.center.x, -sub.center.y, -sub.center.z), rot);
  drawSword(dev, world, { x: i * third, y: 120, width: third, height: H - 240 });
});
dev.SetViewport({ x: 0, y: 0, width: W, height: H, minZ: 0, maxZ: 1 });
dev.EndScene();

const px = await dev.readPixels();
const errors = await dev.takeErrorsAsync();
if (errors.length) console.error("GPU errors:", errors);
writeFileSync(`${outDir}/demo_sword_and_loading.png`, encodePng(px.rgba, px.width, px.height));
if (process.argv.includes("--docs")) {
  // the half-size picture kept in the repository (docs/img): 2x2 box filter
  const w2 = px.width >> 1, h2 = px.height >> 1, half = new Uint8Array(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < 4; c++) {
    const i = (2 * y * px.width + 2 * x) * 4 + c;
    half[(y * w2 + x) * 4 + c] = (px.rgba[i]! + px.rgba[i + 4]! + px.rgba[i + px.width * 4]! + px.rgba[i + px.width * 4 + 4]! + 2) >> 2;
  }
  mkdirSync("docs/img", { recursive: true });
  writeFileSync("docs/img/d3d9-demo.png", encodePng(half, w2, h2));
}
console.log(`wrote ${outDir}/demo_sword_and_loading.png (${px.width}x${px.height}); sword: ${mesh.GetNumFaces()} faces, ${mesh.GetNumVertices()} vertices, ${table.length} subsets, bounding sphere r=${sub.radius.toFixed(1)}`);
