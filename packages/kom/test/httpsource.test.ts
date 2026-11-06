/** httpSource over a real HTTP server (the web client's way of reading KOMs). */
import { afterAll, describe, expect, test } from "bun:test";
import { httpSource } from "../src/index.ts";

const body = new Uint8Array(1000).map((_, i) => (i * 7) & 255);
function server(opts: { headLength: boolean; ranges: boolean; streamed?: boolean }) {
  return Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch(req) {
      if (req.method === "HEAD") return new Response(null, { headers: opts.headLength ? { "content-length": String(body.length) } : {} });
      const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get("range") ?? "");
      if (m && opts.ranges) {
        const a = Number(m[1]), b = Math.min(Number(m[2]), body.length - 1);
        return new Response(body.slice(a, b + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/${body.length}` } });
      }
      if (opts.streamed) return new Response(new ReadableStream({ start(c) { c.enqueue(body); c.close(); } })); // chunked: no Content-Length
      return new Response(body);
    },
  });
}
const servers = [
  server({ headLength: true, ranges: true }), server({ headLength: false, ranges: true }),
  server({ headLength: false, ranges: false }), server({ headLength: false, ranges: false, streamed: true }),
];
afterAll(() => { for (const s of servers) s.stop(true); });

describe("httpSource", () => {
  test("size from HEAD, ranges from 206 responses", async () => {
    const src = await httpSource(`http://127.0.0.1:${servers[0]!.port}/f`);
    expect(src.size).toBe(1000);
    expect(Buffer.compare(await src.read(10, 5), Buffer.from(body.subarray(10, 15)))).toBe(0);
    expect((await src.read(0, 0)).length).toBe(0);
  });
  test("without a Content-Length on HEAD the size comes from Content-Range", async () => {
    const src = await httpSource(`http://127.0.0.1:${servers[1]!.port}/f`);
    expect(src.size).toBe(1000);
    expect(Buffer.compare(await src.read(995, 5), Buffer.from(body.subarray(995, 1000)))).toBe(0);
  });
  test("a server that ignores Range and sends the whole file (200): the size is its Content-Length, reads slice the body", async () => {
    const src = await httpSource(`http://127.0.0.1:${servers[2]!.port}/f`);
    expect(src.size).toBe(1000);
    expect(Buffer.compare(await src.read(100, 20), Buffer.from(body.subarray(100, 120)))).toBe(0);
  });
  test("no size anywhere is an error", async () => {
    await expect(httpSource(`http://127.0.0.1:${servers[3]!.port}/f`)).rejects.toThrow(/cannot determine the size/);
  });
});
