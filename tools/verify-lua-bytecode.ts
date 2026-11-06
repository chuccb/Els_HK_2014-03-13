/**
 * Verifies the TS bytecode loader/lister (packages/lua/src/bytecode.ts) against stock LuaJIT 2.0's own
 * `jit.bc` listing of every game script.
 *
 *   1) build the oracle (tools/lua/README.md), then
 *        LUA_PATH=<luajit>/src/?.lua luajit tools/lua/native_dump_bc.lua <exdir> <list> > native_bc.txt
 *   2) bun run tools/verify-lua-bytecode.ts native_bc.txt
 */
import { readFileSync } from "node:fs";
import { disassemble, loadBytecode } from "@els/lua";
import { indexAllKoms } from "./komindex.ts";

const nativePath = process.argv[2];
if (!nativePath) throw new Error("usage: verify-lua-bytecode.ts <native_bc.txt>");
const native = readFileSync(nativePath, "latin1");
const index = await indexAllKoms();

let pos = 0, ok = 0, bad = 0, protos = 0, instrs = 0;
const bads: string[] = [];
while (pos < native.length) {
  if (!native.startsWith("=== ", pos)) throw new Error(`bad oracle file at ${pos}`);
  const nl = native.indexOf("\n", pos);
  const name = native.slice(pos + 4, nl);
  let next = native.indexOf("\n=== ", nl);
  next = next < 0 ? native.length : next + 1;
  const expected = native.slice(nl + 1, next);
  pos = next;
  const hit = index.get(name.toUpperCase());
  if (!hit) { bads.push(`${name}: not found in any KOM`); bad++; continue; }
  const data = await hit.kom.read(hit.entry);
  let got: string;
  try {
    const pt = loadBytecode(data, { chunkname: "@" + name });
    got = disassemble(pt);
    protos += got.split("-- BYTECODE --").length - 1;
    instrs += got.split("\n").length;
  } catch (e) {
    got = `TS ERROR: ${(e as Error).message}`;
  }
  if (got === expected) ok++;
  else {
    bad++;
    const a = got.split("\n"), b = expected.split("\n");
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    bads.push(`${name}: first diff at line ${i}\n    ts:     ${a[i]}\n    native: ${b[i]}`);
  }
}
console.log(`scripts ok=${ok} bad=${bad}  (protos=${protos}, listing lines=${instrs})`);
for (const b of bads.slice(0, 15)) console.log("  " + b);
process.exit(bad ? 1 : 0);
