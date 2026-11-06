/**
 * Parse every KOG-format mesh entry of the KOMs ("KME " static meshes, "KSM " skinned meshes with their embedded "KAC " animations):
 *   bun run tools/verify-ksm.ts [--limit N] [--verbose]
 * Reports parse failures and checks the invariants the exe relies on (indices inside the vertex buffer, attribute ids inside the
 * material list, bones inside the frame list, frame tree reachable from frame 0, key times non-decreasing, finite numbers).
 */
import { parseKme, parseKsm } from "@els/assets";
import type { KMeshData } from "@els/assets";
import { indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;
const verbose = args.includes("--verbose");

const errors: string[] = [];
const problems: string[] = [];
const tally = (m: Map<string, number>, k: string | number): void => { m.set(String(k), (m.get(String(k)) ?? 0) + 1); };
const kmeFvf = new Map<string, number>(), ksmFvf = new Map<string, number>(), options = new Map<string, number>();
const kinds = new Map<string, number>(), playback = new Map<string, number>(), ticks = new Map<string, number>();
const sum = { kme: 0, ksm: 0, frames: 0, containers: 0, bones: 0, vertices: 0, faces: 0, sets: 0, anims: 0, keys: 0, noContainer: 0, withAnim: 0, maxFrames: 0, maxBones: 0, maxPalette: 0 };
const textures = new Set<string>();
const nonEmptyMatrixFrames = { n: 0 };

function checkGeometry(file: string, what: string, g: KMeshData): void {
  let bad = 0;
  for (const i of g.indices) if (i >= g.vertexCount) { bad++; break; }
  if (bad) problems.push(`${file}: ${what} index beyond ${g.vertexCount} vertices`);
  for (const a of g.attributes) if (a >= g.materials.length) { problems.push(`${file}: ${what} attribute ${a} beyond ${g.materials.length} materials`); break; }
  for (const mat of g.materials) if (mat.texture) textures.add(mat.texture.toLowerCase());
  sum.vertices += g.vertexCount; sum.faces += g.faceCount;
  tally(options, g.options);
}

let tried = 0;
const index = await indexAllKoms();
for (const [key, hit] of index) {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  if (ext !== "X" && ext !== "Y") continue;
  const d = await hit.kom.read(hit.entry);
  const isKme = d[0] === 0x4b && d[1] === 0x4d && d[2] === 0x45 && d[3] === 0x20;
  const isKsm = d[0] === 0x4b && d[1] === 0x53 && d[2] === 0x4d && d[3] === 0x20;
  if (!isKme && !isKsm) continue;
  if (tried++ >= limit) break;
  const name = hit.entry.name;
  try {
    if (isKme) {
      const k = parseKme(d);
      sum.kme++;
      tally(kmeFvf, k.fvf);
      checkGeometry(name, "KME", k);
      if (![k.radius, ...k.center].every(Number.isFinite)) problems.push(`${name}: non-finite bounds`);
    } else {
      const k = parseKsm(d);
      sum.ksm++;
      sum.frames += k.frames.length;
      sum.maxFrames = Math.max(sum.maxFrames, k.frames.length);
      // tree: every frame reachable from 0 exactly once
      const seen = new Uint8Array(k.frames.length);
      const stack = k.frames.length ? [0] : [];
      while (stack.length) {
        const i = stack.pop()!;
        if (seen[i]) { problems.push(`${name}: frame ${i} reached twice`); break; }
        seen[i] = 1;
        const f = k.frames[i]!;
        if (f.sibling >= 0) stack.push(f.sibling);
        if (f.firstChild >= 0) stack.push(f.firstChild);
      }
      if (seen.some((v) => !v)) problems.push(`${name}: unreachable frames`);
      let containers = 0;
      for (const f of k.frames) {
        if (!f.matrix.every(Number.isFinite)) problems.push(`${name}: non-finite frame matrix`);
        if (!f.meshContainer) continue;
        containers++;
        const c = f.meshContainer;
        tally(ksmFvf, c.fvf);
        checkGeometry(name, "KSM", c);
        sum.bones += c.bones.length;
        sum.maxBones = Math.max(sum.maxBones, c.bones.length);
        sum.maxPalette = Math.max(sum.maxPalette, c.numPaletteEntries);
        for (const b of c.bones) {
          for (const v of b.vertexIndices) if (v >= c.vertexCount) { problems.push(`${name}: bone influence beyond vertices`); break; }
          if (!b.weights.every(Number.isFinite)) problems.push(`${name}: non-finite weight`);
        }
      }
      sum.containers += containers;
      if (containers === 0) sum.noContainer++;
      if (k.animation) {
        sum.withAnim++;
        for (const s of k.animation.sets) {
          sum.sets++;
          tally(kinds, s.kind); tally(playback, s.playbackType); tally(ticks, s.ticksPerSecond);
          for (const a of s.animations) {
            sum.anims++;
            sum.keys += a.scales.length + a.rotations.length + a.translations.length;
            for (const list of [a.scales, a.rotations, a.translations] as Array<Array<{ time: number; value: number[] }>>) {
              for (let i = 0; i < list.length; i++) {
                if (!list[i]!.value.every(Number.isFinite) || !Number.isFinite(list[i]!.time)) { problems.push(`${name}: non-finite key`); break; }
                if (i > 0 && list[i]!.time < list[i - 1]!.time) { problems.push(`${name}: key times decrease`); break; }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`parsed KME ${sum.kme}, KSM ${sum.ksm} (tried ${tried})`);
console.log("sums:", JSON.stringify(sum));
const show = (t: string, m: Map<string, number>): void => console.log(`${t}:`, JSON.stringify([...m].sort((a, b) => b[1] - a[1])));
show("KME FVF", kmeFvf); show("KSM FVF", ksmFvf); show("index options", options);
show("animation set kinds", kinds); show("playback types", playback); show("ticks/s", ticks);
console.log(`distinct texture names: ${textures.size}`);
console.log(`parse errors: ${errors.length}`);
for (const e of errors.slice(0, verbose ? 300 : 25)) console.log("  " + e);
console.log(`invariant problems: ${problems.length}`);
for (const e of problems.slice(0, verbose ? 300 : 25)) console.log("  " + e);
