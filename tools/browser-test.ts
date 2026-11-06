/**
 * Browser tests of the web client (apps/client + apps/server) in headless Chromium with WebGPU (SwiftShader):
 *
 *   ./tools/setup-browser.sh            (once; tools/browser.mjs runs it when the browser is missing)
 *   bun run tools/browser-test.ts [--shots dir] [--url http://host:port/]
 *
 * Starts the server in this process (or uses --url), loads the page and checks, against the same decoders run in Bun on the same files:
 *   - the 173 archives mount over HTTP Range requests (97,891 members)
 *   - a TGA, an AVI picture and the frames of a mesh come out pixel-identical / animated, through the real WebGPU canvas path
 * It exits 1 on a failed check or when the page logged an error (console.error, uncaught exception, failed request, HTTP >= 400).
 */
import { mkdirSync } from "node:fs";
import { Mpeg1Movie, decodeImage, yuv420ToBgra } from "@els/assets";
import { startServer } from "../apps/server/src/main.ts";
import { withPage } from "./browser.mjs";
import type { BrowserPage } from "./browser.mjs";
import { indexAllKoms } from "./komindex.ts";

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const shotsDir = opt("--shots");
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

function fnv(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
/** the same hash in the page */
const PAGE_FNV = `(b) => { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }`;

const server = opt("--url") ? null : startServer({ port: 0, hostname: "127.0.0.1" });
const base = opt("--url") ?? `http://127.0.0.1:${server!.port}/`;

async function open(page: BrowserPage, name: string): Promise<void> {
  await page.evaluate(`(async () => { await window.__els.open(${JSON.stringify(name)}); })()`);
  await page.waitForFunction(`window.__els.viewer.preview !== null && document.querySelector('.name').textContent.toLowerCase() === ${JSON.stringify(name.toLowerCase())}`, { timeout: 60000, polling: 50 });
}
const shot = async (page: BrowserPage, name: string): Promise<void> => { if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}.png` }); };

try {
  const t0 = Date.now();
  const log = await withPage(async (page, log) => {
    await page.goto(base, { waitUntil: "load" });
    await page.waitForFunction("window.__els && (window.__els.ready || window.__els.error)", { timeout: 60000, polling: 50 });
    const boot = await page.evaluate<{ ready: boolean; error?: string; archives: number; members: number; missing: number; loose: number }>(
      "({ ready: __els.ready, error: __els.error, archives: __els.vfs?.manager.archives.length, members: __els.vfs?.manager.size, missing: __els.vfs?.missing.length, loose: __els.vfs?.loose.length })");
    check("boot: 173 archives mounted over HTTP Range requests, 97,891 members", boot.ready && boot.archives === 173 && boot.members === 97891 && boot.missing === 0, JSON.stringify(boot));
    check("boot: loose files listed (data/movie 30 AVI, data/music, data/ui)", boot.loose > 150, `${boot.loose}`);
    await shot(page, "01-start");

    // ---- an image: the browser-side decode of a KOM member equals the decode in Bun
    const index = await indexAllKoms("data");
    const kom = async (name: string): Promise<Uint8Array> => { const e = index.get(name.toUpperCase())!; return e.kom.read(e.entry); };
    {
      const name = "dlg_first_loading0_hk.tga";
      await open(page, name);
      const got = await page.evaluate<{ w: number; h: number; hash: string; info: string }>(
        `(async () => { const s = await __els.viewer.preview.snapshot(); return { w: s.width, h: s.height, hash: (${PAGE_FNV})(s.rgba), info: document.querySelector('.info').textContent }; })()`);
      const want = decodeImage(await kom(name));
      check("image: dlg_first_loading0_hk.tga is 512x512 and pixel-identical to the Bun decode", got.w === want.width && got.h === want.height && got.hash === fnv(want.rgba), `${got.hash} ${got.info}`);
      await shot(page, "02-image");
    }

    // ---- a movie: pause, then the shown picture equals the picture Bun decodes
    {
      const name = "movie/movie_create_aisha_base.avi";
      await open(page, name);
      await page.waitForFunction("__els.viewer.preview.state().shown >= 12", { timeout: 30000, polling: 50 });
      const got = await page.evaluate<{ shown: number; hash: string; w: number; h: number; count: number }>(
        `(async () => { document.querySelector('.bar button').click(); const p = __els.viewer.preview; const s = await p.snapshot(); const st = p.state();
           return { shown: st.shown, hash: (${PAGE_FNV})(s.rgba), w: s.width, h: s.height, count: st.frameCount }; })()`);
      const movie = Mpeg1Movie.open(new Uint8Array(await Bun.file("data/movie/movie_create_aisha_base.avi").arrayBuffer()));
      const f = movie.frame(got.shown)!;
      const bgra = yuv420ToBgra(f);
      const rgba = new Uint8Array(bgra.length);
      for (let p = 0; p < bgra.length; p += 4) { rgba[p] = bgra[p + 2]!; rgba[p + 1] = bgra[p + 1]!; rgba[p + 2] = bgra[p]!; rgba[p + 3] = 255; }
      check(`movie: picture ${got.shown + 1}/${got.count} of movie_create_aisha_base.avi (400x220) matches the Bun decode`, got.w === 400 && got.h === 220 && got.hash === fnv(rgba), got.hash);
      await shot(page, "03-movie");
    }

    // ---- a static mesh through the WebGPU canvas: the helper boxes (ATTACK_LINE_*) are not drawn
    const stats = (): string => `(async () => { const p = __els.viewer.preview; const s = await p.snapshot(); let bg = 0, lit = 0; const px = s.rgba;
        for (let i = 0; i < px.length; i += 4) { if (px[i] === 0x1c && px[i+1] === 0x22 && px[i+2] === 0x30) bg++; else lit++; }
        return { lit, bg, hash: (${PAGE_FNV})(px), info: document.querySelector('.info').textContent, state: p.state() }; })()`;
    {
      await open(page, "MESH_ELSWORD_BASIC_WEAPON.X");
      await page.waitForFunction("__els.viewer.preview.state().frames >= 3", { timeout: 30000, polling: 50 });
      const r = await page.evaluate<{ lit: number; bg: number; info: string; state: { containers: number; frames: number } }>(stats());
      check("mesh: MESH_ELSWORD_BASIC_WEAPON.X draws 1 container (the 2 ATTACK_LINE boxes are skipped) and something is lit", r.state.containers === 1 && r.lit > 1000 && r.bg > 100000, `${r.info}; lit ${r.lit}`);
      await shot(page, "04-weapon");
    }

    // ---- a skinned, animated mesh: the picture changes with the animation, and a different animation set is a different pose
    {
      await open(page, "Motion_PET_SONOGONG_STEB_1.X");
      await page.waitForFunction("__els.viewer.preview.state().frames >= 3", { timeout: 60000, polling: 50 });
      // freeze the turntable and play set 0 from 0
      await page.evaluate(`(() => { const cb = document.querySelector('.bar input[type=checkbox]'); if (cb.checked) cb.click(); const b = [...document.querySelectorAll('.bar button')].find((x) => x.textContent === 'pause'); if (b) b.click(); })()`);
      await new Promise((r) => setTimeout(r, 300));
      const a = await page.evaluate<{ lit: number; bg: number; hash: string; info: string; state: { time: number; skinned: number; sets: string[] } }>(stats());
      check("skinned: Motion_PET_SONOGONG_STEB_1.X has 2 skinned containers, 25 animation sets, 3 textures", a.state.skinned === 2 && a.state.sets.length === 25 && /3 textures/.test(a.info), a.info);
      check("skinned: the model is drawn (lit pixels)", a.lit > 5000, `lit ${a.lit}`);
      // resume, let the Walk animation run, freeze, compare
      await page.evaluate(`(() => { [...document.querySelectorAll('.bar button')].find((x) => x.textContent === 'play').click(); })()`);
      await new Promise((r) => setTimeout(r, 450));
      await page.evaluate(`(() => { [...document.querySelectorAll('.bar button')].find((x) => x.textContent === 'pause').click(); })()`);
      await new Promise((r) => setTimeout(r, 150));
      const b = await page.evaluate<{ lit: number; hash: string; state: { time: number } }>(stats());
      check("skinned: animation time advanced and the picture changed", b.state.time > a.state.time + 0.2 && b.hash !== a.hash, `t ${a.state.time.toFixed(2)} -> ${b.state.time.toFixed(2)}; ${a.hash} -> ${b.hash}`);
      await shot(page, "05-pet");
      // another animation set
      await page.evaluate(`(() => { const s = document.querySelector('.bar select'); s.value = '22'; s.dispatchEvent(new Event('change')); [...document.querySelectorAll('.bar button')].find((x) => x.textContent === 'play').click(); })()`);
      await new Promise((r) => setTimeout(r, 600));
      const c = await page.evaluate<{ lit: number; hash: string; state: { setIndex: number } }>(stats());
      check("skinned: selecting animation set 22 (Attack_A) switches the set", c.state.setIndex === 22 && c.lit > 3000, `set ${c.state.setIndex}, lit ${c.lit}`);
    }

    // ---- scripts, tables and audio
    {
      await open(page, "general.ess");
      const info = await page.evaluate<string>("document.querySelector('.info').textContent");
      check("text: general.ess (a loose file) opens as text", /^loose file, .*text/.test(info), info);
      const luaName = [...index.values()].find((e) => /^dlg_.*\.lua$/i.test(e.entry.name))!.entry.name;
      await open(page, luaName);
      const lua = await page.evaluate<string>("document.querySelector('.info').textContent");
      check(`text: ${luaName} opens as a LuaJIT bytecode listing`, /LuaJIT 2\.0 bytecode/.test(lua) && /listing lines/.test(lua), lua);
      await shot(page, "06-lua");
      const ogg = await page.evaluate<string>("[...__els.vfs.loose.map((l) => l.name)].find((n) => n.endsWith('.ogg'))");
      await open(page, ogg);
      await page.waitForFunction("document.querySelector('audio') && document.querySelector('audio').readyState >= 1", { timeout: 20000, polling: 100 }).catch(() => {});
      const dur = await page.evaluate<number>("document.querySelector('audio')?.duration ?? -1");
      check(`audio: ${ogg} is decoded by the browser (duration > 1 s)`, dur > 1, `${dur}`);
    }

    // ---- XET / TET tables
    {
      await open(page, "CHUNG_GIGANTIC_IMPACT04_ice.xet");
      const x = await page.evaluate<string>("document.querySelector('.info').textContent");
      check("table: CHUNG_GIGANTIC_IMPACT04_ice.xet parses as an XET table", /XET table/.test(x) && !/not parsed/.test(x), x);
      await open(page, "dlg_first_loading0_hk.tet");
      const t = await page.evaluate<string>("document.querySelector('.info').textContent");
      check("table: dlg_first_loading0_hk.tet parses as a TET table", /TET table/.test(t) && !/not parsed/.test(t), t);
    }

    // ---- a KSM file is not an X file: the viewer falls back to the hex view with a note
    {
      await open(page, "Mesh_Elsword_Base_SD.x");
      const info = await page.evaluate<string>("document.querySelector('.info').textContent");
      check("fallback: Mesh_Elsword_Base_SD.x (KSM, not X) opens as a binary dump with a note", /not shown as a mesh/.test(info), info);
    }
    // ---- the same fixed views with the canvas / back buffer in either format: the layer must not depend on the swizzle (the preferred
    //      format differs between platforms: rgba8unorm in this headless browser, usually bgra8unorm on a desktop GPU)
    const fixed = async (format: string): Promise<{ format: string; hashes: string[] }> => {
      await page.goto(`${base}?format=${format}`, { waitUntil: "load" });
      await page.waitForFunction("window.__els && (window.__els.ready || window.__els.error)", { timeout: 60000, polling: 50 });
      const hashes: string[] = [];
      for (const [name, ctl] of [["MESH_ELSWORD_BASIC_WEAPON.X", { yaw: 0.6, pitch: 0.25, distance: 2.6, set: 0, time: 0 }], ["Motion_PET_SONOGONG_STEB_1.X", { yaw: -0.5, pitch: 0.1, distance: 2.4, set: 2, time: 0.37 }]] as const) {
        await open(page, name);
        await page.waitForFunction("__els.viewer.preview.state().frames >= 2", { timeout: 60000, polling: 50 });
        const h = await page.evaluate<string>(`(async () => { const p = __els.viewer.preview; p.control({ autoRotate: false, paused: true, ...${JSON.stringify(ctl)} });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const s = await p.snapshot(); return (${PAGE_FNV})(s.rgba); })()`);
        hashes.push(h);
      }
      const used = await page.evaluate<string>("(async () => (await __els.viewer.d3d()).format)()");
      await shot(page, `07-fixed-${format}`);
      return { format: used, hashes };
    };
    const rgba = await fixed("rgba8unorm");
    const bgra = await fixed("bgra8unorm");
    check("formats: the canvas really used rgba8unorm and bgra8unorm", rgba.format === "rgba8unorm" && bgra.format === "bgra8unorm", `${rgba.format} / ${bgra.format}`);
    check("formats: the weapon and the animated pet are pixel-identical with an RGBA and a BGRA back buffer", rgba.hashes.every((h, i) => h === bgra.hashes[i]) && new Set(rgba.hashes).size === 2, `${rgba.hashes.join(",")} / ${bgra.hashes.join(",")}`);
    return log;
  }, { size: [1280, 800] });
  check("the page logged no error (console.error, exception, failed request, HTTP >= 400)", log.errors === 0, log.filter((l) => /^\[(error|pageerror|requestfailed|http)/.test(l)).slice(0, 5).join(" | "));
  console.log(`${failures === 0 ? "all passed" : `${failures} FAILED`} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  server?.stop(true);
}
process.exit(failures === 0 ? 0 : 1);
