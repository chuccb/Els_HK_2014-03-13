#!/usr/bin/env node
// Headless Chromium with WebGPU (SwiftShader) for browser tests; set up by ./tools/setup-browser.sh.
//
//   node tools/browser.mjs <url> [--shot out.png] [--wait "js expression"] [--eval "js expression"]... [--size 1280x800] [--timeout 60000]
//        [--settle 300] [--full] [--quiet]
//
// Opens <url>, forwards console messages and uncaught page errors to stdout, waits for the --wait expression to become truthy (polled
// in the page; without it the load event plus --settle ms; an explicit --settle also delays after the wait), prints the JSON result of every --eval expression (awaited), takes the
// screenshot and exits 1 when the page raised an uncaught error, a request failed or the wait timed out.
//
// As a library: `import { withPage } from "./browser.mjs"`; `await withPage(async (page, log) => {...}, { size: [w, h] })`.
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const DIR = process.env.ELS_BROWSER_DIR ?? "/home/user/work/browser";
const CHROMIUM = process.env.ELS_CHROMIUM ?? "/tmp/chromium";

function ensureInstalled() {
  if (!existsSync(join(DIR, "node_modules", "puppeteer-core")) || !existsSync(CHROMIUM)) {
    execFileSync(join(import.meta.dirname, "setup-browser.sh"), { stdio: "inherit", env: { ...process.env, ELS_BROWSER_DIR: DIR } });
  }
}

export const CHROME_FLAGS = [
  "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
  // --use-vulkan=swiftshader: without it the GPU process cannot create its own Vulkan instance (vkCreateInstance -9), has no shared-image backing
  // for a WebGPU swap chain and destroys the device the first time a canvas is presented to
  "--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-vulkan=swiftshader", "--ignore-gpu-blocklist", "--enable-features=Vulkan",
  "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio",
];

/** Launches the browser, hands `fn` a page (and a log array of console / error lines) and always closes the browser. */
export async function withPage(fn, { size = [1280, 800], flags = [] } = {}) {
  ensureInstalled();
  const puppeteer = createRequire(pathToFileURL(join(DIR, "package.json")))("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: "shell",
    args: [...CHROME_FLAGS, ...(process.env.ELS_BROWSER_FLAGS ? process.env.ELS_BROWSER_FLAGS.split(/\s+/).filter(Boolean) : []), ...flags],
    dumpio: process.env.ELS_BROWSER_DUMPIO === "1",
    defaultViewport: { width: size[0], height: size[1], deviceScaleFactor: 1 },
    env: { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023/lib${process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : ""}`, FONTCONFIG_PATH: "/tmp/fonts", HOME: "/tmp" },
  });
  try {
    const page = await browser.newPage();
    const log = [];
    log.errors = 0;
    page.on("console", (m) => {
      // a failed resource load is reported again by the response / requestfailed handlers below
      if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) log.errors++;
      log.push(`[${m.type()}] ${m.text()}`);
    });
    page.on("pageerror", (e) => { log.errors++; log.push(`[pageerror] ${e.stack ?? e.message ?? e}`); });
    // Chromium reports a HEAD request as aborted (it cancels the body load that does not exist), and a media element aborts its blob: fetch
    // when it is removed or its URL is revoked: neither is a failure
    page.on("requestfailed", (r) => {
      if (r.failure()?.errorText === "net::ERR_ABORTED" && (r.method() === "HEAD" || r.url().startsWith("blob:"))) return;
      log.errors++; log.push(`[requestfailed] ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
    });
    page.on("response", (r) => { if (r.status() >= 400) { log.errors++; log.push(`[http ${r.status()}] ${r.url()}`); } });
    return await fn(page, log);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i < 0 ? def : argv[i + 1]; };
  const all = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
  const url = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["--full", "--quiet"].includes(argv[i - 1])));
  if (!url) { console.error("usage: node tools/browser.mjs <url> [--shot out.png] [--wait expr] [--eval expr]... [--size WxH] [--timeout ms] [--settle ms] [--full] [--quiet]"); process.exit(2); }
  const size = (opt("--size", "1280x800")).split("x").map(Number);
  const timeout = Number(opt("--timeout", "60000"));
  const settle = Number(opt("--settle", "300"));
  let failed = false;
  await withPage(async (page, log) => {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "load", timeout });
    const wait = opt("--wait");
    if (wait) {
      try { await page.waitForFunction(wait, { timeout, polling: 100 }); } catch (e) { failed = true; log.push(`[harness] --wait timed out after ${Date.now() - t0} ms: ${wait}`); }
      if (opt("--settle") !== undefined) await new Promise((r) => setTimeout(r, settle)); // an explicit --settle also applies after the wait
    } else await new Promise((r) => setTimeout(r, settle));
    for (const expr of all("--eval")) {
      try { console.log("eval>", JSON.stringify(await page.evaluate(`(async () => (${expr}))()`))); } catch (e) { failed = true; log.push(`[harness] --eval failed: ${e.message}`); }
    }
    const shot = opt("--shot");
    if (shot) { mkdirSync(dirname(shot), { recursive: true }); await page.screenshot({ path: shot, fullPage: argv.includes("--full") }); console.log("screenshot:", shot); }
    if (!argv.includes("--quiet") || log.errors) for (const l of log) console.log(l);
    if (log.errors) failed = true;
  }, { size });
  process.exit(failed ? 1 : 0);
}
