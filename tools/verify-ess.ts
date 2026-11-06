/**
 * Decode data/general.ess (the string table, CKTDXStringTable::LoadStringTable 328ADEF0) and report how clean it is:
 *   bun run tools/verify-ess.ts [path]
 */
import { readFileSync } from "node:fs";
import { parseEssWithDiagnostics } from "@els/assets";

const path = process.argv[2] ?? new URL("../data/general.ess", import.meta.url).pathname;
const bytes = new Uint8Array(readFileSync(path));
const { table, diagnostics } = parseEssWithDiagnostics(bytes);
console.log(`${path}: ${bytes.length} bytes, BOM ${bytes[0]!.toString(16)} ${bytes[1]!.toString(16)}`);
console.log("diagnostics:", JSON.stringify(diagnostics));

let withBreaks = 0, withPlaceholders = 0, maxPlaceholder = 0, longest = 0, longestId = -1, loneSurrogates = 0, controls = 0;
const placeholders = new Map<number, number>();
let cjk = 0, ascii = 0;
table.forEach((s, id) => {
  if (s.includes("\r\n")) withBreaks++;
  const ph = [...s.matchAll(/@(\d+)/g)];
  if (ph.length) withPlaceholders++;
  for (const m of ph) { const n = Number(m[1]); maxPlaceholder = Math.max(maxPlaceholder, n); placeholders.set(n, (placeholders.get(n) ?? 0) + 1); }
  if (s.length > longest) { longest = s.length; longestId = id; }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const d = s.charCodeAt(i + 1); if (!(d >= 0xdc00 && d <= 0xdfff)) loneSurrogates++; else i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) loneSurrogates++;
    else if (c < 0x20 && c !== 0x0d && c !== 0x0a && c !== 0x09) controls++;
    else if (c >= 0x4e00 && c <= 0x9fff) cjk++;
    else if (c < 0x80) ascii++;
  }
});
console.log(`entries with line breaks ${withBreaks}, with @N placeholders ${withPlaceholders} (highest @${maxPlaceholder}), longest ${longest} chars (id ${longestId})`);
console.log("placeholder use:", JSON.stringify([...placeholders].sort((a, b) => a[0] - b[0])));
console.log(`characters: CJK ${cjk}, ASCII ${ascii}, lone surrogates ${loneSurrogates}, stray control characters ${controls}`);
for (const id of [0, 1, 2, 100, 1000, 5000, table.length - 1]) console.log(`  [${id}] ${JSON.stringify(table[id])}`);
