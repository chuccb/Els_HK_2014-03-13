#!/usr/bin/env python3
"""Which `const char*` parameters of the registered host methods tolerate NULL?  -> docs/host_null_cstr.tsv

  python3 tools/null-cstr.py [--show]

`lua_tinker::read<const char*>` is `lua_tostring(L, i)`: a Lua value that is no string and no number (a table, nil, a missing argument)
reads as NULL, and the C++ function is called with NULL.  Scripts do that by mistake (`SetTex({LEFT_TOP = ...})`), and the exe survives it
wherever the function only hands the pointer to `ConvertUtf8ToWCHAR` (328C1010 tests `pSrc != nullptr` and leaves the destination as it
was), tests it itself, or passes it to MessageBoxA.  Where it would call `strlen(NULL)` the exe crashes; the binder refuses those.

The analysis reads the decompile of the registered function (data/x2.exe.c): a parameter, and every local that is assigned from it
(`v4 = pFileName;`), may be used only as
  - `ConvertUtf8ToWCHAR(dest, p, -1)`: dest a local -> NULL reads as the empty string `L`; dest a member (`&this->m_x`) -> the member is left alone `U`
  - an operand of `!= nullptr` / `== nullptr` (the function decides) `U`
  - the text of `MessageBoxA` `L`
anything else is not tolerant (`.`).  One character per registered parameter: `.` (no cstr / not tolerant), `L`, `U`.
The binder (packages/host/src/tinker.ts) passes `""` for `L` and `undefined` for `U`; a `.` NULL stays a Lua error.
"""
import os
import re
import sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(root, "docs", "host_api.tsv"), encoding="utf-8")][1:]


def split_top(s: str) -> list[str]:
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch in "<([":
            depth += 1
        elif ch in ">)]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def parse_sig(sig: str) -> list[str]:
    m = re.match(r"^(mem_)?functor<(.*)> -> (.*)$", sig)
    if m:
        args = split_top(m.group(2))
        if m.group(1):
            args = args[1:]
        return [a for a in args if a != "void"]
    m = re.match(r"^(.*?) \(__(?:thiscall|cdecl|stdcall|fastcall) [^)]*\)\((.*?)\)(?:const)?(?: =>.*)?$", sig)
    if m:
        return [a for a in split_top(m.group(2)) if a != "void"]
    raise SystemExit(f"cannot parse {sig}")


def is_cstr(t: str) -> bool:
    return re.sub(r"\s+", " ", re.sub(r"\bconst\b", "", t)).strip() == "char *"


wanted: dict[str, list[tuple[str, str, str, list[str]]]] = {}
for r in rows:
    if r[0] not in ("method", "function") or not r[5]:
        continue
    params = parse_sig(r[6])
    if any(is_cstr(p) for p in params):
        addr = f"{int(r[5], 16):08X}"
        wanted.setdefault(addr, []).append((r[0], r[2], r[3], params))

bodies: dict[str, tuple[str, list[str]]] = {}
cur_addr, sig, body, in_body = "", [], [], False


def finish() -> None:
    if cur_addr in wanted:
        bodies[cur_addr] = (" ".join(sig), body)


with open(os.path.join(root, "data", "x2.exe.c"), encoding="utf-8", errors="replace") as f:
    for line in f:
        if line.startswith("//----- ("):
            finish()
            cur_addr, sig, body, in_body = line[9:17].upper(), [], [], False
            continue
        if cur_addr not in wanted or not line.strip():
            continue
        if not in_body and line.startswith("{"):
            in_body = True
            continue
        (body if in_body else sig).append(line.rstrip("\n"))
finish()


def decl_params(sig_text: str) -> list[tuple[str, str]] | None:
    if "@<" in sig_text:
        return None
    i = sig_text.find("(")
    # the first '(' after the function name starts the parameter list
    depth, j = 0, i
    for j in range(i, len(sig_text)):
        depth += sig_text[j] == "("
        depth -= sig_text[j] == ")"
        if depth == 0:
            break
    out = []
    for p in split_top(sig_text[i + 1 : j]):
        m = re.match(r"^(.*?)(\w+)$", p.strip())
        out.append((m.group(1).strip(), m.group(2)) if m else (p, ""))
    return out


def classify(names: set[str], body: list[str]) -> str:
    # `if ( p != nullptr )  v2 = p;`: v2 only ever holds a pointer that was tested, what is done with it afterwards is the function's own
    # business (SetCustomFuncMouseOver: `v2 = chunk; if ( p != nullptr ) v2 = p; member = v2;`)
    guarded: set[str] = set()
    for i, line in enumerate(body[:-1]):
        t = re.search(r"\b(\w+) != nullptr", line)
        a = re.match(r"^\s*(\w+) = (\w+);$", body[i + 1])
        if t and a and t.group(1) in names and a.group(2) == t.group(1):
            guarded.add(a.group(1))
    changed = True
    while changed:  # aliases: `v4 = pFileName;`
        changed = False
        for line in body:
            m = re.match(r"^\s*(\w+) = (\w+);$", line)
            if m and m.group(2) in names and m.group(1) not in names and m.group(1) not in guarded:
                names.add(m.group(1))
                changed = True
    alt = "|".join(re.escape(n) for n in sorted(names))
    use = re.compile(rf"\b({alt})\b")
    kinds: set[str] = set()
    for line in body:
        if re.match(r"^\s*(?:const )?char \*\w+; //", line) or not use.search(line):
            continue
        if re.match(rf"^\s*\w+ = ({alt});$", line):
            continue
        m = re.search(rf"ConvertUtf8ToWCHAR\(\s*([^,]+),\s*({alt}),\s*-1\s*\)", line)
        if m:
            dest = m.group(1).strip()
            kinds.add("L" if re.fullmatch(r"&?\w+", dest) else "U")
            continue
        if re.search(rf"\b({alt})\s*[!=]=\s*nullptr|nullptr\s*[!=]=\s*({alt})\b", line):
            kinds.add("U")
            continue
        if re.search(rf"MessageBoxA\([^,]+,\s*({alt}),", line):
            kinds.add("L")
            continue
        return "."
    if "U" in kinds:
        return "U"
    return "L"  # only locals (or never used)


out = ["cpp_class\tlua_name\taddr\tmask"]
stats = {"L": 0, "U": 0, ".": 0}
for addr, uses in sorted(wanted.items()):
    if addr not in bodies:
        print(f"-- {addr}: function not in the decompile", file=sys.stderr)
        continue
    sig_text, body = bodies[addr]
    dp = decl_params(sig_text)
    for kind, cpp, lua, params in uses:
        mask = ""
        for i, p in enumerate(params):
            if not is_cstr(p):
                mask += "."
                continue
            j = i + 1 if kind == "method" else i
            if dp is None or j >= len(dp) or "char" not in dp[j][0]:
                mask += "."
            else:
                mask += classify({dp[j][1]}, body)
        for ch in mask:
            if ch in stats:
                stats[ch] += 1
        if mask.strip("."):
            out.append(f"{cpp}\t{lua}\t{addr}\t{mask}")
        if "--show" in sys.argv:
            print(f"{addr} {cpp}.{lua} {mask}")
with open(os.path.join(root, "docs", "host_null_cstr.tsv"), "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print(f"{len(wanted)} functions with a char* parameter; parameters: {stats['L']} tolerate NULL as '' (L), {stats['U']} tolerate it as 'not given' (U), {stats['.']} do not (.)", file=sys.stderr)
