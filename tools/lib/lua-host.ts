/** Shared helper of the Lua tools: runs a precompiled chunk file in a fresh TS VM state, like `luajit file.luac args...`. */
import { readFileSync } from "node:fs";
import { createLuaState, loadChunk, call, LuaError, LuaTable, rawToString } from "@els/lua";

export interface RunResult { output: string; code: number }

export function runLuac(file: string, args: string[] = []): RunResult {
  const data = new Uint8Array(readFileSync(file));
  const chunks: string[] = [];
  const G = createLuaState({
    write: (s) => chunks.push(s),
    getenv: (n) => process.env[n],
    readFile: (p) => {
      try {
        return new Uint8Array(readFileSync(p));
      } catch {
        return undefined;
      }
    },
  });
  // like the standalone interpreter: global `arg` with the script path at [0] and the extra command line words at [1..]
  const argt = new LuaTable();
  argt.setInt(0, file);
  args.forEach((a, i) => argt.setInt(i + 1, a));
  G.globals.setStr("arg", argt);
  let code = 0;
  try {
    // the chunk is named after the path exactly as given on the command line
    const fn = loadChunk(G.main, data, "@" + file);
    call(G.main, fn, []);
  } catch (e) {
    const msg = e instanceof LuaError ? (typeof e.value === "string" ? e.value : rawToString(e.value)) : String((e as Error)?.stack ?? e);
    chunks.push(`LUA ERROR: ${msg}\n`);
    code = 1;
  }
  return { output: chunks.join(""), code };
}
