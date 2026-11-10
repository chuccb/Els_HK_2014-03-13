/**
 * `PrefetchSource` (src/prefetch.ts): the files a synchronous world reads from an asynchronous store.  Platform glue, so there is no exe oracle; each
 * expectation follows from the protocol the file describes (resident members are handed out, the others are remembered and loaded between rounds, a
 * round that missed something is void).
 */
import { describe, expect, test } from "bun:test";
import { MAX_ROUNDS, PrefetchSource } from "../src/prefetch.ts";
import type { FileStore } from "../src/prefetch.ts";

/** an asynchronous store of the given members: every load takes a turn of the event loop, and the calls are counted */
class Store implements FileStore {
  readonly calls: string[] = [];
  running = 0;
  mostRunning = 0;
  constructor(private readonly files: Record<string, number>) {}
  has(name: string): boolean {
    return name in this.files;
  }
  async load(name: string): Promise<Uint8Array> {
    this.calls.push(name);
    this.mostRunning = Math.max(this.mostRunning, ++this.running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.running--;
    return new Uint8Array(this.files[name]!).fill(this.files[name]!);
  }
}

describe("PrefetchSource", () => {
  test("a member is not resident until it is loaded; asking for it is remembered, a file that is in no archive is not", async () => {
    const store = new Store({ A: 3, B: 5 });
    const source = new PrefetchSource(store);
    expect(source.has("A")).toBe(true);
    expect(source.has("Z")).toBe(false);
    expect(source.read("A")).toBeUndefined();
    expect(source.read("Z")).toBeUndefined();
    expect([...source.pending]).toEqual(["A"]);
    await source.load(source.pending);
    expect(Array.from(source.read("A")!)).toEqual([3, 3, 3]);
    expect(source.read("B")).toBeUndefined();
    expect([...source.pending]).toEqual(["A", "B"]); // (nothing cleared them: `settle` does that at the start of a round)
    expect([source.loaded, source.loadedBytes, source.residentBytes]).toEqual([1, 3, 3]);
  });

  test("settle runs the code again until a run reads only what is resident, and gives the void runs to discard", async () => {
    // a script that loads a script that loads a script: each file is only asked for once the one before it was read
    const chain = ["A", "B", "C"];
    const store = new Store({ A: 1, B: 2, C: 4 });
    const source = new PrefetchSource(store);
    let runs = 0;
    const run = (): string => {
      runs++;
      let got = "";
      for (const name of chain) {
        const bytes = source.read(name);
        if (!bytes) break;
        got += name + bytes.length;
      }
      return got + "/" + runs;
    };
    const discarded: string[] = [];
    const { result, rounds } = await source.settle(run, (r) => discarded.push(r));
    expect(result).toBe("A1B2C4/4");
    expect(rounds).toBe(4);
    expect(discarded).toEqual(["/1", "A1/2", "A1B2/3"]);
    expect(store.calls).toEqual(["A", "B", "C"]); // each once
    // everything is resident now: a world that reads it again settles in its first run
    expect((await source.settle(run)).rounds).toBe(1);
    expect(store.calls.length).toBe(3);
  });

  test("a run that throws because of a missing file is run again (and is no void result), one that throws with nothing missing is thrown", async () => {
    const source = new PrefetchSource(new Store({ A: 7 }));
    const discarded: unknown[] = [];
    const strict = (): number => {
      const bytes = source.read("A");
      if (!bytes) throw new Error("script A not found");
      return bytes[0]!;
    };
    expect(await source.settle(strict, (r) => discarded.push(r))).toEqual({ result: 7, rounds: 2 });
    expect(discarded.length).toBe(0); // (`toEqual([undefined])` would accept an empty list, too)
    const broken = new Error("the code is wrong");
    await expect(
      source.settle(() => {
        throw broken;
      }),
    ).rejects.toBe(broken);
    // a file that is in no archive is not waited for: the run that asked for it and went on is the last one
    expect(await source.settle(() => source.read("NOPE"))).toEqual({ result: undefined, rounds: 1 });
  });

  test("members are loaded several at a time (the limit given), each name once", async () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < 20; i++) files[`F${i}`] = i + 1;
    const store = new Store(files);
    const source = new PrefetchSource(store, 3);
    await source.load([...Object.keys(files), "F0", "F5", "NOPE"]);
    expect(store.calls.length).toBe(20);
    expect(new Set(store.calls).size).toBe(20);
    expect(store.mostRunning).toBe(3);
    expect(source.loaded).toBe(20);
    expect(source.loadedBytes).toBe((20 * 21) / 2);
    await source.load(["F3", "F4"]); // resident: nothing to do
    expect(store.calls.length).toBe(20);
    const fewer = new PrefetchSource(new Store({ X: 1 }), 8);
    await fewer.load(["X"]);
    expect(fewer.loaded).toBe(1);
  });

  test("settle gives up after MAX_ROUNDS runs of code that always asks for one more file", async () => {
    const files: Record<string, number> = {};
    for (let i = 0; i <= MAX_ROUNDS + 1; i++) files[`N${i}`] = 1;
    const store = new Store(files);
    const source = new PrefetchSource(store);
    let n = 0;
    const endless = (): number => {
      n++;
      for (let i = 0; ; i++) if (!source.read(`N${i}`)) return i;
    };
    await expect(source.settle(endless)).rejects.toThrow("the files did not settle");
    expect(n).toBe(MAX_ROUNDS);
    expect(store.calls.length).toBe(MAX_ROUNDS);
  });

  test("trim forgets the members the evictable pattern matches and the last round did not read, oldest first, down to the limit", async () => {
    const files = { "A.TGA": 100, "B.TGA": 200, "C.LUA": 50, "D.TGA": 10, "E.TGA": 30, "F.LUA": 5, "G.LUA": 7 };
    const source = new PrefetchSource(new Store(files));
    for (const name of ["A.TGA", "B.TGA", "C.LUA", "D.TGA", "E.TGA", "F.LUA"]) await source.load([name]); // (one at a time: the order they became resident in)
    expect(source.residentBytes).toBe(395);
    // two rounds: the first reads D and finds G missing, the second reads G, B and C: what the first one read is no longer what the last round read
    const run = (): string => {
      if (!source.read("G.LUA")) {
        source.read("D.TGA");
        return "first";
      }
      source.read("B.TGA");
      source.read("C.LUA");
      return "second";
    };
    expect((await source.settle(run)).result).toBe("second");
    expect(source.residentBytes).toBe(402);
    // 402 > 330: A goes (the oldest texture nobody read), then 302 is under the limit and the others stay
    expect(source.trim(330, /\.TGA$/)).toBe(1);
    expect(source.residentBytes).toBe(302);
    expect(source.read("A.TGA")).toBeUndefined();
    expect([...source.pending]).toEqual(["A.TGA"]);
    // the limit itself is met: nothing goes
    expect(source.trim(302, /\.TGA$/)).toBe(0);
    // a limit that cannot be met: every texture the last round did not read goes (D, which the first round read, and E), the scripts stay (the pattern does not
    // name them, F was read by no round), and so does B (the last round read it)
    expect(source.trim(0, /\.TGA$/)).toBe(2);
    expect(source.residentBytes).toBe(200 + 50 + 5 + 7);
    expect(source.read("D.TGA")).toBeUndefined();
    expect(source.read("F.LUA")!.length).toBe(5);
    // nothing to forget under the limit
    expect(source.trim(262, /\.TGA$/)).toBe(0);
    expect(source.trim(1000, /./)).toBe(0);
  });
});
