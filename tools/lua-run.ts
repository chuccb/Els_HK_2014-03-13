/** Runs a LuaJIT 2.0 (KL\x81) bytecode file in the TypeScript VM and writes its output to stdout. Usage: bun run tools/lua-run.ts file.luac [args...] */
import { runLuac } from "./lib/lua-host.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: lua-run.ts file.luac [args...]");
  process.exit(2);
}
const { output, code } = runLuac(file, process.argv.slice(3));
process.stdout.write(Buffer.from(output, "latin1"));
process.exit(code);
