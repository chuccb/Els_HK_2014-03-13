/** Runs a LuaJIT 2.0 (KL\x81) bytecode file in the TypeScript VM and writes its output to stdout. Usage: bun run tools/lua-run.ts file.luac */
import { createLuaState, loadChunk, call, LuaError, rawToString } from "@els/lua";

const file = process.argv[2];
if (!file) {
  console.error("usage: lua-run.ts file.luac");
  process.exit(2);
}
const data = new Uint8Array(await Bun.file(file).arrayBuffer());
const chunks: string[] = [];
const G = createLuaState({
  write: (s) => chunks.push(s),
  getenv: (n) => process.env[n],
  readFile: (p) => {
    try {
      return new Uint8Array(require("node:fs").readFileSync(p));
    } catch {
      return undefined;
    }
  },
});
let code = 0;
try {
  // like `luajit file.luac`: the chunk is named after the path exactly as given on the command line
  const fn = loadChunk(G.main, data, "@" + file);
  call(G.main, fn, []);
} catch (e) {
  const msg = e instanceof LuaError ? (typeof e.value === "string" ? e.value : rawToString(e.value)) : String((e as Error)?.stack ?? e);
  chunks.push(`LUA ERROR: ${msg}\n`);
  code = 1;
}
const out = chunks.join("");
const buf = Buffer.from(out, "latin1");
process.stdout.write(buf);
process.exit(code);
