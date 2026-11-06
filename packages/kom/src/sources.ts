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
  let size = Number(head.headers.get("content-length"));
  if (!(size > 0)) {
    // some proxies drop the length of a HEAD response: ask for the first byte and read the total from Content-Range
    const probe = await fetch(url, { headers: { Range: "bytes=0-0" } });
    const total = /\/(\d+)\s*$/.exec(probe.headers.get("content-range") ?? "");
    await probe.body?.cancel();
    if (total) size = Number(total[1]);
    else if (probe.status === 200 && Number(probe.headers.get("content-length")) > 0) size = Number(probe.headers.get("content-length"));
    else throw new Error(`${url}: cannot determine the size (no Content-Length on HEAD, no Content-Range on a range request)`);
  }
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
