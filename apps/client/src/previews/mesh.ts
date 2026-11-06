/**
 * X / Y meshes through the D3D9 layer: the file goes through `D3DXLoadMeshHierarchyFromXInMemory` with an allocator like the DirectX SDK's
 * (the exe's `CMultiAnimAllocateHierarchy` is a variant of it), the frame lists are the exe's (`SetupFrameList` / `SetupDrawFrameList`: the
 * COLLISION* / ATTACK* / Bip01_Footsteps* helper frames are not drawn), textures come out of the archives, the animation controller poses the
 * frame hierarchy, skinned meshes are skinned on the CPU (`ID3DXSkinInfo::UpdateSkinnedMesh`) and drawn with the fixed-function pipeline.
 * The game itself skins on the GPU with XRenderer.fx; this is the tool for looking at the data.
 */
import { collisionFrames, setupDrawFrameList, setupFrameList } from "@els/engine";
import {
  D3DCLEAR, D3DCMP, D3DCULL, D3DFMT, D3DLIGHT, D3DPOOL, D3DRS, D3DSAMP, D3DTEXF, D3DTS, D3DTS_WORLD, D3DX_FILTER, D3DXCreateTextureFromFileInMemoryEx,
  D3DXFrameFind, D3DXLoadMeshHierarchyFromXInMemory, D3DXMESH, matIdentity, matLookAtLH, matMultiply, matPerspectiveFovLH,
} from "@els/d3d9";
import type { D3DXAnimationController, D3DXFrame, D3DXMesh, D3DXMeshContainer, D3DXMaterial, D3DXSkinInfo, Direct3DTexture9, ID3DXAllocateHierarchy } from "@els/d3d9";
import type { Preview, PreviewEnv } from "../preview.ts";
import { el } from "../ui.ts";

class VFrame implements D3DXFrame {
  TransformationMatrix: Float32Array = matIdentity();
  pMeshContainer: D3DXMeshContainer | null = null;
  pFrameSibling: D3DXFrame | null = null;
  pFrameFirstChild: D3DXFrame | null = null;
  combined: Float32Array = matIdentity();
  constructor(public Name: string | null) {}
}

class VContainer implements D3DXMeshContainer {
  pEffects: null = null;
  pNextMeshContainer: D3DXMeshContainer | null = null;
  readonly MeshData: { Type: number; pMesh: D3DXMesh | null };
  /** the mesh that is drawn: the loaded one, or a clone whose vertices are rewritten every frame when there is a skin */
  drawMesh: D3DXMesh;
  textures: (Direct3DTexture9 | null)[] = [];
  boneFrames: (VFrame | null)[] = [];
  offsets: Float32Array[] = [];
  constructor(
    public Name: string | null, meshData: { Type: number; pMesh: D3DXMesh }, public pMaterials: D3DXMaterial[], public NumMaterials: number,
    public pAdjacency: Uint32Array | null, public pSkinInfo: D3DXSkinInfo | null,
  ) {
    this.MeshData = meshData;
    this.drawMesh = meshData.pMesh;
  }
}

const allocator: ID3DXAllocateHierarchy = {
  CreateFrame: (name) => ({ hr: 0, frame: new VFrame(name) }),
  CreateMeshContainer: (name, meshData, materials, _fx, numMaterials, adjacency, skinInfo) => ({ hr: 0, container: new VContainer(name, meshData, materials, numMaterials, adjacency, skinInfo) }),
  DestroyFrame: () => 0,
  DestroyMeshContainer: () => 0,
};

function updateCombined(root: D3DXFrame | null, parent: Float32Array): void {
  for (let f = root as VFrame | null; f; f = f.pFrameSibling as VFrame | null) {
    f.combined = matMultiply(f.TransformationMatrix, parent);
    updateCombined(f.pFrameFirstChild, f.combined);
  }
}

export async function meshPreview(env: PreviewEnv, name: string, bytes: Uint8Array): Promise<Preview> {
  const d3d = await env.d3d();
  const { dev } = d3d;
  const loaded = D3DXLoadMeshHierarchyFromXInMemory(bytes, D3DXMESH.MANAGED, dev, allocator); // fails for the KME / KSM / KAC files
  if (loaded.hr < 0 || !loaded.frameRoot) throw new Error(`D3DXLoadMeshHierarchyFromXInMemory failed: 0x${(loaded.hr >>> 0).toString(16)}`);
  const root = loaded.frameRoot as VFrame;
  const controller: D3DXAnimationController | null = loaded.animController;

  // ---- textures (shared by name), bone frames, skinned clones
  const textures = new Map<string, Direct3DTexture9 | null>();
  const containers: { frame: VFrame; c: VContainer }[] = [];
  let numFrames: number, numVertices = 0, numFaces = 0, skinned = 0, missingTextures = 0;
  const loadTexture = async (file: string): Promise<Direct3DTexture9 | null> => {
    const key = file.toUpperCase();
    if (textures.has(key)) return textures.get(key)!;
    const data = await env.vfs.load(file);
    let tex: Direct3DTexture9 | null = null;
    if (data) {
      const r = D3DXCreateTextureFromFileInMemoryEx(dev, data, 0, 0, 1, 0, D3DFMT.UNKNOWN, D3DPOOL.MANAGED, D3DX_FILTER.NONE, D3DX_FILTER.NONE, 0);
      tex = r.hr >= 0 ? r.tex : null;
    }
    if (!tex) missingTextures++;
    textures.set(key, tex);
    return tex;
  };
  const frameList = setupFrameList(root); // the exe refuses meshes with more than 255 frames
  const drawFrames = setupDrawFrameList(root) as VFrame[];
  const helperFrames = collisionFrames(frameList.frames).length;
  numFrames = frameList.frames.length;
  for (const f of drawFrames) {
    for (let c = f.pMeshContainer as VContainer | null; c; c = c.pNextMeshContainer as VContainer | null) {
      const mesh = c.MeshData.pMesh!;
      numVertices += mesh.GetNumVertices(); numFaces += mesh.GetNumFaces();
      for (const m of c.pMaterials) c.textures.push(m.pTextureFilename ? await loadTexture(m.pTextureFilename) : null);
      if (c.pSkinInfo && c.pSkinInfo.GetNumBones() > 0) {
        skinned++;
        const clone = mesh.CloneMeshFVF(D3DXMESH.MANAGED, mesh.GetFVF(), dev);
        if (clone.hr >= 0 && clone.mesh) c.drawMesh = clone.mesh;
        for (let i = 0; i < c.pSkinInfo.GetNumBones(); i++) {
          c.boneFrames.push(D3DXFrameFind(root, c.pSkinInfo.GetBoneName(i)) as VFrame | null);
          c.offsets.push(c.pSkinInfo.GetBoneOffsetMatrix(i) ?? matIdentity());
        }
      }
      containers.push({ frame: f, c });
    }
  }

  // ---- animation
  const sets: { name: string; period: number }[] = [];
  if (controller) for (let i = 0; i < controller.GetNumAnimationSets(); i++) { const s = controller.GetAnimationSet(i).set!; sets.push({ name: s.GetName() ?? `set ${i}`, period: s.GetPeriod() }); }
  let setIndex = 0, speed = 1, paused = false, time = 0;
  const selectSet = (i: number): void => {
    if (!controller || !sets[i]) return;
    setIndex = i;
    controller.SetTrackAnimationSet(0, controller.GetAnimationSet(i).set);
    controller.SetTrackEnable(0, true);
    controller.SetTrackPosition(0, 0);
    controller.SetTrackSpeed(0, 1);
    controller.ResetTime();
    time = 0;
  };
  selectSet(0);

  // ---- pose + skinning
  const pose = (dt: number): void => {
    if (controller && sets.length) { controller.AdvanceTime(dt * speed, null); time += dt * speed; }
    updateCombined(root, matIdentity());
    for (const { c } of containers) {
      if (!c.pSkinInfo || c.drawMesh === c.MeshData.pMesh) continue;
      const mats = c.boneFrames.map((bf, i) => (bf ? matMultiply(c.offsets[i]!, bf.combined) : matIdentity()));
      c.pSkinInfo.UpdateSkinnedMesh(mats, null, c.MeshData.pMesh!.vb.cpu, c.drawMesh.vb.cpu);
      c.drawMesh.vb.markDirty(0, c.drawMesh.vb.length);
    }
  };
  pose(0);

  // ---- bounds of the bind / first pose
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const growBounds = (): void => {
    for (const { frame, c } of containers) {
      const mesh = c.drawMesh, stride = mesh.GetNumBytesPerVertex(), cpu = mesh.vb.cpu;
      const dv = new DataView(cpu.buffer, cpu.byteOffset, cpu.byteLength);
      const m = c === undefined || c.drawMesh !== c.MeshData.pMesh ? null : frame.combined;
      for (let v = 0; v < mesh.GetNumVertices(); v++) {
        let x = dv.getFloat32(v * stride, true), y = dv.getFloat32(v * stride + 4, true), z = dv.getFloat32(v * stride + 8, true);
        if (m) { const nx = x * m[0]! + y * m[4]! + z * m[8]! + m[12]!, ny = x * m[1]! + y * m[5]! + z * m[9]! + m[13]!, nz = x * m[2]! + y * m[6]! + z * m[10]! + m[14]!; x = nx; y = ny; z = nz; }
        if (!Number.isFinite(x + y + z)) continue;
        if (x < lo[0]!) lo[0] = x; if (y < lo[1]!) lo[1] = y; if (z < lo[2]!) lo[2] = z;
        if (x > hi[0]!) hi[0] = x; if (y > hi[1]!) hi[1] = y; if (z > hi[2]!) hi[2] = z;
      }
    }
  };
  growBounds();
  const hasGeometry = containers.length > 0 && Number.isFinite(lo[0]!);
  const center = hasGeometry ? [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2] : [0, 0, 0];
  const radius = hasGeometry ? Math.max(1e-3, Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2) : 1;

  // ---- camera + draw
  let yaw = 0.6, pitch = 0.25, distance = radius * 2.6, autoRotate = true, raf = 0, last = performance.now(), frameCounter = 0;
  const draw = (): void => {
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0xff1c2230, 1, 0);
    dev.BeginScene();
    dev.SetRenderState(D3DRS.ZENABLE, 1);
    dev.SetRenderState(D3DRS.ZWRITEENABLE, 1);
    dev.SetRenderState(D3DRS.LIGHTING, 1);
    dev.SetRenderState(D3DRS.AMBIENT, 0xff707070);
    dev.SetRenderState(D3DRS.NORMALIZENORMALS, 1);
    dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.CCW);
    dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 0);
    dev.SetRenderState(D3DRS.ALPHATESTENABLE, 1);
    dev.SetRenderState(D3DRS.ALPHAREF, 0x40);
    dev.SetRenderState(D3DRS.ALPHAFUNC, D3DCMP.GREATEREQUAL);
    dev.SetSamplerState(0, D3DSAMP.MINFILTER, D3DTEXF.LINEAR);
    dev.SetSamplerState(0, D3DSAMP.MAGFILTER, D3DTEXF.LINEAR);
    const cx = Math.cos(pitch), eye = { x: center[0]! + distance * cx * Math.sin(yaw), y: center[1]! + distance * Math.sin(pitch), z: center[2]! - distance * cx * Math.cos(yaw) };
    dev.SetTransform(D3DTS.VIEW, matLookAtLH(eye, { x: center[0]!, y: center[1]!, z: center[2]! }, { x: 0, y: 1, z: 0 }));
    dev.SetTransform(D3DTS.PROJECTION, matPerspectiveFovLH(Math.PI / 4, d3d.width / d3d.height, radius * 0.05, radius * 40));
    dev.SetLight(0, {
      type: D3DLIGHT.DIRECTIONAL, diffuse: { r: 1, g: 0.97, b: 0.92, a: 1 }, specular: { r: 0, g: 0, b: 0, a: 1 }, ambient: { r: 0, g: 0, b: 0, a: 1 },
      position: { x: 0, y: 0, z: 0 }, direction: { x: -0.4, y: -0.6, z: 0.7 }, range: 1000, falloff: 0, attenuation0: 1, attenuation1: 0, attenuation2: 0, theta: 0, phi: 0,
    });
    dev.LightEnable(0, true);
    for (const { frame, c } of containers) {
      dev.SetTransform(D3DTS_WORLD, c.drawMesh !== c.MeshData.pMesh ? matIdentity() : frame.combined);
      for (let i = 0; i < c.NumMaterials; i++) {
        dev.SetMaterial(c.pMaterials[i]!.MatD3D);
        dev.SetTexture(0, c.textures[i] ?? null);
        c.drawMesh.DrawSubset(i);
      }
    }
    dev.EndScene();
    dev.Present();
    frameCounter++;
  };
  const tick = (): void => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) pose(dt);
    if (autoRotate) yaw += dt * 0.5;
    draw();
    raf = requestAnimationFrame(tick);
  };

  // ---- the pane
  const canvas = d3d.canvas;
  canvas.className = "gl";
  let drag: { x: number; y: number } | null = null;
  canvas.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY }; autoRotate = false; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = (e) => { if (!drag) return; yaw -= (e.clientX - drag.x) * 0.01; pitch = Math.max(-1.45, Math.min(1.45, pitch + (e.clientY - drag.y) * 0.01)); drag = { x: e.clientX, y: e.clientY }; };
  canvas.onpointerup = () => { drag = null; };
  canvas.onwheel = (e) => { e.preventDefault(); distance = Math.max(radius * 0.3, Math.min(radius * 12, distance * Math.exp(e.deltaY * 0.001))); };
  const select = el("select", { onchange: () => selectSet(Number(select.value)) }, ...sets.map((s, i) => el("option", { value: String(i), text: `${s.name} (${s.period.toFixed(2)} s)` })));
  const speedInput = el("input", { type: "range", min: "0", max: "3", step: "0.05", value: "1", oninput: () => { speed = Number(speedInput.value); } });
  const pauseBtn = el("button", { text: "pause", onclick: () => { paused = !paused; pauseBtn.textContent = paused ? "play" : "pause"; } });
  const rotate = el("input", { type: "checkbox", checked: true, onchange: () => { autoRotate = rotate.checked; } });
  const bar = el("div", { class: "bar" },
    sets.length ? el("label", {}, "animation ", select) : el("span", { text: "no animation" }),
    sets.length ? el("label", {}, "speed ", speedInput) : null, sets.length ? pauseBtn : null,
    el("label", {}, rotate, " turntable"), el("span", { class: "dim", text: "drag: orbit, wheel: zoom" }));
  const pane = el("div", { class: "pane" }, bar, el("div", { class: "glwrap" }, canvas));
  raf = requestAnimationFrame(tick);
  const refused = frameList.hr < 0 ? " - the exe would refuse this mesh (more than 255 frames)" : "";
  const info = `${numFrames} frames (${helperFrames} collision), ${containers.length} drawn mesh containers (${skinned} skinned), ${numVertices} vertices, ${numFaces} faces, ${textures.size} textures${missingTextures ? ` (${missingTextures} missing)` : ""}, ${sets.length} animation sets${refused}`;
  return {
    el: pane,
    info,
    dispose() {
      cancelAnimationFrame(raf);
      canvas.onpointerdown = canvas.onpointermove = canvas.onpointerup = canvas.onwheel = null;
    },
    async snapshot() { const p = await dev.readPixels(); return { width: p.width, height: p.height, rgba: p.rgba }; },
    control(o) {
      if (typeof o.autoRotate === "boolean") { autoRotate = o.autoRotate; rotate.checked = autoRotate; }
      if (typeof o.paused === "boolean") { paused = o.paused; pauseBtn.textContent = paused ? "play" : "pause"; }
      if (typeof o.yaw === "number") yaw = o.yaw;
      if (typeof o.pitch === "number") pitch = o.pitch;
      if (typeof o.distance === "number") distance = o.distance * radius; // in bounding radii
      if (typeof o.set === "number" && sets[o.set]) { selectSet(o.set); select.value = String(o.set); }
      if (typeof o.time === "number") pose(o.time); // from the start of the set
      draw();
    },
    state() { return { frames: frameCounter, time, setIndex, sets: sets.map((s) => s.name), containers: containers.length, skinned, vertices: numVertices, radius, paused }; },
  };
}
