#!/usr/bin/env python3
"""Memory layout (member offsets and the size) of a class of data/x2.exe.h, computed with the MSVC x86 rules.

  python3 tools/layout.py CKTDGUIComboBox [--from 0x300] [--find 0x2f4]

Hex-Rays prints members of a class as `*((_DWORD *)this + 202)` when it lost the type of `this`; the offset (202 * 4 = 0x328) names the member
here.  The IDA type library has every member, so the layout can be rebuilt: bases first (an empty base takes no room), each member at the next
multiple of its alignment, the size rounded up to the alignment of the class.  Checked against sizes the exe passes to `operator new`
(CKTDGUIIMEEditBox 0x560, CKTDGUIComboBox 0x424, CKTDGUIListBox 0x3DC ...) and against offsets the setters write (see tools/layout.py --check).

  --from OFF    print only members at or after OFF
  --find OFF    print the member that covers OFF (and its path), the common use for `v1[202]`-style decompile
  --check       run the built-in anchors
"""
import os
import re
import sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
HEADER = os.path.join(root, "data", "x2.exe.h")

SCALARS = {
    "bool": 1, "char": 1, "signed char": 1, "unsigned char": 1, "__int8": 1, "unsigned __int8": 1, "_BYTE": 1, "BYTE": 1,
    "__int16": 2, "unsigned __int16": 2, "short": 2, "unsigned short": 2, "wchar_t": 2, "_WORD": 2, "WORD": 2,
    "int": 4, "unsigned int": 4, "long": 4, "unsigned long": 4, "__int32": 4, "unsigned __int32": 4, "float": 4, "_DWORD": 4, "DWORD": 4,
    "__int64": 8, "unsigned __int64": 8, "double": 8, "long double": 8, "_QWORD": 8, "size_t": 4, "intptr_t": 4, "uintptr_t": 4,
    "void": 1,
}
QUALS = re.compile(r"\b(?:const|volatile|struct|class|union|enum|__unaligned|__cppobj|__ptr32|__ptr64)\b|/\*VFT\*/")
HEAD = re.compile(r"^(struct|union)\s+((?:__cppobj\s+|/\*VFT\*/\s+|__declspec\(align\(\d+\)\)\s+)*)(.+?)\s*$")
ENUM = re.compile(r"^enum\s+(?:__cppobj\s+)?([^:{]+?)\s*(?::\s*(\w[\w ]*?))?\s*$")


def norm(s):
    return re.sub(r"\s+", "", s)


class Struct:
    def __init__(self, name, attrs, bases):
        self.name = name
        self.align_attr = None
        m = re.search(r"align\((\d+)\)", attrs)
        if m:
            self.align_attr = int(m.group(1))
        self.bases = bases
        self.fields = []  # (type, name, dims)
        self.union = False



def split_bases(text):
    """`NAME : BASE, BASE` with `::` and templates in the names: the base list starts at the first ` : ` outside angle brackets"""
    depth = 0
    for i, ch in enumerate(text):
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth -= 1
        elif depth == 0 and text[i:i + 3] == " : ":
            name = text[:i].strip()
            rest = text[i + 3:]
            bases, cur, d = [], "", 0
            for c in rest:
                if c == "<":
                    d += 1
                elif c == ">":
                    d -= 1
                if c == "," and d == 0:
                    bases.append(cur.strip())
                    cur = ""
                else:
                    cur += c
            if cur.strip():
                bases.append(cur.strip())
            return name, bases
    return text.strip(), []


structs = {}
enums = {}


def load():
    cur = None
    pending = None
    with open(HEADER, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if cur is None:
                if pending is not None:
                    if line.strip() == "{":
                        cur = pending
                    pending = None
                    continue
                if line.startswith(("struct ", "union ")) and not line.rstrip().endswith(";"):
                    m = HEAD.match(line.strip())
                    if m:
                        name, bases = split_bases(m.group(3))
                        s = Struct(name, m.group(2) or "", bases)
                        s.union = m.group(1) == "union"
                        pending = s
                elif line.startswith("enum "):
                    name, bases = split_bases(re.sub(r"^enum\s+(?:__cppobj\s+)?", "", line.strip()))
                    enums[norm(name)] = SCALARS.get(bases[0].strip(), 4) if bases else 4
                continue
            if line.startswith("};"):
                structs[norm(cur.name)] = cur
                cur = None
                continue
            t = line.strip()
            if not t.endswith(";") or t.startswith("//"):
                continue
            t = re.sub(r"\s*//.*$", "", t[:-1])
            t = re.sub(r"\s*/\*.*?\*/", "", t)
            t = re.sub(r"\s*:\s*\d+$", "", t)  # bit field
            if "(" in t:  # function pointer member
                m = re.search(r"\(\s*[\w_ ]*\*\s*(\w+)\s*\)", t)
                cur.fields.append(("void *", m.group(1) if m else "?", []))
                continue
            m = re.match(r"^(?P<type>.+?)\s*(?P<ptr>[*&]*)\s*(?P<name>[A-Za-z_]\w*)(?P<dims>(?:\[\d+\])*)$", t)
            if not m:
                continue
            dims = [int(d) for d in re.findall(r"\[(\d+)\]", m.group("dims"))]
            ty = m.group("type") + (" *" if m.group("ptr") else "")
            cur.fields.append((ty, m.group("name"), dims))


unknown = set()


def sizeof(ty):
    """(size, align) of a type name"""
    if ty.rstrip().endswith("*") or ty.rstrip().endswith("&"):
        return 4, 4
    t = re.sub(r"\s+", " ", QUALS.sub("", ty)).strip()
    if t in SCALARS:
        return SCALARS[t], min(SCALARS[t], 8)
    key = norm(t)
    if key in enums:
        return enums[key], enums[key]
    s = structs.get(key)
    if s is not None:
        return layout(s)[1:]
    # a container whose instantiation the type library does not spell the way the member does: the MSVC 2019 sizes
    for prefix, size in (("std::map<", 8), ("std::set<", 8), ("std::multimap<", 8), ("std::multiset<", 8), ("std::list<", 8), ("std::vector<", 12),
                         ("std::deque<", 20), ("std::queue<", 20), ("std::stack<", 20), ("std::basic_string<", 24), ("boost::shared_ptr<", 8)):
        if t.startswith(prefix):
            return size, 4
    unknown.add(t)
    return 4, 4


cache = {}


def layout(s):
    """(list of (offset, type, name, dims, size), size, align)"""
    k = norm(s.name)
    if k in cache:
        return cache[k]
    members = []
    off = 0
    align = 1
    for b in s.bases:
        bs = structs.get(norm(b))
        if bs is None:
            unknown.add(b)
            continue
        bm, bsz, bal = layout(bs)
        if bsz <= 1 and not bm:  # empty base: no room (EBCO)
            continue
        off = (off + bal - 1) // bal * bal
        for (o, ty, nm, dims, sz) in bm:
            members.append((off + o, ty, bs.name + "::" + nm if False else nm, dims, sz))
        off += bsz
        align = max(align, bal)
    if s.union:
        size = 0
        for (ty, nm, dims) in s.fields:
            sz, al = sizeof(ty)
            n = 1
            for d in dims:
                n *= d
            members.append((off, ty, nm, dims, sz * n))
            size = max(size, sz * n)
            align = max(align, al)
        total = (size + align - 1) // align * align
        cache[k] = (members, total, s.align_attr or align)
        return cache[k]
    for (ty, nm, dims) in s.fields:
        sz, al = sizeof(ty)
        n = 1
        for d in dims:
            n *= d
        off = (off + al - 1) // al * al
        members.append((off, ty, nm, dims, sz * n))
        off += sz * n
        align = max(align, al)
    if s.align_attr:
        align = max(align, s.align_attr)
    total = (off + align - 1) // align * align
    cache[k] = (members, total, align)
    return cache[k]


def get(name):
    s = structs.get(norm(name))
    if s is None:
        sys.exit("no struct " + name)
    return layout(s)


ANCHORS = [
    # (class, member, offset or None, size or None): from setters (`mov [ecx+OFF], eax`), constructors (`mov [esi+OFF], -1`) and operator new(size)
    ("CKTDGUIIMEEditBox", "m_CustomMsgEditBoxChange", 0x258, None),
    ("CKTDGUIIMEEditBox", "m_CustomMsgEditBoxFocusIn", 0x264, None),
    ("CKTDGUIIMEEditBox", "m_Buffer", 0x2BC, None),
    ("CKTDGUIIMEEditBox", None, None, 0x560),
    ("CKTDGUIUniBuffer", "m_nLengthLimit", 4, None),
    ("CKTDGUIUniBuffer", "m_ByteLimit", 0x24, None),
    ("CKTDGUIComboBox", None, None, 0x424),
    ("CKTDGUIListBox", None, None, 0x3DC),
    ("CKTDGUIEditBox", None, None, 0x4F8),
    ("CKTDGUISlider", None, None, 0x344),
    ("CKTDGUINavigation", None, None, 0x2D4),
    ("CKTDGUIContolList", None, None, 0x2A4),
    ("CKTDGUIItem", None, None, 0x2C4),
    ("CKTDGUIControl::CMovieData", None, None, 0x78),
]


def check():
    ok = True
    for (cls, member, off, size) in ANCHORS:
        members, total, _ = get(cls)
        if member:
            got = next((o for (o, ty, nm, dims, sz) in members if nm == member), None)
            good = got == off
            print(("ok   " if good else "FAIL ") + f"{cls}.{member} at {got and hex(got)} (expected {hex(off)})")
        else:
            good = total == size
            print(("ok   " if good else "FAIL ") + f"sizeof({cls}) = {hex(total)} (expected {hex(size)})")
        ok &= good
    return ok


def main():
    args = [a for a in sys.argv[1:]]
    if not args:
        sys.exit(__doc__)
    load()
    if "--check" in args:
        sys.exit(0 if check() else 1)
    lo = 0
    find = None
    names = []
    i = 0
    while i < len(args):
        if args[i] == "--from":
            lo = int(args[i + 1], 0)
            i += 2
        elif args[i] == "--find":
            find = int(args[i + 1], 0)
            i += 2
        else:
            names.append(args[i])
            i += 1
    for name in names:
        members, total, align = get(name)
        print(f"// {name}: size {hex(total)}, align {align}")
        for (o, ty, nm, dims, sz) in members:
            if find is not None:
                if o <= find < o + max(sz, 1):
                    print(f"0x{o:04X}  {ty} {nm}{''.join(f'[{d}]' for d in dims)}  ({sz} bytes)  +{find - o}")
            elif o >= lo:
                print(f"0x{o:04X}  {ty} {nm}{''.join(f'[{d}]' for d in dims)}  ({sz})")
    if unknown:
        print("// unknown types (taken as 4 bytes): " + ", ".join(sorted(unknown)), file=sys.stderr)


main()
