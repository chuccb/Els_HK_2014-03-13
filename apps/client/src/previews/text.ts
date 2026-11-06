import { parseTet, parseXet } from "@els/assets";
import { disassemble, loadBytecode } from "@els/lua";
import type { Preview } from "../preview.ts";
import { decodeText, el, fmtBytes, hexDump, looksLikeText } from "../ui.ts";

/** Text files as text, LuaJIT bytecode as the disassembly the oracle comparison uses, everything else as a hex dump. */
export function textPreview(name: string, bytes: Uint8Array): Preview {
  let body: string, info: string;
  const isLuaBytecode = bytes.length > 4 && bytes[0] === 0x1b && bytes[1] === 0x4b && bytes[2] === 0x4c;
  if (isLuaBytecode) {
    try {
      const lines = disassemble(loadBytecode(bytes)).split("\n");
      body = lines.length > 6000 ? lines.slice(0, 6000).join("\n") + `\n... ${lines.length - 6000} more lines` : lines.join("\n");
      info = `LuaJIT 2.0 bytecode (KL header), ${fmtBytes(bytes.length)}, ${lines.length} listing lines`;
    } catch (e) {
      body = hexDump(bytes);
      info = `Lua bytecode that did not load: ${e instanceof Error ? e.message : e}`;
    }
  } else if (looksLikeText(bytes)) {
    const text = decodeText(bytes);
    body = text.length > 200_000 ? text.slice(0, 200_000) + "\n... truncated" : text;
    info = `text, ${fmtBytes(bytes.length)}, ${text.split("\n").length} lines`;
  } else {
    body = hexDump(bytes);
    info = `binary, ${fmtBytes(bytes.length)}`;
  }
  const pre = el("pre", { class: "text", text: body });
  return { el: el("div", { class: "pane scroll" }, pre), info, dispose() {} };
}

/** XET / TET (texture-animation and texture-rectangle tables) through the parsers of @els/assets, shown as JSON. */
export function tablePreview(name: string, bytes: Uint8Array): Preview {
  try {
    const isTet = name.toLowerCase().endsWith(".tet");
    const parsed = isTet ? parseTet(bytes) : parseXet(bytes);
    const json = JSON.stringify(parsed, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 1);
    return { el: el("div", { class: "pane scroll" }, el("pre", { class: "text", text: json })), info: `${isTet ? "TET" : "XET"} table, ${fmtBytes(bytes.length)}, parsed by @els/assets`, dispose() {} };
  } catch (e) {
    const p = textPreview(name, bytes);
    return { ...p, info: `${p.info} (not parsed as a table: ${e instanceof Error ? e.message : e})` };
  }
}
