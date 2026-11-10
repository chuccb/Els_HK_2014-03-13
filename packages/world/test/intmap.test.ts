import { describe, expect, test } from "bun:test";
import { IntMap } from "../src/index.ts";

describe("IntMap (std::map<int, V>)", () => {
  test("an empty map has no element", () => {
    const m = new IntMap<string>();
    expect(m.size).toBe(0);
    expect(m.get(5)).toBeUndefined();
    expect(m.keyAt(0)).toBeUndefined();
    expect(m.lowerBound(5)).toBe(0);
    expect([...m]).toEqual([]);
  });

  test("elements are in key order whatever the order of insertion (negative keys first)", () => {
    const m = new IntMap<string>();
    for (const k of [9, 3, 7, -2, 12, 0]) m.getOrInsert(k, () => `v${k}`);
    expect(m.size).toBe(6);
    expect([...m].map(([k]) => k)).toEqual([-2, 0, 3, 7, 9, 12]);
    expect([...m].map(([, v]) => v)).toEqual(["v-2", "v0", "v3", "v7", "v9", "v12"]);
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => m.keyAt(n))).toEqual([-2, 0, 3, 7, 9, 12, undefined]);
  });

  test("operator[]: a key that is there is found (make is not called), a key that is not is inserted", () => {
    const m = new IntMap<{ n: number }>();
    let made = 0;
    const make = () => ({ n: ++made });
    const a = m.getOrInsert(4, make);
    const b = m.getOrInsert(4, make);
    expect(b).toBe(a);
    expect(made).toBe(1);
    expect(m.getOrInsert(2, make).n).toBe(2);
    expect(m.size).toBe(2);
    expect(m.get(4)).toBe(a);
  });

  test("find: only an equal key is found; lower_bound is the first key that is not less", () => {
    const m = new IntMap<number>();
    for (const k of [3, 7, 9]) m.getOrInsert(k, () => k * 10);
    expect([1, 3, 4, 7, 8, 9, 10].map((k) => m.lowerBound(k))).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect([1, 3, 4, 7, 8, 9, 10].map((k) => m.get(k))).toEqual([undefined, 30, undefined, 70, undefined, 90, undefined]);
  });

  test("clear empties the map", () => {
    const m = new IntMap<number>();
    m.getOrInsert(1, () => 1);
    m.clear();
    expect(m.size).toBe(0);
    expect(m.get(1)).toBeUndefined();
  });
});
