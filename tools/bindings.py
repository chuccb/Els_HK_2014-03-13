#!/usr/bin/env python3
"""Extract the lua_tinker bindings that x2.exe exposes to the Lua scripts from the Hex-Rays export.

This is the ground truth of phase 5 (the host API): every class with its Lua name, base class, constructor, fields and
methods, every global function, constant and object that the C++ code registers.  The decompile shows the registration
code as sequences such as

    lua_tinker::class_def<CX2PET, bool (__thiscall CX2PET::*)(float)>(L, "AnimEventTimer", (...)CX2PET::AnimEventTimer_LUA);

    lua_tinker::meta_push(.., class_name<CX2Unit>);  if ( lua_type(L, -1) == 5 ) {          (inlined class_def)
      lua_pushstring(L, "GetClass");  v = lua_newuserdata(L, 8u);  v->nextgc.gcptr32 = (unsigned int)CX2Unit::GetClass;
      lua_pushcclosure(L, lua_tinker::mem_functor<CX2Unit, ...>::invoke<enum CX2Unit::UNIT_CLASS>, 1u);  lua_rawset(L, -3); }

    lua_pushstring(L, "GetDistance_LUA"); lua_pushlightuserdata(L, GetDistance_LUA);        (global function)
    lua_pushcclosure(L, lua_tinker::functor<D3DXVECTOR3 const &, ...>::invoke<float>, 1u); lua_settable(.., -10002);

    lua_pushstring(L, "NF_KR"); lua_pushnumber(L, 256.0); lua_settable(.., -10002);         (global constant)

    python3 tools/bindings.py [functions.tsv] [x2.exe.c]       (defaults: /home/user/work/analysis/functions.tsv, data/x2.exe.c)

Outputs: docs/host_api.tsv (one row per binding), docs/HOST_API.md (human-readable catalog, with how often the 4,498 scripts
use each name when /home/user/work/analysis/api_census.json exists).  Names that the decompiler shows only as the address of a
shared string (`&CX2State::`vftable'[95]`) are reported as `<by address: ...>`; docs/bindings-overrides.tsv resolves them.
"""
import bisect
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNCS = sys.argv[1] if len(sys.argv) > 1 else "/home/user/work/analysis/functions.tsv"
SRC = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "data", "x2.exe.c")
CENSUS = "/home/user/work/analysis/api_census.json"
USAGE = "/home/user/work/analysis/member_usage.json"


def split_top(s, sep=","):
    """Split at top-level separators (not inside () <> [])."""
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch in "(<[":
            depth += 1
        elif ch in ")>]":
            depth = max(0, depth - 1)
        if ch == sep and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def name_of(sig):
    i = sig.find("(")
    head = re.sub(r"@<\w+>", "", sig[:i] if i >= 0 else sig)
    toks, cur, depth = [], "", 0
    for ch in head:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        if ch in " *&" and depth == 0:
            if cur:
                toks.append(cur)
                cur = ""
        else:
            cur += ch
    if cur:
        toks.append(cur)
    return toks[-1] if toks else sig


funcs = []
by_name = collections.defaultdict(list)
for line in open(FUNCS, encoding="utf-8"):
    addr, s, e, sig = line.rstrip("\n").split("\t")
    funcs.append((int(s), int(e), addr, sig))
    by_name[name_of(sig)].append(addr)
starts = [f[0] for f in funcs]


def addr_of(sym):
    """IDA address(es) of a C++ function by its name in the decompile."""
    sym = sym.strip()
    if sym in by_name:
        return "/".join(by_name[sym])
    return ""


overrides = {}
ov_path = os.path.join(ROOT, "docs", "bindings-overrides.tsv")
if os.path.exists(ov_path):
    for line in open(ov_path, encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            k, v = line.rstrip("\n").split("\t")[:2]
            overrides[k] = v

# --- vtable layouts of the header (to name `virtual` bindings: the decompiler shows them as `vcall'{offset}` thunks that
# identical-code folding shares between unrelated classes, so only the vtable byte offset is reliable) ------------------------
vtbls = {}
hdr = open(os.path.join(ROOT, "data", "x2.exe.h"), encoding="utf-8", errors="replace").read()
for m in re.finditer(r"struct /\*VFT\*/ (\S+)_vtbl\n\{\n(.*?)\n\};", hdr, re.S):
    slots = []
    for ln in m.group(2).split("\n"):
        mm = re.search(r"\(__\w+ \*(\w+)\)", ln)
        slots.append(mm.group(1) if mm else "?")
    vtbls[m.group(1)] = slots

# --- which functions register bindings -------------------------------------------------------------------------------
MARK = re.compile(r"lua_tinker::(class_def|class_add|class_mem|class_inh|decl)<|lua_tinker::mem_functor<|lua_tinker::functor<|-10002\)")
lines = open(SRC, encoding="utf-8", errors="replace").read().split("\n")
hits = collections.Counter()
for n, line in enumerate(lines, 1):
    if line.startswith("//") or not MARK.search(line):
        continue
    i = bisect.bisect_right(starts, n) - 1
    if i >= 0 and funcs[i][0] <= n <= funcs[i][1]:
        hits[i] += 1
reg_funcs = [i for i in sorted(hits) if not name_of(funcs[i][3]).startswith("lua_tinker::")]

# --- statement-level parser ---------------------------------------------------------------------------------------------
R_CLASSNAME = re.compile(r"_strcpy_s\(\s*`lua_tinker::class_name<(.+?)>::name'::`2'::temp, 0x100u, \"(.*?)\"\)")
R_CLASS_ADD = re.compile(r"^lua_tinker::class_add<(.+?)>\((.*)\)$")
R_META_PUSH = re.compile(r"lua_tinker::meta_push\(.*`lua_tinker::class_name<(.+?)>::name'::`2'::temp\)")
R_PUSHSTR = re.compile(r"^lua_pushstring\(\s*\w+,\s*(.*)\)$")
R_FPTR = re.compile(r"->nextgc\.gcptr32 = \(unsigned int\)(.+)$")
R_MARKED = re.compile(r"(?:->marked|&\w+->marked) = (0x[0-9A-Fa-f]+|\d+)u?$")
R_MEMFUNCTOR = re.compile(r"lua_tinker::mem_functor<(.+?)>::invoke<(.+?)>,\s*\d+u?\)")
R_FUNCTOR = re.compile(r"lua_tinker::functor<(.+?)>::invoke<(.+?)>,\s*\d+u?\)")
R_CTOR = re.compile(r"lua_tinker::creator<(.+?)>::invoke<lua_tinker::constructor<(.+?)>>")
R_LIGHTUD = re.compile(r"^lua_pushlightuserdata\(.*?,\s*([^,]+)\)$")
R_PUSHNUM = re.compile(r"^lua_pushnumber\(.*?,\s*(-?[0-9.eE+-]+|[A-Za-z_][\w:]*)\)$")
R_PUSHINT = re.compile(r"^lua_pushinteger\(.*?,\s*(.+)\)$")
R_PUSHBOOL = re.compile(r"^lua_pushboolean\(.*?,\s*(.+)\)$")
R_SETTABLE_G = re.compile(r"^lua_settable\(.*-10002\)$")
R_CLASS_DEF = re.compile(r"^lua_tinker::class_def<(.+)>\(\s*(.*)\)$")
R_CLASS_MEM = re.compile(r"^lua_tinker::class_mem<(.+)>\(\s*(.*)\)$")
R_CLASS_INH = re.compile(r"^lua_tinker::class_inh<(.+)>\(")
R_DECL = re.compile(r"^lua_tinker::decl<(.+?)>\(\s*(.*)\)$")
R_PTR2USER = re.compile(r"lua_tinker::ptr2user<(.+?)>::`vftable'")
R_MEMVAR = re.compile(r"lua_tinker::mem_var<(.+)>::`vftable'")
R_VCALL = re.compile(r"`\s*__thiscall (.+?)::\\`vcall'\{(\d+),\{flat\}\}`|` __thiscall (.+?)::\\?`vcall'\{(\d+),\{flat\}\}`")


def lit(expr):
    """Value of a string-literal argument, or <by address: ...> for the shared-string pointers the decompiler mislabels."""
    expr = expr.strip()
    m = re.match(r'^"(.*)"$', expr)
    if m:
        return m.group(1)
    m = re.search(r"&(.+)$", expr)
    key = m.group(1).strip() if m else expr
    key = re.sub(r"^\(const char \*\)", "", key)
    if key in overrides:
        v = overrides[key]
        return v[1:] + " (inferred)" if v.startswith("~") else v
    return f"<by address: {key}>"


def strip_casts(expr):
    """Remove leading C casts such as `(void (__thiscall *)(CX2PET *, float))` / `(unsigned int)`."""
    expr = expr.strip()
    while expr.startswith("("):
        depth = 0
        for i, ch in enumerate(expr):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    rest = expr[i + 1:].strip()
                    break
        else:
            break
        if not rest:
            break
        expr = rest
    return expr


def fn_symbol(expr):
    """Function symbol (or virtual-call thunk) of a member-function-pointer expression."""
    sym = strip_casts(expr)
    mv = re.search(r"__thiscall (.+?)::\\?`vcall'\[(\d+),flat\]", sym)
    if mv:
        return f"virtual[+{mv.group(2)}]", ""
    sym = sym.strip("`'& ")
    return sym, addr_of(sym)


classes = collections.OrderedDict()   # C++ type -> dict
rows = []                              # all bindings


def cls_entry(t):
    return classes.setdefault(t, {"cpp": t, "lua": None, "bases": [], "ctors": [], "reg": None})


def emit(kind, cls, name, cpp="", addr="", sig="", via="", extra=""):
    mv = re.match(r"virtual\[\+(\d+)\]$", cpp)
    if mv:
        off = int(mv.group(1))
        slots = vtbls.get(cls)
        if slots and off // 4 < len(slots):
            cpp = f"{cls}::{slots[off // 4]} (virtual, vtable slot {off // 4})"
        else:
            cpp = f"(virtual, vtable offset +{off})"
    rows.append({"kind": kind, "class": cls, "name": name, "cpp": cpp, "addr": addr, "sig": sig, "via": via, "extra": extra})


def parse_function(idx):
    s, e, faddr, fsig = funcs[idx]
    fname = name_of(fsig)
    body = " ".join(l.strip() for l in lines[s:e])           # lines[s] is the first body line (s is 1-based start)
    body = re.sub(r"\{(\d+),\{flat\}\}", r"[\1,flat]", body)  # vcall'{16,{flat}} would break the statement split
    stmts = [x.strip() for x in re.split(r"[;{}]", body)]
    via = f"{fname}@{faddr}"
    cur_t = None          # class of the last meta_push
    pend_name = None      # last pushed literal
    pend_fptr = None
    pend_off = None
    pend_var = None
    closure = None
    after_name = []       # statements since the last pushstring
    pend_obj_cls = None
    pend_const = None
    for st in stmts:
        st = re.sub(r"\s+", " ", st)
        if not st:
            continue
        m = R_CLASSNAME.search(st)
        if m:
            c = cls_entry(m.group(1))
            c["lua"] = m.group(2)
            c["reg"] = via
            continue
        m = R_CLASS_ADD.match(st)
        if m:
            args = split_top(m.group(2))
            c = cls_entry(m.group(1))
            c["lua"] = lit(args[-1])
            c["reg"] = via
            continue
        m = R_CLASS_INH.match(st)
        if m:
            targs = split_top(m.group(1))
            if len(targs) >= 2:
                cls_entry(targs[0])["bases"].append(targs[1])
            continue
        m = R_CLASS_DEF.match(st)
        if m:
            targs = split_top(m.group(1))
            args = split_top(m.group(2))
            name = lit(args[2])
            sym, addr = fn_symbol(args[3]) if len(args) > 3 else ("", "")
            if "__empty_global_delete" in (args[3] if len(args) > 3 else ""):
                sym, addr = "(no-op: __empty_global_delete)", ""
            cast = re.sub(r"\(unsigned int\).*$", "", args[3]).strip() if len(args) > 3 else ""
            emit("method", targs[0], name, sym, addr, f"{targs[1] if len(targs) > 1 else ''} => {cast}".strip(), via)
            continue
        m = R_CLASS_MEM.match(st)
        if m:
            targs = split_top(m.group(1))
            args = split_top(m.group(2))
            off = args[3] if len(args) > 3 else ""
            om = re.search(r"\)\s*(0x[0-9A-Fa-f]+|\d+|nullptr)$", off)
            offs = om.group(1) if om else off
            if offs == "nullptr":
                offs = "0"
            emit("field", targs[0], lit(args[2]), "", "", f"{targs[2] if len(targs) > 2 else ''} @{offs} (declared in {targs[1] if len(targs) > 1 else ''})", via)
            continue
        m = R_DECL.match(st)
        if m:
            args = split_top(m.group(2))
            emit("object", m.group(1).rstrip(" *"), lit(args[-2]) if len(args) > 1 else "?", "", "", f"decl<{m.group(1)}>", via)
            continue
        m = R_META_PUSH.search(st)
        if m:
            cur_t = m.group(1)
            # an object being declared: lua_setmetatable follows a meta_push that is not followed by `if (lua_type...)`
            pend_obj_cls = m.group(1)
            continue
        m = R_PUSHSTR.match(st)
        if m:
            nm = m.group(1)
            if re.match(r'^"', nm):
                pend_name = lit(nm)
            else:
                pend_name = lit(nm)
            pend_fptr = pend_off = pend_var = closure = pend_const = None
            after_name = []
            continue
        m = R_FPTR.search(st)
        if m:
            val = m.group(1)
            mv = R_MEMVAR.search(val)
            if mv:
                pend_var = mv.group(1)
            else:
                pend_fptr = fn_symbol("(unsigned int)" + val)
            continue
        m = R_MARKED.search(st)
        if m and pend_var is not None:
            pend_off = m.group(1)
            continue
        m = R_CTOR.search(st)
        if m:
            cls_entry(m.group(1))["ctors"].append(m.group(2))
            continue
        m = R_MEMFUNCTOR.search(st)
        if m:
            closure = ("mem", m.group(1), m.group(2))
            continue
        m = R_FUNCTOR.search(st)
        if m:
            closure = ("fn", m.group(1), m.group(2))
            continue
        m = R_LIGHTUD.match(st)
        if m:
            pend_fptr = fn_symbol(m.group(1))
            continue
        for rx in (R_PUSHNUM, R_PUSHINT, R_PUSHBOOL):
            m = rx.match(st)
            if m:
                pend_const = m.group(1)
                break
        if st.startswith("lua_rawset("):
            # inside a class block: method / field / __parent
            if pend_name is not None and cur_t is not None:
                if closure and closure[0] == "mem" and pend_fptr:
                    sym, addr = pend_fptr
                    emit("method", cur_t, pend_name, sym, addr, f"mem_functor<{closure[1]}> -> {closure[2]}", via)
                elif pend_var is not None:
                    emit("field", cur_t, pend_name, "", "", f"{pend_var.split(',', 1)[-1].strip()} @{pend_off}", via)
                elif pend_name.startswith("<by address") and pend_obj_cls and pend_obj_cls != cur_t:
                    pass
            pend_name = None
            continue
        if st.startswith("lua_setmetatable("):
            continue
        if R_SETTABLE_G.match(st):
            if pend_name is not None:
                if closure and closure[0] == "fn":
                    sym, addr = pend_fptr if pend_fptr else ("", "")
                    emit("function", "", pend_name, sym, addr, f"functor<{closure[1]}> -> {closure[2]}", via)
                elif pend_const is not None:
                    emit("constant", "", pend_name, "", "", pend_const, via)
                else:
                    emit("object", pend_obj_cls or "", pend_name, "", "", "pointer pushed with ptr2user/meta_push", via)
            pend_name = None
            pend_const = None
            closure = None
            continue
        if st.startswith("if ( lua_type("):
            continue
    return


for i in reg_funcs:
    parse_function(i)

# inheritance written as   lua_pushstring(L, "__parent"-address); meta_push(class_name<Base>); rawset   inside a class block
# is reported by the decompiler through the mislabeled string; recover it with a second, simpler pass
INH = re.compile(r"lua_tinker::meta_push\([^;]*?class_name<([^;]+?)>::name'::`2'::temp\);\s*if \( lua_type\(\(lua_State \*\)m_pkLuaState, -1\) == 5 \)\s*\{\s*"
                 r"lua_pushstring\(\s*m_pkLuaState,\s*\(const char \*\)&lua_tinker::mem_var<[^;]*?`vftable'\[2\]\);\s*"
                 r"lua_tinker::meta_push\([^;]*?class_name<([^;]+?)>::name'::`2'::temp\);\s*lua_rawset")
for i in reg_funcs:
    s, e, faddr, fsig = funcs[i]
    body = " ".join(l.strip() for l in lines[s:e])
    for m in INH.finditer(body):
        t, b = m.group(1), m.group(2)
        if b not in cls_entry(t)["bases"]:
            cls_entry(t)["bases"].append(b)

# --- reports ------------------------------------------------------------------------------------------------------------
lua_of = {t: (c["lua"] or t) for t, c in classes.items()}
for r in rows:
    if r["class"]:
        r["lua_class"] = lua_of.get(r["class"], r["class"])
    else:
        r["lua_class"] = ""

with open(os.path.join(ROOT, "docs", "host_api.tsv"), "w", encoding="utf-8") as o:
    o.write("kind\tlua_class\tcpp_class\tlua_name\tcpp_function\tida_address\tsignature\tregistered_in\n")
    for r in rows:
        o.write("\t".join([r["kind"], r["lua_class"], r["class"], r["name"], r["cpp"], r["addr"], r["sig"], r["via"]]) + "\n")

usage = {}
if os.path.exists(USAGE):
    usage = json.load(open(USAGE))
census = {}
if os.path.exists(CENSUS):
    census = {e["name"]: e for e in json.load(open(CENSUS))}

kinds = collections.Counter(r["kind"] for r in rows)
unresolved = [r for r in rows if r["name"].startswith("<by address")]
md = ["# Host API of the original client (generated by `tools/bindings.py` from `data/x2.exe.c`)\n",
      "Ground truth for phase 5: the `lua_tinker` bindings that the C++ engine registers for the Lua scripts. "
      "`ida` = address of the C++ function in the export, `uses` = how many times the 4,498 game scripts mention the name as a member / global "
      "(`tools/api-census.ts`, name based, an upper bound). Full machine-readable list: `docs/host_api.tsv`.\n",
      f"* classes registered: **{len(classes)}**; methods **{kinds['method']}**, fields **{kinds['field']}**, global functions **{kinds['function']}**, "
      f"global constants **{kinds['constant']}**, global objects **{kinds['object']}**\n",
      f"* registration code: {len(reg_funcs)} functions (`CKTDXApp::RegisterLuabind`, `CX2Main::RegisterLuabind`, per-state / per-manager registrations)\n"]
if unresolved:
    md.append(f"* {len(unresolved)} entries have names the decompiler shows only as the address of a shared string; they are listed as `<by address: ...>` "
              "(resolve them in `docs/bindings-overrides.tsv`)\n")

md.append("\n## Global functions\n")
md.append("| name | C++ | ida | signature | uses |\n|---|---|---|---|---|")
for r in sorted((r for r in rows if r["kind"] == "function"), key=lambda r: r["name"]):
    md.append(f"| `{r['name']}` | `{r['cpp']}` | {r['addr']} | `{r['sig']}` | {usage.get(r['name'], '')} |")
md.append("\n## Global constants\n")
consts = [r for r in rows if r["kind"] == "constant"]
md.append(", ".join(f"`{r['name']}`={r['sig']}" for r in consts) if consts else "(none)")
md.append("\n## Global objects\n")
md.append("| name | class | registered in |\n|---|---|---|")
for r in rows:
    if r["kind"] == "object":
        md.append(f"| `{r['name']}` | `{r['class']}` | {r['via']} |")
# --- which registered class does each script-visible global (census) belong to?  A global's members read by the scripts must be a
# subset of the methods/fields of its class (including base classes) ----------------------------------------------------------
def member_names(t, seen=None):
    seen = seen or set()
    if t in seen:
        return set()
    seen.add(t)
    names = {r["name"] for r in rows if r["class"] == t and r["kind"] in ("method", "field")}
    for b in classes.get(t, {}).get("bases", []):
        names |= member_names(b, seen)
    return names


cls_members = {t: member_names(t) for t in classes}
md.append("\n## Script-visible globals and their classes\n")
md.append("Globals the scripts read but never assign (`tools/api-census.ts`), with the registered classes whose methods/fields cover "
          "every member the scripts access on them (candidates are inferred from usage; `registered as` = the exe's own registration of an "
          "object with that class, when its name could be read).\n")
md.append("| global | reads | members used | best class (members registered / used) | members the exe does not register | registered as |\n|---|---|---|---|---|---|")
reg_names = collections.defaultdict(list)
for r in rows:
    if r["kind"] == "object" and not r["name"].startswith("<"):
        reg_names[r["name"]].append(r["class"])
unregistered_total = collections.Counter()
for e in sorted(census.values(), key=lambda e: -e["uses"]):
    fl = set(e["fields"]) | set(e["setFields"])
    best, miss = None, set()
    if fl:
        scored = sorted(((len(fl & cls_members[t]), t) for t in classes), key=lambda x: (-x[0], x[1]))
        n, t = scored[0]
        if n >= max(1, len(fl) // 2):
            best, miss = (lua_of.get(t, t), n), fl - cls_members[t]
    if best is None and not e["calls"] and e["name"] not in reg_names and not fl:
        continue
    for m in miss:
        unregistered_total[(e["name"], m)] += (e["fields"].get(m, 0) + e["setFields"].get(m, 0))
    bs = f"{best[0]} ({best[1]}/{len(fl)})" if best else (f"(called {e['calls']}x)" if e["calls"] else "")
    md.append(f"| `{e['name']}` | {e['uses']} | {len(fl)} | {bs} | {', '.join('`'+m+'`' for m in sorted(miss))} | {', '.join(sorted(set(reg_names.get(e['name'], []))))} |")
missing = [n for n in sorted(census) if not n in reg_names and not census[n]["fields"] and not census[n]["calls"]]
md.append("\nExternal names read by scripts without any member access, call or registration found (typos that evaluate to nil in the exe, "
          "or globals registered under names the decompiler hides): " + ", ".join(f"`{n}`" for n in missing) + "\n")
md.append("A script that calls a method the exe does not register fails with `attempt to call method 'X' (a nil value)` in the original; "
          "the port must not add such methods (faithful behaviour). Most frequent cases:\n")
md.append(", ".join(f"`{g}:{m}` x{c}" for (g, m), c in unregistered_total.most_common(25)) + "\n")
md.append("\n## Classes\n")
per_cls = collections.defaultdict(lambda: collections.defaultdict(list))
for r in rows:
    if r["class"] and r["kind"] in ("method", "field"):
        per_cls[r["class"]][r["kind"]].append(r)
order = sorted(set(list(classes) + list(per_cls)), key=lambda t: lua_of.get(t, t))
for t in order:
    c = classes.get(t, {"lua": None, "bases": [], "ctors": []})
    ms, fs = per_cls[t]["method"], per_cls[t]["field"]
    head = f"### `{lua_of.get(t, t)}`" + (f" (C++ `{t}`)" if lua_of.get(t, t) != t else "")
    md.append(head)
    if c["bases"]:
        md.append("- base: " + ", ".join(f"`{lua_of.get(b, b)}`" for b in c["bases"]))
    if c["ctors"]:
        md.append("- constructors: " + "; ".join(f"`({a})`" for a in c["ctors"]))
    if fs:
        md.append("- fields: " + ", ".join(f"`{r['name']}`: {r['sig']}" for r in fs))
    if ms:
        md.append(f"- methods ({len(ms)}):")
        md.append("")
        md.append("| method | C++ | ida | uses |\n|---|---|---|---|")
        for r in sorted(ms, key=lambda r: r["name"]):
            md.append(f"| `{r['name']}` | `{r['cpp']}` | {r['addr']} | {usage.get(r['name'], '')} |")
    md.append("")
with open(os.path.join(ROOT, "docs", "HOST_API.md"), "w", encoding="utf-8") as o:
    o.write("\n".join(md) + "\n")
print(f"registration functions={len(reg_funcs)} classes={len(classes)} rows={len(rows)} {dict(kinds)} unresolved-names={len(unresolved)}")
