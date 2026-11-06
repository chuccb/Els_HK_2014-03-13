/**
 * Check the particle / XMeshPlayer script parsers (packages/assets/src/{effectscript,particle,xmeshplayer}.ts) against every script in
 * the KOMs:
 *   bun run tools/verify-effects.ts [--census]
 * The scripts are the `.txt` entries whose first word is `ParticleSystem` or `XMeshPlayer` (GameOption*.txt are Lua, bossraid_dummy.txt
 * is empty). There is no native oracle for these parsers, so the checks are:
 *   1. every file parses (no EffectScriptError);
 *   2. the model equals an independent line-based reconstruction (tools/lib/effect-oracle.ts shares no code with the parsers) for every
 *      sequence / templet: all fields, all events, in order;
 *   3. counts agree three ways: parser statistics, the oracle's statement count (`=` signs outside strings and comments) and a raw
 *      census of the block keywords;
 *   4. nothing is left unread: tokens after the main block's closing brace must be the tokenizer's duplicated last token and nothing
 *      else (the exe never reads the rest of a file);
 *   5. the files are what the line reader assumes (one statement per line, no stray lines, ASCII outside comments);
 *   6. the script systems (EFFECT_SYSTEMS: which files `CX2StateStartUp::LoadData` feeds to which of the eight systems, in order) are
 *      built the way the exe does, with later definitions replacing earlier ones; files that no system loads are listed.
 * `--census` also prints how often every property and event kind is used (what the data exercises, and which handled names it never
 * uses: those paths are covered by the unit tests only).
 */
import {
  EFFECT_SYSTEMS, EffectScriptError, PARTICLE_EVENT_TYPES, PARTICLE_PROPERTY_NAMES, XMESH_EVENT_TYPES, XMESH_PROPERTY_NAMES,
  ParticleLibrary, XMeshLibrary, parseParticleScript, parseXMeshPlayerScript,
} from "@els/assets";
import type { ParticleScript, XMeshPlayerScript } from "@els/assets";
import { indexAllKoms } from "./komindex.ts";
import { expectParticleSequence, expectXMeshTemplet, firstDiff, scanLines, stripComment } from "./lib/effect-oracle.ts";

const census = process.argv.includes("--census");

const index = await indexAllKoms();
const files: { name: string; kom: string; bytes: Uint8Array; kind: "particle" | "xmeshplayer" }[] = [];
const skipped: string[] = [];
for (const [key, hit] of [...index].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!key.endsWith(".TXT")) continue;
  const bytes = await hit.kom.read(hit.entry);
  const head = Buffer.from(bytes.subarray(0, 64)).toString("latin1").trimStart().toLowerCase();
  const kind = head.startsWith("particlesystem") ? "particle" : head.startsWith("xmeshplayer") ? "xmeshplayer" : undefined;
  if (!kind) { skipped.push(`${hit.entry.name} (${hit.komName}, ${bytes.length} bytes)`); continue; }
  files.push({ name: hit.entry.name, kom: hit.komName, bytes, kind });
}
console.log(`${files.length} effect scripts (${files.filter((f) => f.kind === "particle").length} particle, ${files.filter((f) => f.kind === "xmeshplayer").length} XMeshPlayer); skipped: ${skipped.join(", ")}`);

const problems: string[] = [];
const fail = (file: string, msg: string): void => { problems.push(`${file}: ${msg}`); };

const totals = { blocks: 0, properties: 0, events: 0, tokens: 0, statements: 0, bytes: 0, comments: 0 };
const sums = { particle: { files: 0, blocks: 0, properties: 0, events: 0 }, xmeshplayer: { files: 0, blocks: 0, properties: 0, events: 0 } };
const parsed = new Map<string, ParticleScript | XMeshPlayerScript>();
const sameFileDuplicates: string[] = [];
const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1); };
const t0 = performance.now();

console.log("\nfile                                     kind        blocks  props   events  tokens   unread");
for (const f of files) {
  const text = Buffer.from(f.bytes).toString("latin1");
  let script: ParticleScript | XMeshPlayerScript;
  try {
    script = f.kind === "particle" ? parseParticleScript(f.bytes) : parseXMeshPlayerScript(f.bytes);
  } catch (e) {
    if (e instanceof EffectScriptError) { fail(f.name, `parse error: ${e.message} (token ${e.tokenIndex}, line ${e.line})`); continue; }
    throw e;
  }
  const st = script.stats;
  const blocks = f.kind === "particle" ? (script as ParticleScript).sequences : (script as XMeshPlayerScript).templets;
  const scan = scanLines(f.bytes);

  // 2. model == independent reconstruction
  if (scan.kind !== f.kind) fail(f.name, `scanner saw a ${scan.kind} header`);
  if (scan.name !== script.name) fail(f.name, `system name "${script.name}" != scanned "${scan.name}"`);
  if (parseFloat(scan.version) !== script.version) fail(f.name, `version ${script.version} != scanned ${scan.version}`);
  if (scan.blocks.length !== blocks.length) fail(f.name, `${blocks.length} blocks parsed, ${scan.blocks.length} scanned`);
  let statements = 0;
  for (let i = 0; i < Math.min(blocks.length, scan.blocks.length); i++) {
    const sb = scan.blocks[i]!;
    statements += sb.statements.length;
    try {
      const expected = f.kind === "particle" ? expectParticleSequence(sb) : expectXMeshTemplet(sb);
      const d = firstDiff(blocks[i], expected);
      if (d) fail(f.name, `block ${i} "${sb.name}" (line ${sb.line}): ${d}`);
    } catch (e) {
      fail(f.name, `block ${i} "${sb.name}" (line ${sb.line}): oracle: ${(e as Error).message}`);
    }
  }

  // 3. counts three ways
  if (st.blocks !== blocks.length) fail(f.name, `stats.blocks ${st.blocks} != ${blocks.length}`);
  if (st.properties + st.events !== statements) fail(f.name, `parser accepted ${st.properties} properties + ${st.events} events, but the file has ${statements} statements`);
  const evCount = blocks.reduce((n, b) => n + (f.kind === "particle" ? (b as ParticleScript["sequences"][number]).events.length
    : (b as XMeshPlayerScript["templets"][number]).globalEvents.length + (b as XMeshPlayerScript["templets"][number]).animEvents.length + (b as XMeshPlayerScript["templets"][number]).dieEvents.length), 0);
  if (evCount !== st.events) fail(f.name, `model holds ${evCount} events, parser counted ${st.events}`);
  // raw census of the block keyword outside comments and strings (does not use the line scanner's block detection)
  const code = text.split("\n").map((l) => stripComment(l.replace(/\r$/, "")).replace(/"[^"]*"/g, '""')).join("\n");
  const keyword = f.kind === "particle" ? /(^|\s)eventsequence(\s|$)/gi : /(^|\s)templet(\s|$)/gi;
  const keywordCount = (code.match(keyword) ?? []).length;
  if (keywordCount !== st.blocks) fail(f.name, `raw census sees ${keywordCount} "${f.kind === "particle" ? "eventsequence" : "templet"}" words, parser read ${st.blocks} blocks`);
  const eqCount = (code.match(/=/g) ?? []).length;
  if (eqCount !== st.properties + st.events) fail(f.name, `raw census sees ${eqCount} "=" signs, parser accepted ${st.properties + st.events} statements`);

  // 4. nothing unread: the tokenizer repeats the last token when the file ends in white space (the usual `}` + CR LF), otherwise there is
  // nothing after the closing brace at all
  const unread = st.tokens - st.tokensRead;
  const lastByte = f.bytes[f.bytes.length - 1]!;
  const endsInSpace = lastByte === 0x20 || (lastByte >= 0x09 && lastByte <= 0x0d);
  if (unread !== (endsInSpace ? 1 : 0)) fail(f.name, `${unread} tokens after the main block (expected ${endsInSpace ? "the duplicated last token" : "none"})`);
  if (scan.trailing !== 0) fail(f.name, `${scan.trailing} non-blank lines after the main block`);

  // 5. the files are what the line reader assumes
  if (scan.stray.length) fail(f.name, `${scan.stray.length} stray lines, first: line ${scan.stray[0]!.line} "${scan.stray[0]!.text}"`);
  if (scan.crowdedLines) fail(f.name, `${scan.crowdedLines} lines with more than one statement or a brace plus text`);
  if (scan.nonAsciiOutsideComments) fail(f.name, `${scan.nonAsciiOutsideComments} non-ASCII bytes outside comments`);

  // duplicates inside one file
  const seenHere = new Set<string>();
  for (const b of blocks) {
    if (seenHere.has(b.name)) sameFileDuplicates.push(`${f.name}: ${b.name}`);
    seenHere.add(b.name);
  }
  parsed.set(f.name, script);

  totals.blocks += st.blocks; totals.properties += st.properties; totals.events += st.events; totals.tokens += st.tokens;
  totals.statements += statements; totals.bytes += f.bytes.length;
  const sum = sums[f.kind];
  sum.files++; sum.blocks += st.blocks; sum.properties += st.properties; sum.events += st.events;
  console.log(`${f.name.padEnd(40)} ${f.kind.padEnd(11)} ${String(st.blocks).padStart(6)} ${String(st.properties).padStart(7)} ${String(st.events).padStart(8)} ${String(st.tokens).padStart(7)} ${String(unread).padStart(8)}`);
}
const ms = performance.now() - t0;

console.log(`\ntotal: ${totals.blocks} blocks, ${totals.properties} properties, ${totals.events} events, ${totals.tokens} tokens, ${totals.statements} statements in ${(totals.bytes / 1e6).toFixed(1)} MB (${ms.toFixed(0)} ms for parse + oracle)`);
for (const k of ["particle", "xmeshplayer"] as const) {
  const s = sums[k];
  console.log(`  ${k}: ${s.files} files, ${s.blocks} ${k === "particle" ? "sequences" : "templets"}, ${s.properties} properties, ${s.events} events`);
}

// 6. the eight script systems
console.log("\nscript systems (CX2StateStartUp::LoadData order):");
const loaded = new Set<string>();
for (const sys of EFFECT_SYSTEMS) {
  const lib = sys.kind === "particle" ? new ParticleLibrary() : new XMeshLibrary();
  let blocks = 0;
  for (const file of sys.files) {
    const sc = parsed.get(file);
    if (!sc) { fail(sys.name, `file ${file} is not among the scripts of the KOMs`); continue; }
    if (sc.stats.blocks === 0 && file !== "UIMinorXMeshPlayer.txt") fail(sys.name, `${file} defines nothing`);
    if (sys.kind === "particle" !== ("sequences" in sc)) { fail(sys.name, `${file} is a ${"sequences" in sc ? "particle" : "XMeshPlayer"} script`); continue; }
    loaded.add(file);
    blocks += sc.stats.blocks;
    if (lib instanceof ParticleLibrary) lib.add(sc as ParticleScript); else (lib as XMeshLibrary).add(sc as XMeshPlayerScript);
  }
  const names = lib instanceof ParticleLibrary ? lib.sequences.size : (lib as XMeshLibrary).templets.size;
  const replaced = lib.replaced;
  console.log(`  ${sys.name.padEnd(22)} id ${sys.id}  ${String(sys.files.length).padStart(2)} files  ${String(blocks).padStart(5)} blocks -> ${String(names).padStart(5)} names, ${replaced.length} replaced${replaced.length ? ` (e.g. ${[...new Set(replaced)].slice(0, 3).join(", ")})` : ""}`);
  if (names + replaced.length !== blocks) fail(sys.name, `${blocks} blocks but ${names} names + ${replaced.length} replaced`);
}
const unloaded = files.filter((f) => !loaded.has(f.name)).map((f) => f.name);
console.log(`not loaded by any system: ${unloaded.join(", ") || "-"}`);
console.log(`names defined twice inside one file: ${sameFileDuplicates.length}${sameFileDuplicates.length ? " e.g. " + sameFileDuplicates.slice(0, 5).join("; ") : ""}`);

if (census) {
  const show = (title: string, m: Map<string, number>, handled: readonly string[]): void => {
    console.log(`\n${title}`);
    const rows = [...m].sort((a, b) => b[1] - a[1]);
    console.log("  " + rows.map(([k, n]) => `${k} ${n}`).join(", "));
    const unused = handled.filter((n) => !m.has(n));
    console.log(`  handled but never used in the data (${unused.length}): ${unused.join(", ")}`);
    const unknown = rows.map(([k]) => k).filter((k) => !handled.includes(k));
    if (unknown.length) console.log(`  used but not in the handled list: ${unknown.join(", ")}`);
  };
  const split = (kind: "particle" | "xmeshplayer"): [Map<string, number>, Map<string, number>] => {
    // the census above mixes both kinds; recompute per kind from the scanner
    const props = new Map<string, number>(), events = new Map<string, number>();
    for (const f of files.filter((x) => x.kind === kind)) {
      for (const b of scanLines(f.bytes).blocks) {
        for (const s of b.statements) {
          const words = s.lhs.toLowerCase().split(/\s+/);
          if (words.length === 1) bump(props, words[0]!);
          else bump(events, words[words.length - 1]!.replace(/.*\)$/, "?"));
        }
      }
    }
    return [props, events];
  };
  const [pp, pe] = split("particle");
  const [xp, xe] = split("xmeshplayer");
  show("particle: sequence properties", pp, PARTICLE_PROPERTY_NAMES);
  show("particle: event kinds", pe, Object.keys(PARTICLE_EVENT_TYPES));
  show("xmeshplayer: templet properties", xp, XMESH_PROPERTY_NAMES);
  show("xmeshplayer: event kinds", xe, Object.keys(XMESH_EVENT_TYPES));
}

if (problems.length) {
  console.log(`\n${problems.length} PROBLEMS:`);
  for (const p of problems.slice(0, 60)) console.log("  " + p);
  if (problems.length > 60) console.log(`  ... and ${problems.length - 60} more`);
  process.exit(1);
}
console.log(`\nOK: ${files.length} scripts, ${totals.blocks} blocks; parser == independent line reader on every field of every block; counts agree three ways; no unread content`);
