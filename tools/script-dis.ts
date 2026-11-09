/**
 * The bytecode of scripts of the KOMs as `jit.bc` dumps it (children first, constants in comments): what a DLG script calls, in which order.
 *
 *   bun run tools/script-dis.ts DLG_UI_PET_R_MENU.LUA [MORE.LUA ...]
 */
import { disassemble, loadBytecode } from "@els/lua";
import { indexAllKoms } from "./komindex.ts";

const names = process.argv.slice(2).map((n) => n.toUpperCase());
if (names.length === 0) {
  console.error("usage: script-dis.ts NAME.LUA [NAME.LUA ...]");
  process.exit(2);
}
const index = await indexAllKoms();
for (const name of names) {
  const hit = index.get(name);
  if (!hit) {
    console.error(`${name}: not in the archives`);
    process.exit(1);
  }
  console.log(`=== ${name}`);
  console.log(disassemble(loadBytecode(await hit.kom.read(hit.entry))));
}
