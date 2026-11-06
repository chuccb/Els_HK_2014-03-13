/** Tiny DOM helpers for the viewer (no framework). */
export type Child = Node | string | null | undefined | false;

export interface Attrs {
  class?: string; text?: string; style?: string; title?: string; id?: string; type?: string; value?: string; placeholder?: string;
  min?: string; max?: string; step?: string; checked?: boolean; controls?: boolean; src?: string; draggable?: boolean; tabindex?: string;
  onclick?: (e: MouseEvent) => void; oninput?: (e: Event) => void; onchange?: (e: Event) => void; onkeydown?: (e: KeyboardEvent) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === "class") e.className = v as string;
    else if (k === "text") e.textContent = v as string;
    else if (k.startsWith("on")) (e as unknown as Record<string, unknown>)[k] = v;
    else if (typeof v === "boolean") (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v));
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

export function hex(n: number, width = 8): string { return (n >>> 0).toString(16).padStart(width, "0"); }
export function fmtBytes(n: number): string { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

/** Text of a byte array: UTF-8 / UTF-16 byte order marks are honoured, everything else is read as UTF-8 and, if that has errors, as Latin-1. */
export function decodeText(b: Uint8Array): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder("utf-8").decode(b.subarray(3));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return new TextDecoder("latin1").decode(b); }
}

/** true when the bytes look like text (no control characters other than tab / CR / LF in the first 4 KB, no NULs unless UTF-16) */
export function looksLikeText(b: Uint8Array): boolean {
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return true;
  const n = Math.min(b.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) { const c = b[i]!; if (c < 9 || (c > 13 && c < 32) || c === 127) bad++; }
  return bad === 0;
}

export function hexDump(b: Uint8Array, limit = 4096): string {
  const lines: string[] = [];
  const n = Math.min(b.length, limit);
  for (let o = 0; o < n; o += 16) {
    const row = b.subarray(o, Math.min(o + 16, n));
    const h = Array.from(row, (c) => c.toString(16).padStart(2, "0")).join(" ").padEnd(47);
    const a = Array.from(row, (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : ".")).join("");
    lines.push(`${o.toString(16).padStart(8, "0")}  ${h}  ${a}`);
  }
  if (b.length > n) lines.push(`... ${b.length - n} more bytes`);
  return lines.join("\n");
}
