/**
 * Development / delivery server of the web client (docs/ARCHITECTURE.md).
 *
 *   bun run apps/server/src/main.ts [--port 8080] [--host 0.0.0.0]
 *
 *   GET /                  apps/client/index.html
 *   GET /client.js         the client bundle (Bun.build of apps/client/src/main.ts; rebuilt when a source file under apps/client/src or
 *                          in the src directory of a package changed), /client.js.map its source map
 *   GET|HEAD /data/<path>  a file of the original client's data/ directory with Range support: the KOM archives are read the way the
 *                          browser's `httpSource` (packages/kom) reads them, header + manifest first, then single entries
 *   GET /api/files         JSON listing of the loose files (data/ui, data/movie, data/music and the files directly in data/)
 *
 * Only the asset types the client can use are served (not x2.exe, the decompile or the DLLs).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const DATA = join(ROOT, "data");
const CLIENT = join(ROOT, "apps", "client");

const TYPES: Record<string, string> = {
  ".kom": "application/octet-stream", ".avi": "video/x-msvideo", ".ogg": "audio/ogg", ".wav": "audio/wav", ".tga": "image/x-tga",
  ".dds": "image/vnd.ms-dds", ".tet": "application/octet-stream", ".xet": "application/octet-stream", ".ess": "application/octet-stream",
  ".ttf": "font/ttf", ".ttc": "font/collection", ".lua": "application/octet-stream", ".x": "application/octet-stream", ".y": "application/octet-stream",
  ".fx": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

/** Resolves a /data/ URL path to a file inside data/, or null (traversal, unknown type, not a file). */
export function resolveDataPath(urlPath: string): string | null {
  let rel: string;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel.includes("\0") || rel.includes("\\")) return null;
  const full = normalize(join(DATA, rel));
  if (full !== DATA && !full.startsWith(DATA + sep)) return null;
  if (!(extname(full).toLowerCase() in TYPES)) return null;
  try { if (!statSync(full).isFile()) return null; } catch { return null; }
  return full;
}

/** `Range: bytes=a-b | a- | -n` against a file of `size` bytes: [start, end] inclusive, "none" without a Range header, null when not satisfiable. */
export function parseRange(header: string | null, size: number): [number, number] | "none" | null {
  if (!header) return "none";
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "none"; // malformed or multi-range: ignore the header like most servers
  let start: number, end: number;
  if (m[1] === "") { const n = Number(m[2]); if (n === 0) return null; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return null;
  return [start, end];
}

function serveFile(req: Request, path: string): Response {
  const file = Bun.file(path);
  const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string> = { "accept-ranges": "bytes", "content-type": type, "cache-control": "no-cache" };
  const range = parseRange(req.headers.get("range"), file.size);
  if (range === null) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${file.size}` } });
  if (range === "none") return new Response(req.method === "HEAD" ? null : file, { headers: { ...headers, "content-length": String(file.size) } });
  const [start, end] = range;
  return new Response(req.method === "HEAD" ? null : file.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${file.size}`, "content-length": String(end - start + 1) },
  });
}

// ---------------------------------------------------------------------------------------------------------- the bundle
function newestSource(dir: string): number {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "test") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) t = Math.max(t, newestSource(p));
    else if (/\.(ts|html|css)$/.test(e.name)) t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
}
function sourceStamp(): number {
  let t = newestSource(join(CLIENT, "src"));
  for (const d of readdirSync(join(ROOT, "packages"))) if (existsSync(join(ROOT, "packages", d, "src"))) t = Math.max(t, newestSource(join(ROOT, "packages", d, "src")));
  return t;
}
interface Bundle { stamp: number; js: string; map: string }
let bundle: Bundle | null = null;
let building: Promise<Bundle> | null = null;

export async function buildClient(): Promise<Bundle> {
  const stamp = sourceStamp();
  if (bundle && bundle.stamp === stamp) return bundle;
  building ??= (async () => {
    const result = await Bun.build({ entrypoints: [join(CLIENT, "src", "main.ts")], target: "browser", format: "esm", sourcemap: "external", minify: false });
    if (!result.success) throw new Error(`client build failed:\n${result.logs.map((l) => String(l)).join("\n")}`);
    let js = "", map = "";
    for (const out of result.outputs) {
      if (out.kind === "entry-point") js = await out.text();
      else if (out.kind === "sourcemap") map = await out.text();
    }
    bundle = { stamp, js: js.replace(/\n\/\/# sourceMappingURL=.*$/, "") + "\n//# sourceMappingURL=/client.js.map\n", map };
    return bundle;
  })().finally(() => { building = null; });
  return building;
}

// ---------------------------------------------------------------------------------------------------------- loose files
function listLoose(): { name: string; size: number }[] {
  const out: { name: string; size: number }[] = [];
  const add = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !(extname(e.name).toLowerCase() in TYPES) || e.name.toLowerCase().endsWith(".kom")) continue;
      out.push({ name: prefix + e.name, size: statSync(join(dir, e.name)).size });
    }
  };
  add(DATA, "");
  for (const d of ["ui", "movie", "music"]) add(join(DATA, d), `${d}/`);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const p = url.pathname;
  if (p === "/" || p === "/index.html") return new Response(Bun.file(join(CLIENT, "index.html")), { headers: { "cache-control": "no-cache" } });
  if (p === "/client.js" || p === "/client.js.map") {
    try {
      const b = await buildClient();
      return new Response(p === "/client.js" ? b.js : b.map, { headers: { "content-type": p === "/client.js" ? "text/javascript; charset=utf-8" : "application/json", "cache-control": "no-cache" } });
    } catch (e) {
      return new Response(String(e instanceof Error ? e.message : e), { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
  if (p === "/api/files") return Response.json(listLoose(), { headers: { "cache-control": "no-cache" } });
  if (p.startsWith("/data/")) {
    const path = resolveDataPath(p.slice("/data/".length));
    return path ? serveFile(req, path) : new Response("not found", { status: 404 });
  }
  return new Response("not found", { status: 404 });
}

export function startServer(options: { port?: number; hostname?: string } = {}): ReturnType<typeof Bun.serve> {
  return Bun.serve({ port: options.port ?? 8080, hostname: options.hostname ?? "0.0.0.0", fetch: handle });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string, def: string): string => { const i = args.indexOf(name); return i < 0 ? def : (args[i + 1] ?? def); };
  const server = startServer({ port: Number(opt("--port", process.env.PORT ?? "8080")), hostname: opt("--host", "0.0.0.0") });
  console.log(`web client on http://${server.hostname}:${server.port}/  (data: ${DATA})`);
  buildClient().then((b) => console.log(`client bundle: ${(b.js.length / 1024).toFixed(0)} KB`), (e) => console.error(String(e)));
}
