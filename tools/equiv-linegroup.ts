/**
 * Why six mutants of `CKTDGLineMap.reBuildLineGroup` (packages/world/src/linemap.ts) survive tools/mutate-linemap.py: they are the same function.
 *
 *     bun run tools/equiv-linegroup.ts [--quick]
 *
 * The method is read from the source text, each variant below is made from that text by one edit and compiled, and the groups they make are compared with the
 * original's for EVERY set of lines the exe could be given with up to four lines (each line: `beforeLine` and `nextLine` from -1 to one past the last line,
 * enabled or not: 26,873,856 sets of four) and for random sets of five to nine lines (1.5 million).  A set where two answer differently is printed and the exit
 * code is 1.  `--quick` stops at three lines and 100,000 random sets (about a second).
 *
 *  - `prev >= 1` for `prev >= 0` (also `prev > 0`): a back link to line 0 is never followed.  Line 0 is the first start line; if it is enabled its forward walk has
 *    already taken every line that links back to it (`nextLine` of line 0 is that line and its `beforeLine` is 0), so that line is never a start line or a
 *    member of a later walk.  A disabled line 0 stops the walk by itself.
 *  - `prev <= n`, `next <= n`: `taken[n]` is `undefined`, which is not 0, so the loop ends where `< n` ends it.
 *  - no `if (n <= 0) return`: with no line no loop runs.
 */
const quick = process.argv.includes("--quick");
const source = await Bun.file(new URL("../packages/world/src/linemap.ts", import.meta.url)).text();
const method = source.match(/  reBuildLineGroup\(\): void \{[\s\S]*?\n  \}\n/)?.[0];
if (!method) throw new Error("reBuildLineGroup not found in linemap.ts");

const ts = new Bun.Transpiler({ loader: "ts" });
type Rebuild = (this: { m_LineList: Line[] }) => void;
interface Line {
  bEnable: boolean;
  beforeLine: number;
  nextLine: number;
  m_lineGroupID: { m_iStartLineIndex: number; m_iEndLineIndex: number };
}
function compile(body: string): Rebuild {
  const code = body.replace("reBuildLineGroup(): void {", "function f(): void {");
  return new Function(`${ts.transformSync(code)}\nreturn f;`)() as Rebuild;
}
function edit(from: string, to: string): string {
  if (method!.split(from).length !== 2) throw new Error(`the text to edit is not there exactly once: ${from}`);
  return method!.replace(from, to);
}
const variants: Record<string, string> = {
  "prev >= 1": edit("for (let prev = line.beforeLine; prev >= 0 &&", "for (let prev = line.beforeLine; prev >= 1 &&"),
  "prev <= n": edit("prev < n && taken[prev]", "prev <= n && taken[prev]"),
  "next <= n": edit("next < n && taken[next]", "next <= n && taken[next]"),
  "no early return": edit("if (n <= 0) return;", ""),
};
const original = compile(method);
const others = Object.entries(variants).map(([name, body]) => [name, compile(body)] as const);

type Spec = readonly (readonly [number, number, number])[]; // [beforeLine, nextLine, enabled]
function groups(fn: Rebuild, spec: Spec): string {
  const lines: Line[] = spec.map(([before, next, enabled]) => ({
    bEnable: enabled === 1, beforeLine: before, nextLine: next, m_lineGroupID: { m_iStartLineIndex: 99, m_iEndLineIndex: 99 },
  }));
  fn.call({ m_LineList: lines });
  return lines.map((l) => `${l.m_lineGroupID.m_iStartLineIndex},${l.m_lineGroupID.m_iEndLineIndex}`).join("|");
}

let checked = 0;
const differences: Record<string, number> = {};
function compare(spec: Spec): void {
  const expected = groups(original, spec);
  for (const [name, fn] of others) {
    if (groups(fn, spec) === expected) continue;
    if (!differences[name]) console.log(`${name} differs on ${JSON.stringify(spec)}: ${expected} / ${groups(fn, spec)}`);
    differences[name] = (differences[name] ?? 0) + 1;
  }
  checked++;
}

const exhaustiveTo = quick ? 3 : 4;
for (let n = 0; n <= exhaustiveTo; n++) {
  const choices: [number, number, number][] = [];
  for (let before = -1; before <= n; before++) for (let next = -1; next <= n; next++) for (let enabled = 0; enabled <= 1; enabled++) choices.push([before, next, enabled]);
  const total = choices.length ** n;
  for (let c = 0; c < total; c++) {
    let x = c;
    const spec: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      spec.push(choices[x % choices.length]!);
      x = Math.floor(x / choices.length);
    }
    compare(spec);
  }
  console.log(`${n} lines: ${choices.length ** n} sets (${choices.length} choices per line)`);
}
let seed = 12345;
const random = (k: number): number => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % k;
};
const randomSets = quick ? 100_000 : 1_500_000;
for (let t = 0; t < randomSets; t++) {
  const n = 5 + random(5);
  const spec: [number, number, number][] = [];
  for (let i = 0; i < n; i++) spec.push([random(n + 2) - 1, random(n + 2) - 1, random(5) === 0 ? 0 : 1]);
  compare(spec);
}
const different = Object.keys(differences);
console.log(`${checked} sets of lines compared with ${others.length} variants: ${different.length === 0 ? "no difference" : `DIFFERENT: ${JSON.stringify(differences)}`}`);
process.exit(different.length === 0 ? 0 : 1);
