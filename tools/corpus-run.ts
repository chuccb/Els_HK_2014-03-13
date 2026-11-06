/**
 * TS side of tools/corpus-diff.sh: runs the stub-environment driver on every script of a list inside ONE process
 * (a fresh Lua state per script) and writes <outdir>/<name>.out in the format of the native runs.
 *
 *   bun run tools/corpus-run.ts <driver.luac> <scriptdir> <listfile> <outdir> <flavor> [startIndex] [nameRegex]
 *
 * The file <outdir>/.current names the script being run, so that a wrapper can skip a script that hangs the VM.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runLuac } from "./lib/lua-host.ts";

const [driver, dir, list, outdir, flavor, start = "0", filter = "."] = process.argv.slice(2);
if (!driver || !dir || !list || !outdir || !flavor) throw new Error("usage: corpus-run.ts driver.luac scriptdir list outdir flavor [start] [regex]");
const re = new RegExp(filter);
const names = readFileSync(list, "latin1").split("\n").filter((n) => n && re.test(n));
let n = 0;
for (let i = Number(start); i < names.length; i++) {
  const name = names[i]!;
  writeFileSync(`${outdir}/.current`, `${i} ${name}`);
  const { output, code } = runLuac(driver, [`${dir}/${name}`, list, flavor]);
  writeFileSync(`${outdir}/${name}.out`, Buffer.from(output + `exit=${code}\n`, "latin1"));
  n++;
}
writeFileSync(`${outdir}/.current`, "done");
console.log(`ran ${n} scripts`);
