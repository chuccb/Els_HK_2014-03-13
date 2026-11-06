/**
 * X / Y meshes and KSM skinned meshes through the D3D9 layer.  The file goes through the engine's `loadSkinnedMesh` (CKTDXDeviceXSkinMesh::_Load):
 * "KSM " data is KOG's own container (LoadKSkinnedMesh: frames, ID3DXMesh + ID3DXSkinInfo per mesh container, keyframed animation sets), anything else is
 * an X file for `D3DXLoadMeshHierarchyFromXInMemory` with the exe's allocator (`CMultiAnimAllocateHierarchy`).  The frame lists are the exe's
 * (`SetupFrameList` / `SetupDrawFrameList`: the COLLISION* / ATTACK* / Bip01_Footsteps* helper frames are not drawn), textures come out of the
 * archives, the animation controller poses the frame hierarchy, skinned meshes are skinned on the CPU (`ID3DXSkinInfo::UpdateSkinnedMesh`) and drawn
 * with the fixed-function pipeline.  The game itself skins on the GPU with XRenderer.fx; this is the tool for looking at the data.
 */
import { collisionFrames, isKmeData, loadSkinnedMesh, loadXMesh, setupDrawFrameList, xmeshAsFrame } from "@els/engine";
import type { MultiAnimFrame, MultiAnimMC } from "@els/engine";
import {
  D3DBLEND, D3DCLEAR, D3DCMP, D3DCULL, D3DFMT, D3DLIGHT, D3DPOOL, D3DRS, D3DSAMP, D3DTEXF, D3DTS, D3DTS_WORLD, D3DX_FILTER, D3DXCreateTextureFromFileInMemoryEx,
  D3DXMESH, matIdentity, matLookAtLH, matMultiply, matPerspectiveFovLH,
} from "@els/d3d9";
import type { D3DXAnimationController, D3DXFrame, D3DXMesh, Direct3DTexture9 } from "@els/d3d9";
import type { Preview, PreviewEnv } from "../preview.ts";
import { el } from "../ui.ts";

function updateCombined(root: D3DXFrame | null, parent: Float32Array): void {
  for (let f = root as MultiAnimFrame | null; f; f = f.pFrameSibling as MultiAnimFrame | null) {
    f.combineMatrix = matMultiply(f.TransformationMatrix, parent);
    updateCombined(f.pFrameFirstChild, f.combineMatrix);
  }
}

/** one drawn mesh container: its frame, and the mesh that is drawn (the loaded one, or a clone whose vertices are rewritten every frame when it is skinned) */
interface Drawn { frame: MultiAnimFrame; c: MultiAnimMC; mesh: D3DXMesh; skinned: boolean }

export async function meshPreview(env: PreviewEnv, name: string, bytes: Uint8Array): Promise<Preview> {
  const d3d = await env.d3d();
  const { dev } = d3d;
  // "KME " data is a static mesh (CKTDXDeviceXMesh::_Load -> LoadKMEMesh): one frame around the mesh; everything else goes through the skin-mesh loader
  const kme = isKmeData(bytes) ? loadXMesh(bytes, dev) : null;
  if (kme && (kme.hr < 0 || !kme.mesh)) throw new Error(`KME load failed: 0x${(kme.hr >>> 0).toString(16)}`);
  const loaded = kme ? null : loadSkinnedMesh(bytes, dev);
  // an X file with more than 255 frames is refused by the exe; the inspector still shows what D3DX made of it
  const kept = kme ? { root: xmeshAsFrame(kme) as D3DXFrame | null, controller: null as D3DXAnimationController | null }
    : loaded!.hr >= 0 ? { root: loaded!.frameRoot, controller: loaded!.animController }
    : loaded!.discarded ? { root: loaded!.discarded.frameRoot, controller: loaded!.discarded.animController } : null;
  if (!kept?.root) throw new Error(`${loaded!.format} load failed: 0x${(loaded!.hr >>> 0).toString(16)}`);
  const root = kept.root as MultiAnimFrame;
  const controller: D3DXAnimationController | null = kept.controller;
  const format = kme ? "KME" : loaded!.format;
  const refusedByExe = loaded !== null && loaded.hr < 0;
  const frameList: D3DXFrame[] = kme ? [root] : refusedByExe ? loaded!.frames!.frames : loaded!.frameList;
  const drawFrames = (kme ? [root] : refusedByExe ? setupDrawFrameList(root) : loaded!.drawFrameList) as MultiAnimFrame[];

  // ---- textures (shared by name), skinned clones
  const textures = new Map<string, Direct3DTexture9 | null>();
  const containers: Drawn[] = [];
  let numVertices = 0, numFaces = 0, skinned = 0, missingTextures = 0;
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
  const helperFrames = collisionFrames(frameList).length;
  const numFrames = frameList.length;
  for (const f of drawFrames) {
    for (let c = f.pMeshContainer as MultiAnimMC | null; c; c = c.pNextMeshContainer as MultiAnimMC | null) {
      const mesh = c.MeshData.pMesh!;
      numVertices += mesh.GetNumVertices(); numFaces += mesh.GetNumFaces();
      for (let i = 0; i < c.pMaterials.length; i++) {
        const file = c.pMaterials[i]!.pTextureFilename;
        c.m_apTextures[i] = file ? await loadTexture(file) : null;
      }
      const d: Drawn = { frame: f, c, mesh, skinned: false };
      if (c.pSkinInfo && c.pSkinInfo.GetNumBones() > 0 && c.m_ppBoneFrames && c.m_amxBoneOffsets) {
        const clone = mesh.CloneMeshFVF(D3DXMESH.MANAGED, mesh.GetFVF(), dev);
        if (clone.hr >= 0 && clone.mesh) { d.mesh = clone.mesh; d.skinned = true; skinned++; }
      }
      containers.push(d);
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
    for (const d of containers) {
      if (!d.skinned) continue;
      const bones = d.c.m_ppBoneFrames as (MultiAnimFrame | null)[];
      const mats = d.c.m_amxBoneOffsets!.map((offset, i) => (bones[i] ? matMultiply(offset, bones[i]!.combineMatrix) : matIdentity()));
      d.c.pSkinInfo!.UpdateSkinnedMesh(mats, null, d.c.MeshData.pMesh!.vb.cpu, d.mesh.vb.cpu);
      d.mesh.vb.markDirty(0, d.mesh.vb.length);
    }
  };
  pose(0);

  // ---- bounds of the bind / first pose
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const growBounds = (): void => {
    for (const d of containers) {
      const mesh = d.mesh, stride = mesh.GetNumBytesPerVertex(), cpu = mesh.vb.cpu;
      const dv = new DataView(cpu.buffer, cpu.byteOffset, cpu.byteLength);
      const m = d.skinned ? null : d.frame.combineMatrix;
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
  if (controller && sets.length) {
    // the camera must see the whole motion: an effect weapon can start at scale 0.002 and grow to full size (EG_SP3a_QueensThrone_JumpAttackZ_02.X)
    for (let k = 1; k <= 8; k++) { controller.SetTrackPosition(0, (sets[0]!.period * k) / 8); pose(0); growBounds(); }
    selectSet(0);
    pose(0);
  }
  const hasGeometry = containers.length > 0 && Number.isFinite(lo[0]!);
  const center = hasGeometry ? [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2] : [0, 0, 0];
  const radius = hasGeometry ? Math.max(1e-3, Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2) : 1;

  // ---- camera + draw
  let yaw = 0.6, pitch = 0.25, distance = radius * 2.6, autoRotate = true, raf = 0, last = performance.now(), frameCounter = 0;
  /** Planes of stages / avatar cards are single-sided in the files; the exe decides the cull mode per object (XMeshPlayer, CKTDGXRenderer), the files carry none. The viewer is an inspector: two-sided by default, D3D's CCW on request. */
  let twoSided = true;
  const draw = (): void => {
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0xff1c2230, 1, 0);
    dev.BeginScene();
    dev.SetRenderState(D3DRS.ZENABLE, 1);
    dev.SetRenderState(D3DRS.ZWRITEENABLE, 1);
    dev.SetRenderState(D3DRS.LIGHTING, 1);
    dev.SetRenderState(D3DRS.AMBIENT, 0xff707070);
    dev.SetRenderState(D3DRS.NORMALIZENORMALS, 1);
    dev.SetRenderState(D3DRS.CULLMODE, twoSided ? D3DCULL.NONE : D3DCULL.CCW);
    // an inspector's choice (the exe sets blending per object): texture alpha blends, nearly transparent texels are dropped so they do not hide what is behind
    dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 1);
    dev.SetRenderState(D3DRS.SRCBLEND, D3DBLEND.SRCALPHA);
    dev.SetRenderState(D3DRS.DESTBLEND, D3DBLEND.INVSRCALPHA);
    dev.SetRenderState(D3DRS.ALPHATESTENABLE, 1);
    dev.SetRenderState(D3DRS.ALPHAREF, 0x08);
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
    for (const d of containers) {
      dev.SetTransform(D3DTS_WORLD, d.skinned ? matIdentity() : d.frame.combineMatrix);
      for (let i = 0; i < d.c.NumMaterials; i++) {
        dev.SetMaterial(d.c.pMaterials[i]!.MatD3D);
        dev.SetTexture(0, d.c.m_apTextures[i] ?? null);
        d.mesh.DrawSubset(i);
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
  const sided = el("input", { type: "checkbox", checked: true, onchange: () => { twoSided = sided.checked; } });
  const bar = el("div", { class: "bar" },
    sets.length ? el("label", {}, "animation ", select) : el("span", { text: "no animation" }),
    sets.length ? el("label", {}, "speed ", speedInput) : null, sets.length ? pauseBtn : null,
    el("label", {}, rotate, " turntable"), el("label", { title: "off = D3DCULL_CCW, the D3D default" }, sided, " two-sided"), el("span", { class: "dim", text: "drag: orbit, wheel: zoom" }));
  const pane = el("div", { class: "pane" }, bar, el("div", { class: "glwrap" }, canvas));
  raf = requestAnimationFrame(tick);
  const refused = refusedByExe ? " - the exe would refuse this mesh (more than 255 frames)" : "";
  const info = kme
    ? `KME static mesh, ${numVertices} vertices, ${numFaces} faces, ${kme.attributeRange.length} subsets of ${kme.materials.length} materials, ${textures.size} textures${missingTextures ? ` (${missingTextures} missing)` : ""}`
    : `${format} ${numFrames} frames (${helperFrames} collision), ${containers.length} drawn mesh containers (${skinned} skinned), ${numVertices} vertices, ${numFaces} faces, ${textures.size} textures${missingTextures ? ` (${missingTextures} missing)` : ""}, ${sets.length} animation sets${refused}`;
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
      if (typeof o.twoSided === "boolean") { twoSided = o.twoSided; sided.checked = twoSided; }
      if (typeof o.yaw === "number") yaw = o.yaw;
      if (typeof o.pitch === "number") pitch = o.pitch;
      if (typeof o.distance === "number") distance = o.distance * radius; // in bounding radii
      if (typeof o.set === "number" && sets[o.set]) { selectSet(o.set); select.value = String(o.set); }
      if (typeof o.time === "number") pose(o.time); // from the start of the set
      draw();
    },
    state() { return { frames: frameCounter, time, setIndex, sets: sets.map((s) => s.name), containers: containers.length, skinned, vertices: numVertices, radius, paused, twoSided, center, yaw }; },
  };
}
