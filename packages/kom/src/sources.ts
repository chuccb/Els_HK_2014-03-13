import type { ByteSource } from "./archive.ts";

/** ByteSource over a local file (Bun/Node). */
export function fileSource(path: string): ByteSource {
  const file = Bun.file(path);
  return {
    size: file.size,
    async read(offset, length) {
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },
  };
}

/** ByteSource over an HTTP(S) resource using Range requests (the web client's way of reading KOMs). */
export async function httpSource(url: string): Promise<ByteSource> {
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok) throw new Error(`HEAD ${url}: ${head.status}`);
  const size = Number(head.headers.get("content-length"));
  return {
    size,
    async read(offset, length) {
      if (length === 0) return new Uint8Array(0);
      const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (res.status !== 206 && res.status !== 200) throw new Error(`GET ${url} range ${offset}+${length}: ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      return res.status === 200 ? buf.subarray(offset, offset + length) : buf;
    },
  };
}
