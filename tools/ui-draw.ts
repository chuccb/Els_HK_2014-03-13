/**
 * Every DLG script of the KOMs drawn through the whole stack, one after the other, and checked against the Direct3D 9 rules.
 *
 *   ./tools/gpu.sh ./node_modules/.bin/bun run tools/ui-draw.ts [--md docs/UI_DRAW.md] [--tsv docs/ui-draw.tsv] [--json OUT.json]
 *                                                              [--png DIR] [--only RE] [--limit N] [--frames N] [--from OLD.json]
 *
 * The dialogs are opened in ONE UI world with a device (the client has one Lua state, so a script may use a global that another one
 * defined; `packages/ui/test-gpu/draw.ts`: the script on the Lua VM, the ported UI classes, the state manager, the dynamic vertex buffers,
 * `Direct3DDevice9` on WebGPU), each drawn once on a cleared 1024 x 768 back buffer; the quads it handed to `DrawPrimitive` are composed
 * again on the CPU by the rules of Direct3D 9 (`reference.ts`).  A script that fails is run again after all the others (a sibling may
 * define the global it needs).  Per dialog the census records how many quads and bars of edges were drawn, how many flushes of glyph
 * pages (the strings) and glyph quads, what is still counted as not drawn, how many pixels are not the clear colour, how far the
 * device's picture is from the CPU's, and what went into the error log.
 * What it is for: a quad shape or a state the reference has no rule for shows up as an error; a dialog that draws nothing shows up in the
 * list of those, with the reason; what the dialogs ask for that is not ported (the controls whose drawing is not ported) is counted over all
 * of them (none, since the movies are drawn: a movie without a player draws its empty render target texture).
 *
 * The textures of a dialog are closed after it is drawn (and their bytes forgotten), and the fonts forget their glyphs (a client that has
 * drawn nothing else; the exe's cache would overflow into a fifth page over a thousand dialogs, FINDINGS 17.12), so a run needs about 1.5 GB.  `--only` takes a
 * case-insensitive regular expression: the other dialogs are not run then, so a script that needs a sibling's global fails.
 * `--json` writes the rows as it goes (every 20 dialogs); `--from` writes the `--md` / `--tsv` reports of the rows of such a file (no dialog is run);
 * `--png` saves every picture.  `--frames N` (default 1) is the number of frames of
 * no time (`OnFrameMove(0, 0)`) each dialog runs before it is drawn: 0 draws what the script built, as the first census did.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { compareImages, newTarget } from "../packages/ui/test-gpu/reference.ts";
import type { UIWorld } from "../packages/ui/src/index.ts";
import { CLEAR, HEIGHT, TOLERANCE, WIDTH, drawDialog, drawnControls, getFixture, newWorld, releaseTextures } from "../packages/ui/test-gpu/draw.ts";
import type { Draw } from "../packages/ui/test-gpu/draw.ts";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string): boolean => process.argv.includes(name);

/** what the census knows about one dialog */
interface Row {
  name: string;
  /** the exception that stopped the dialog (building it, drawing it); the other fields are then the defaults */
  error?: string;
  /** why the CPU composition gave up (`Drawn.referenceError`) */
  referenceError?: string;
  /** `m_bSuccessInitOpenScript`: the script ran to its end */
  opened: boolean;
  /** `m_ControlsList.length` */
  controls: number;
  /** the controls that draw: shown and in the list */
  shown: number;
  classes: Record<string, number>;
  /** `DrawPrimitive` calls of the controls' quads and the bars of their edges (strips of two triangles) */
  quads: number;
  /** of them the bars of edges (`CKTDXDeviceTexture::Draw`: the alpha test is on) */
  bars: number;
  /** quads whose four vertices are one point (a picture whose key the TET lacks): they draw nothing */
  flat: number;
  /** flushes of a glyph page (`CKTDGFreeTypeFont::Flush`: a list of glyph quads), the strings */
  text: number;
  /** the glyph quads in them */
  glyphs: number;
  /** draws that are none of the three shapes the UI makes (see `shapeOf`) */
  odd: number;
  /** `render.undrawn`: what the dialog asked to draw that is not ported yet */
  undrawn: Record<string, number>;
  /** pixels of the device's picture that are not the clear colour */
  covered: number;
  /** the largest difference of a channel between the device's picture and the CPU's */
  max: number;
  /** pixels that differ by more than the tolerance */
  over: number;
  /** entries of the error log (a texture that did not load, a script that failed, ...) */
  log: number;
  /** the entries (`CKTDXLog::PushErrorLog(id, text)`) the dialog added */
  logEntries?: { id: number; text: string }[];
  /** the exception a frame ended in (`Drawn.frameError`): what `OnFrameMove` does there that is not ported */
  frameError?: string;
  /** the script failed the first time and ran after all the others (a sibling script may define the global it needs) */
  retried?: boolean;
  /** the state stack is not back at 0 */
  stack: number;
}

/**
 * The three shapes of draw the UI makes (FINDINGS 17.7, 17.8, 17.13): from the buffer of vertex type 3, alpha blending on (SRCALPHA /
 * INVSRCALPHA), z test off, linear filters, mirrored addressing, a texture on stage 0; either a strip of two triangles
 *  - a control's quad (`RenderVertex`): no alpha test, cull counter-clockwise, vertices left-top, right-top, left-bottom, right-bottom; or
 *  - a bar of an edge (`CKTDXDeviceTexture::Draw`): alpha test not equal to 0, cull clockwise, no z write, left-top, left-bottom, right-top,
 *    right-bottom;
 * or a list of quads, two triangles each, the flush of a glyph page (`CKTDGFreeTypeFont::Flush`): the font's states (no z write) over the
 * dialog's (no alpha test, cull counter-clockwise), the texture a glyph page (its pixels at the draw are the snapshot `image`).
 */
function shapeOf(d: Draw): "control" | "bar" | "text" | "odd" {
  if (d.primitive === 4) {
    const ok = d.type === 3 && d.numDraws === 1 && d.numPrimitives > 0 && d.numPrimitives % 2 === 0 && d.data.length >= d.numPrimitives * 3 * 28 && !!d.texture && !!d.image &&
      d.blendEnable === 1 && d.zEnable === 0 && d.zWrite === 0 && d.srcBlend === 5 && d.destBlend === 6 && d.alphaTest === 0 && d.cullMode === 3 &&
      d.minFilter === 2 && d.magFilter === 2 && d.addressU === 2 && d.addressV === 2;
    return ok ? "text" : "odd";
  }
  if (d.type !== 3 || d.primitive !== 5 || d.numPrimitives !== 2 || d.data.length !== 112) return "odd";
  if (d.blendEnable !== 1 || d.zEnable !== 0 || d.srcBlend !== 5 || d.destBlend !== 6) return "odd";
  if (d.minFilter !== 2 || d.magFilter !== 2 || d.addressU !== 2 || d.addressV !== 2 || !d.texture) return "odd";
  const f = new Float32Array(d.data.buffer, d.data.byteOffset, 28);
  if (d.alphaTest === 0) {
    return d.cullMode === 3 && d.numDraws > 0 && f[0] === f[14] && f[7] === f[21] && f[1] === f[8] && f[15] === f[22] ? "control" : "odd";
  }
  const edge = d.alphaTest === 1 && d.alphaFunc === 6 && d.alphaRef === 0 && d.cullMode === 2 && d.zWrite === 0 && d.numDraws === 1;
  return edge && f[0] === f[7] && f[14] === f[21] && f[1] === f[15] && f[8] === f[22] ? "bar" : "odd";
}

/** a strip whose four vertices are one point */
const isFlat = (d: Draw): boolean => {
  const f = new Float32Array(d.data.buffer, d.data.byteOffset, d.data.length >> 2);
  return f.length >= 28 && new Set([f[0], f[7], f[14], f[21]]).size === 1 && new Set([f[1], f[8], f[15], f[22]]).size === 1;
};

const text = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

/** the world the dialogs are drawn in, one after the other: the client's one Lua state (a script may use a global another one defined) */
async function census(name: string, world: UIWorld): Promise<Row> {
  const row: Row = { name, opened: false, controls: 0, shown: 0, classes: {}, quads: 0, bars: 0, flat: 0, text: 0, glyphs: 0, odd: 0, undrawn: {}, covered: 0, max: 0, over: 0, log: 0, stack: 0 };
  const { source } = await getFixture();
  const render = world.render!;
  const log = world.devices.massFiles.log;
  const logBefore = log.entries.length;
  const stackBefore = render.states.stackPointer;
  render.undrawn.clear();
  try {
    const r = await drawDialog(name, arg("--png") ? `ui-${name.replace(/\.LUA$/, "")}` : undefined, world, arg("--frames") ? Number(arg("--frames")) : 1);
    row.opened = r.dlg.m_bSuccessInitOpenScript;
    if (r.frameError) row.frameError = r.frameError;
    row.controls = r.dlg.m_ControlsList.length;
    row.shown = drawnControls(r.dlg).length;
    for (const c of r.dlg.m_ControlsList) row.classes[c.constructor.name] = (row.classes[c.constructor.name] ?? 0) + 1;
    for (const d of r.draws) {
      const shape = shapeOf(d);
      if (shape === "text") {
        row.text++;
        row.glyphs += d.numPrimitives / 2;
        continue;
      }
      if (shape === "odd") row.odd++;
      else row.quads++;
      if (shape === "bar") row.bars++;
      if (isFlat(d)) row.flat++;
    }
    row.undrawn = Object.fromEntries([...render.undrawn].sort(([a], [b]) => (a < b ? -1 : 1)));
    row.covered = compareImages(r.image, newTarget(WIDTH, HEIGHT, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!), 0).over;
    if (r.referenceError) row.referenceError = r.referenceError;
    else {
      const diff = compareImages(r.image, r.reference, TOLERANCE);
      row.max = diff.max;
      row.over = diff.over;
    }
  } catch (e) {
    row.error = text(e);
    render.states.popTo(stackBefore); // a dialog that threw half way may have left states pushed
  } finally {
    row.stack = render.states.stackPointer - stackBefore;
    const entries = log.entries.slice(logBefore);
    row.log = entries.length;
    if (entries.length) row.logEntries = entries.slice(0, 5).map((e) => ({ id: e.id, text: e.text.slice(0, 200) }));
    releaseTextures(world);
    source.evict(/\.(TGA|DDS|BMP|PNG|JPG)$/);
  }
  return row;
}

// ---- the report -------------------------------------------------------------------------------------------------------------------------

const n = (v: number): string => v.toLocaleString("en-US");
const short = (s: string): string => s.replace(/^CKTDGUI/, "");

/** the error log ids the census meets (`CKTDXLog::PushErrorLog(id, text)`): what the exe's code means by them */
const LOG_IDS = new Map<number, string>([
  [0x24, "a control the dialog does not have (`_GetControl`)"],
  [0x48, "a script that could not be opened"],
  [0x49, "a script that failed (the Lua error is the text)"],
  [0x5a, "a texture that D3DX could not make"],
  [0x5e, "a texture without a Direct3D device"],
  [0x80, "a texture that could not be set on a stage"],
  [0x87, "a file the mass file manager does not have"],
]);

/** why a dialog that drew no quad drew none */
function reasonOf(r: Row): string {
  if (!r.opened) return "the script did not run";
  if (r.controls === 0) return "the script made no control";
  if (r.shown === 0) return "no control is shown";
  if (Object.keys(r.undrawn).length > 0) return "what the shown controls draw is not ported (controls whose drawing is not ported)";
  return "the shown controls have no picture and no text to draw";
}

/** the dialog handed something to `DrawPrimitive` */
const drew = (r: Row): boolean => r.quads + r.text + r.odd > 0;

function markdown(rows: Row[]): string {
  const ok = rows.filter((r) => !r.error);
  const drawn = ok.filter(drew);
  const agree = ok.filter((r) => !r.referenceError && r.over === 0);
  const hist = new Map<string, number>();
  for (const r of ok) {
    if (r.referenceError) continue;
    const k = r.max > TOLERANCE ? `more than ${TOLERANCE}` : String(r.max);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const undrawn = new Map<string, { dialogs: number; count: number }>();
  for (const r of ok) {
    for (const [k, c] of Object.entries(r.undrawn)) {
      const e = undrawn.get(k) ?? undrawn.set(k, { dialogs: 0, count: 0 }).get(k)!;
      e.dialogs++;
      e.count += c;
    }
  }
  const classText = (r: Row): string => Object.entries(r.classes).sort().map(([k, c]) => `${short(k)} ${c}`).join(", ") || "-";
  const cell = (t: string): string => t.replace(/\|/g, "\\|");
  const out: string[] = [];
  out.push("# The dialogs drawn through the device (generated by `tools/ui-draw.ts`)\n");
  out.push(
    "Every `DLG_*.lua` of the archives is opened in one UI world with a device (one Lua state, as in the client), run for one frame of no time (`CKTDGUIDialog::OnFrameMove(0, 0)`: nothing moves, the buttons that wait for their first `ChangeState` make it), drawn once on a cleared 1024 x 768 back buffer through `CKTDGUIDialog::OnFrameRender`, the state manager, the dynamic vertex buffers and `Direct3DDevice9` (WebGPU), and the quads it handed to `DrawPrimitive` are composed again on the CPU by the rules of Direct3D 9 (`packages/ui/test-gpu/reference.ts`). " +
      "The strings of the statics, buttons and radio buttons are drawn too, by the client's fonts (a flush of a glyph page is a list of glyph quads, composed with the pixels the page had at the draw); the fonts forget their glyphs between two dialogs. " +
      "A script that fails is run again after all the others (a sibling script may define the global it needs). " +
      `The device's picture may differ from the CPU's by ${TOLERANCE} levels of a channel (the tolerance of the test). Per dialog: \`docs/ui-draw.tsv\`.\n`,
  );
  out.push("| | dialogs |\n|---|---:|");
  out.push(`| DLG scripts | ${n(rows.length)} |`);
  out.push(`| the script ran to its end | ${n(ok.filter((r) => r.opened).length)} |`);
  out.push(`| ... only the second time (it needs a global that a sibling defines) | ${n(ok.filter((r) => r.opened && r.retried).length)} |`);
  out.push(`| the script did not run (a dead script of this build: it reads a global that nothing defines, FINDINGS 17.30) | ${n(ok.filter((r) => !r.opened).length)} |`);
  out.push(`| drawn without an exception | ${n(ok.length)} |`);
  out.push(`| ... whose frame ended in an exception first (what \`OnFrameMove\` does there is not ported) | ${n(ok.filter((r) => r.frameError).length)} |`);
  out.push(`| ... that draw at least one quad or string | ${n(drawn.length)} |`);
  out.push(`| ... that draw nothing | ${n(ok.length - drawn.length)} |`);
  out.push(`| ... that draw text | ${n(ok.filter((r) => r.text > 0).length)} |`);
  out.push(`| device and CPU agree (no pixel over ${TOLERANCE}) | ${n(agree.length)} |`);
  out.push(`| the CPU composition has no rule for a quad | ${n(ok.filter((r) => r.referenceError).length)} |`);
  out.push(`| ... a pixel is over ${TOLERANCE} | ${n(ok.filter((r) => !r.referenceError && r.over > 0).length)} |`);
  out.push(`| draws that are none of the three shapes the UI makes | ${n(ok.reduce((a, r) => a + r.odd, 0))} (in ${n(ok.filter((r) => r.odd > 0).length)} dialogs) |`);
  out.push(`| the state stack is not back where it was | ${n(ok.filter((r) => r.stack !== 0).length)} |`);
  out.push(`| quads in all | ${n(ok.reduce((a, r) => a + r.quads, 0))} (${n(ok.reduce((a, r) => a + r.bars, 0))} of them bars of edges, ${n(ok.reduce((a, r) => a + r.flat, 0))} without area) |`);
  out.push(`| glyph quads in all | ${n(ok.reduce((a, r) => a + r.glyphs, 0))} (in ${n(ok.reduce((a, r) => a + r.text, 0))} flushes of a glyph page) |`);
  out.push("");
  out.push(`The largest difference of a channel between the device and the CPU, per dialog: ${[...hist].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, c]) => `${k}: ${n(c)}`).join(", ")}.\n`);

  out.push("## What the dialogs ask to draw that is not ported yet\n");
  out.push("`render.undrawn`, summed over the dialogs: a control class whose `OnFrameRender` is not ported, or a part of one.\n");
  if (undrawn.size) {
    out.push("| what | dialogs | times |\n|---|---:|---:|");
    for (const [k, e] of [...undrawn].sort((a, b) => b[1].count - a[1].count)) out.push(`| \`${k}\` | ${n(e.dialogs)} | ${n(e.count)} |`);
  } else out.push("None.");
  out.push("");

  const frames = new Map<string, { dialogs: number; example: string }>();
  for (const r of ok) {
    if (!r.frameError) continue;
    const e = frames.get(r.frameError) ?? frames.set(r.frameError, { dialogs: 0, example: r.name }).get(r.frameError)!;
    e.dialogs++;
  }
  out.push("## What a frame does that is not ported yet\n");
  out.push("The exception the first `OnFrameMove` of a dialog ended in (the dialog is drawn as the frame left it).  Only the first exception of a dialog is kept.\n");
  if (frames.size) {
    out.push("| the exception | dialogs | the first |\n|---|---:|---|");
    for (const [k, e] of [...frames].sort((a, b) => b[1].dialogs - a[1].dialogs)) out.push(`| ${cell(k)} | ${n(e.dialogs)} | \`${e.example}\` |`);
  } else out.push("None.");
  out.push("");

  // the error log: what the dialogs wrote into it while they were built and drawn
  const byId = new Map<number, { entries: number; dialogs: number; example: string }>();
  for (const r of ok) {
    for (const e of r.logEntries ?? []) {
      const g = byId.get(e.id) ?? byId.set(e.id, { entries: 0, dialogs: 0, example: `${r.name}: ${e.text}` }).get(e.id)!;
      g.entries++;
    }
    for (const id of new Set((r.logEntries ?? []).map((e) => e.id))) byId.get(id)!.dialogs++;
  }
  out.push("## The error log\n");
  out.push(`The dialogs wrote ${n(ok.reduce((a, r) => a + r.log, 0))} entries (${n(ok.filter((r) => r.log > 0).length)} dialogs), by id (the table keeps the first 5 entries of a dialog):\n`);
  if (byId.size) {
    out.push("| id | what | entries | dialogs | the first one |\n|---|---|---:|---:|---|");
    for (const [id, g] of [...byId].sort(([a], [b]) => a - b)) out.push(`| 0x${id.toString(16)} | ${LOG_IDS.get(id) ?? "?"} | ${n(g.entries)} | ${n(g.dialogs)} | ${cell(g.example.slice(0, 160))} |`);
  } else out.push("None.");
  out.push("");

  const unexpectedFrame = (r: Row): boolean => r.frameError !== undefined && !/not ported/.test(r.frameError);
  const problems = ok.filter((r) => r.referenceError || r.over > 0 || r.odd > 0 || r.stack !== 0 || unexpectedFrame(r));
  out.push("## Dialogs with a problem\n");
  if (rows.some((r) => r.error) || problems.length) {
    out.push("| dialog | what |\n|---|---|");
    for (const r of rows.filter((x) => x.error)) out.push(`| \`${r.name}\` | exception: ${cell(r.error!)} |`);
    for (const r of problems) {
      const what: string[] = [];
      if (r.referenceError) what.push(`CPU composition: ${cell(r.referenceError)}`);
      if (r.over > 0) what.push(`${n(r.over)} pixels over ${TOLERANCE} (largest ${r.max})`);
      if (r.odd > 0) what.push(`${r.odd} draws of an unknown shape`);
      if (r.stack !== 0) what.push(`state stack ${r.stack > 0 ? "+" : ""}${r.stack}`);
      if (unexpectedFrame(r)) what.push(`frame: ${cell(r.frameError!)}`);
      out.push(`| \`${r.name}\` | ${what.join("; ")} |`);
    }
  } else out.push("None.");
  out.push("");

  const empty = ok.filter((r) => !drew(r));
  const why = new Map<string, number>();
  for (const r of empty) why.set(reasonOf(r), (why.get(reasonOf(r)) ?? 0) + 1);
  out.push("## Dialogs that draw nothing\n");
  out.push("| why | dialogs |\n|---|---:|");
  for (const [k, c] of [...why].sort((a, b) => b[1] - a[1])) out.push(`| ${k} | ${n(c)} |`);
  out.push("");
  out.push("`controls` in the list, `shown` of them draw (shown and in the list); the classes of all the controls.\n");
  out.push("| dialog | why | controls | shown | classes |\n|---|---|---:|---:|---|");
  for (const r of empty) out.push(`| \`${r.name}\` | ${reasonOf(r)} | ${r.controls} | ${r.shown} | ${classText(r)} |`);
  out.push("");
  return out.join("\n");
}

function tsv(rows: Row[]): string {
  const head = ["name", "opened", "retried", "controls", "shown", "quads", "bars", "flat", "text", "glyphs", "odd", "covered", "max", "over", "log", "stack", "classes", "undrawn", "frame_error", "error"];
  const lines = [head.join("\t")];
  for (const r of rows) {
    lines.push(
      [
        r.name, r.opened ? 1 : 0, r.retried ? 1 : 0, r.controls, r.shown, r.quads, r.bars, r.flat, r.text, r.glyphs, r.odd, r.covered, r.max, r.over, r.log, r.stack,
        Object.entries(r.classes).map(([k, c]) => `${k}=${c}`).join(" "),
        Object.entries(r.undrawn).map(([k, c]) => `${k}=${c}`).join("; "),
        r.frameError ?? "",
        [r.error, r.referenceError].filter(Boolean).join(" / "),
      ].join("\t"),
    );
  }
  return lines.join("\n") + "\n";
}

// ---- main -------------------------------------------------------------------------------------------------------------------------------

if (import.meta.main) {
  // the reports of an earlier run (its `--json` file): no dialog is run
  if (arg("--from")) {
    const saved = JSON.parse(readFileSync(arg("--from")!, "utf8")) as Row[];
    if (arg("--md")) writeFileSync(arg("--md")!, markdown(saved));
    if (arg("--tsv")) writeFileSync(arg("--tsv")!, tsv(saved));
    process.exit(0);
  }
  if (arg("--png")) process.env.D3D9_TEST_OUT = arg("--png");
  const t0 = performance.now();
  const { source } = await getFixture();
  const only = arg("--only") ? new RegExp(arg("--only")!, "i") : null;
  let names = [...source.index.keys()].filter((k) => k.startsWith("DLG_") && k.endsWith(".LUA")).sort();
  if (only) names = names.filter((k) => only.test(k));
  if (arg("--limit")) names = names.slice(0, Number(arg("--limit")));

  const jsonPath = arg("--json");
  const world = await newWorld();
  const rows: Row[] = [];
  const report = (k: number, total: number, row: Row, t: number, retry: boolean): void => {
    const bits = [`${row.quads} quads`, `${row.bars} bars`, `${row.glyphs} glyphs in ${row.text} flushes`, `max ${row.max}`, `over ${row.over}`, `covered ${row.covered}`];
    if (row.flat) bits.push(`flat ${row.flat}`);
    if (row.odd) bits.push(`ODD ${row.odd}`);
    if (!row.opened && !row.error) bits.push("script did not run");
    if (row.error) bits.push(`ERROR ${row.error}`);
    if (row.frameError) bits.push(`FRAME ${row.frameError}`);
    if (row.referenceError) bits.push(`REFERENCE ${row.referenceError}`);
    console.error(`[${k}/${total}${retry ? " again" : ""}] ${row.name} ${bits.join(", ")} (${((performance.now() - t) / 1000).toFixed(1)} s, rss ${(process.memoryUsage().rss / 1048576) | 0} MB)`);
  };
  console.error(`${names.length} dialogs`);
  for (const [k, name] of names.entries()) {
    const t = performance.now();
    const row = await census(name, world);
    rows.push(row);
    report(k + 1, names.length, row, t, false);
    if (jsonPath && (k + 1) % 20 === 0) writeFileSync(jsonPath, JSON.stringify(rows));
    if ((k + 1) % 10 === 0) Bun.gc(true); // the pictures and the decoded textures of a dialog are megabytes of garbage each
  }
  // a script that failed on a global it does not define itself needs a sibling that defines it (the client has ONE Lua state): run it again
  // now that all the others have run, as the census of the host layer does
  const again = rows.filter((r) => !r.opened && !r.error);
  for (const [k, first] of again.entries()) {
    const t = performance.now();
    const row = await census(first.name, world);
    row.retried = true;
    rows[rows.indexOf(first)] = row;
    report(k + 1, again.length, row, t, true);
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : 1));
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(rows));
  if (arg("--md")) writeFileSync(arg("--md")!, markdown(rows));
  if (arg("--tsv")) writeFileSync(arg("--tsv")!, tsv(rows));
  console.error(`done in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(0);
}
