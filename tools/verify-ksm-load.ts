/**
 * Load every KSM of the KOMs through the engine's `loadSkinnedMesh` (LoadKSkinnedMesh -> ReadKSM -> KTDXAnimationController::ReadFromMemory) on a
 * software WebGPU device and compare the result with what `parseKsm` says is in the file:
 *   ./tools/gpu.sh ./node_modules/.bin/bun run tools/verify-ksm-load.ts [--limit N] [--verbose]
 * Checks: the load succeeds and logs nothing; frame / container / skinned-container / bone / animation-set counts; every bone frame is the frame
 * the file's index names; the pose of the first set at three times has finite matrices; OptimizeKeys left every channel with 1 .. n of its n keys
 * (the totals before and after are printed).
 */
import { parseKsm } from "@els/assets";
import { D3DXKeyframedAnimationSet } from "@els/d3d9";
import { MultiAnimMC, isKsmData, loadSkinnedMesh } from "@els/engine";
import { newD3D9 } from "../packages/d3d9/test/gpu-helper.ts";
import { indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;
const verbose = args.includes("--verbose");

const dev = await newD3D9(4, 4);
const index = await indexAllKoms();
const problems: string[] = [];
const sum = { files: 0, frames: 0, containers: 0, skinned: 0, bones: 0, vertices: 0, sets: 0, animations: 0, dupNameFiles: 0, noNameFrames: 0, posed: 0, keysInFiles: 0, keysRegistered: 0 };
const t0 = performance.now();
for (const [key, hit] of index) {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  if (ext !== "X" && ext !== "Y") continue;
  const bytes = await hit.kom.read(hit.entry);
  if (!isKsmData(bytes)) continue;
  if (sum.files++ >= limit) break;
  const name = hit.entry.name;
  const logs: string[] = [];
  const parsed = parseKsm(bytes);
  const m = loadSkinnedMesh(bytes, dev, "", (id, text) => logs.push(`0x${id.toString(16)}${text ? ` ${text}` : ""}`));
  if (m.hr < 0 || !m.frameRoot) { problems.push(`${name}: load failed 0x${(m.hr >>> 0).toString(16)} ${logs.join(" ")}`); continue; }
  if (logs.length) problems.push(`${name}: logged ${logs.join(" ")}`);
  if (m.frameList.length !== parsed.frames.length) problems.push(`${name}: ${m.frameList.length} frames, file has ${parsed.frames.length}`);
  sum.frames += parsed.frames.length;
  const names = new Set<string>();
  let dup = false;
  for (const f of m.frameList) { if (names.has(f.Name!) && f.Name !== "<no_name>") dup = true; names.add(f.Name!); if (f.Name === "<no_name>") sum.noNameFrames++; }
  if (dup) sum.dupNameFiles++;
  let containers = 0, skinned = 0;
  m.frameList.forEach((f, i) => {
    const pc = parsed.frames[i]!.meshContainer;
    const mc = f.pMeshContainer as MultiAnimMC | null;
    if (!!pc !== !!mc) { problems.push(`${name}: frame ${i} container presence differs`); return; }
    if (!pc || !mc) return;
    containers++;
    const mesh = mc.MeshData.pMesh!;
    if (mesh.GetNumVertices() !== pc.vertexCount || mesh.GetNumFaces() !== pc.faceCount) problems.push(`${name}: frame ${i} mesh size differs`);
    sum.vertices += pc.vertexCount;
    if (pc.bones.length) {
      skinned++;
      sum.bones += pc.bones.length;
      if (!mc.pSkinInfo || mc.pSkinInfo.GetNumBones() !== pc.bones.length) problems.push(`${name}: frame ${i} skin info differs`);
      pc.bones.forEach((b, bi) => { if (mc.m_ppBoneFrames?.[bi] !== m.frameList[b.frameIndex]) problems.push(`${name}: frame ${i} bone ${bi} frame differs`); });
    } else if (mc.pSkinInfo) problems.push(`${name}: frame ${i} has a skin info without bones`);
    mesh.Release();
  });
  sum.containers += containers; sum.skinned += skinned;
  if (parsed.animation) {
    const c = m.animController;
    if (!c || c.GetNumAnimationSets() !== parsed.animation.sets.length) problems.push(`${name}: animation sets ${c?.GetNumAnimationSets()} vs ${parsed.animation.sets.length}`);
    else {
      sum.sets += c.GetNumAnimationSets();
      sum.animations += parsed.animation.sets.reduce((a, s) => a + s.animations.length, 0);
      // OptimizeKeys only removes keys: every channel that had keys keeps at least one, none has more
      parsed.animation.sets.forEach((ps, si) => {
        const ks = c.GetAnimationSet(si).set as D3DXKeyframedAnimationSet;
        ps.animations.forEach((pa, ai) => {
          const pairs: Array<[number, number]> = [[pa.scales.length, ks.GetNumScaleKeys(ai)], [pa.translations.length, ks.GetNumTranslationKeys(ai)], [pa.rotations.length, ks.GetNumRotationKeys(ai)]];
          for (const [before, after] of pairs) {
            sum.keysInFiles += before; sum.keysRegistered += after;
            if (after > before || (before > 0 && after === 0)) { problems.push(`${name}: set ${si} animation ${ai}: ${before} keys became ${after}`); return; }
          }
        });
      });
      const set = c.GetAnimationSet(0).set!;
      c.SetTrackAnimationSet(0, set); c.SetTrackEnable(0, true); c.SetTrackPosition(0, 0);
      for (const f of [0, 0.5, 1]) {
        c.SetTrackPosition(0, set.GetPeriod() * f);
        c.AdvanceTime(0, null);
        for (const fr of m.frameList) if (!fr.TransformationMatrix.every(Number.isFinite)) { problems.push(`${name}: non-finite pose at ${f}`); break; }
      }
      sum.posed++;
    }
  } else if (m.animController) problems.push(`${name}: controller without a KAC block`);
  if (verbose) console.log(`${name}: ${m.frameList.length} frames, ${containers} containers (${skinned} skinned), ${parsed.animation?.sets.length ?? 0} sets`);
}
console.log(JSON.stringify(sum));
console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (problems.length) { console.log(`${problems.length} problems:`); for (const p of problems.slice(0, 40)) console.log("  " + p); process.exit(1); }
console.log("all KSM files load");
