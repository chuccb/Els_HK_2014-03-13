import { LuaTable } from "../table.ts";
import { callerError, typeName } from "../value.ts";
import type { LuaValue } from "../value.ts";
import { call, lessThan, tostr, EMPTY } from "../vm.ts";
import type { LuaState, LuaThread } from "../vm.ts";
import { checkFunc, checkInt, checkTable, makeLib, optInt, optStr } from "./util.ts";

/** table.sort: the same quicksort as ltablib.c / LuaJIT 2.0 lib_table.c, so the result order for ties matches. */
function sortTable(L: LuaThread, t: LuaTable, comp: LuaValue): void {
  const lt = (a: LuaValue, b: LuaValue): boolean => {
    if (comp !== undefined) {
      const r = call(L, comp, [a, b])[0];
      return r !== undefined && r !== false;
    }
    return lessThan(L, a, b);
  };
  const get = (i: number): LuaValue => t.getInt(i);
  const set = (i: number, v: LuaValue): void => t.setInt(i, v);
  const auxsort = (l: number, u: number): void => {
    while (l < u) {
      // sort elements a[l], a[(l+u)/2] and a[u]
      let al = get(l), au = get(u);
      if (lt(au, al)) { set(l, au); set(u, al); }
      if (u - l === 1) break; // only 2 elements
      let i = (l + u) >> 1;
      let ai = get(i);
      al = get(l);
      if (lt(ai, al)) { set(i, al); set(l, ai); }
      else {
        au = get(u);
        ai = get(i);
        if (lt(au, ai)) { set(i, au); set(u, ai); }
      }
      if (u - l === 2) break; // only 3 elements
      const P = get(i); // pivot
      const au1 = get(u - 1);
      set(i, au1);
      set(u - 1, P);
      // a[l] <= P == a[u-1] <= a[u], only need to sort from l+1 to u-2
      i = l;
      let j = u - 1;
      for (;;) {
        // repeat ++i until a[i] >= P
        while (lt(get(++i), P)) {
          if (i >= u) throw callerError("invalid order function for sorting"); // LuaJIT: i>=u (PUC 5.1 has i>u)
        }
        // repeat --j until a[j] <= P
        while (lt(P, get(--j))) {
          if (j <= l) throw callerError("invalid order function for sorting"); // LuaJIT: j<=l (PUC 5.1 has j<l)
        }
        if (j < i) break;
        const x = get(i), y = get(j);
        set(i, y);
        set(j, x);
      }
      const x = get(u - 1), y = get(i);
      set(u - 1, y);
      set(i, x); // swap pivot (a[u-1]) with a[i]
      // a[l..i-1] <= a[i] == P <= a[i+1..u]; recurse into the smaller half, loop on the larger
      if (i - l < u - i) {
        j = l; i = i - 1; l = i + 2;
      } else {
        j = i + 1; i = u; u = j - 2;
      }
      auxsort(j, i);
    }
  };
  auxsort(1, t.length());
}

export function installTable(G: LuaState): void {
  makeLib(G.globals, "table", {
    insert(_L, a) {
      const t = checkTable(a, 0, "insert");
      let i = t.length() + 1;
      const nargs = a.length;
      if (nargs !== 2) {
        if (nargs !== 3) throw callerError("wrong number of arguments to 'insert'");
        const n = checkInt(a, 1, "insert");
        for (; i > n; i--) t.setInt(i, t.getInt(i - 1));
        i = n;
      }
      t.setInt(i, a[nargs - 1]);
      return EMPTY;
    },
    remove(_L, a) {
      const t = checkTable(a, 0, "remove");
      const e = t.length();
      let pos = optInt(a, 1, "remove", e);
      if (!(pos >= 1 && pos <= e)) return EMPTY; // nothing to remove
      const v = t.getInt(pos);
      for (; pos < e; pos++) t.setInt(pos, t.getInt(pos + 1));
      t.setInt(e, undefined);
      return [v];
    },
    concat(_L, a) {
      const t = checkTable(a, 0, "concat");
      const sep = optStr(a, 1, "concat", "");
      const i = optInt(a, 2, "concat", 1);
      const j = a[3] === undefined ? t.length() : checkInt(a, 3, "concat");
      const parts: string[] = [];
      for (let k = i; k <= j; k++) {
        const v = t.getInt(k);
        const s = tostr(v);
        if (s === undefined) throw callerError(`invalid value (${typeName(v)}) at index ${k} in table for 'concat'`);
        parts.push(s);
      }
      return [parts.join(sep)];
    },
    maxn(_L, a) {
      const t = checkTable(a, 0, "maxn");
      let max = 0;
      for (let r = t.next(undefined); r !== null; r = t.next(r[0])) {
        if (typeof r[0] === "number" && r[0] > max) max = r[0];
      }
      return [max];
    },
    getn(_L, a) {
      return [checkTable(a, 0, "getn").length()];
    },
    sort(L, a) {
      const t = checkTable(a, 0, "sort");
      if (a[1] !== undefined) checkFunc(a, 1, "sort");
      sortTable(L, t, a[1]);
      return EMPTY;
    },
    foreach(L, a) {
      const t = checkTable(a, 0, "foreach");
      checkFunc(a, 1, "foreach");
      for (let r = t.next(undefined); r !== null; r = t.next(r[0])) {
        const v = call(L, a[1], [r[0], r[1]])[0];
        if (v !== undefined) return [v];
      }
      return [undefined];
    },
    foreachi(L, a) {
      const t = checkTable(a, 0, "foreachi");
      checkFunc(a, 1, "foreachi");
      const n = t.length();
      for (let i = 1; i <= n; i++) {
        const v = call(L, a[1], [i, t.getInt(i)])[0];
        if (v !== undefined) return [v];
      }
      return [undefined];
    },
  });
}
