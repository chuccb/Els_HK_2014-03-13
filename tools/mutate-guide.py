#!/usr/bin/env python3
"""Mutation check of the guide text and the fade-in of a dialog (unit 6b): the end of the constructor of CKTDGUIDialog in packages/ui/src/dialog.ts (the
`fMoveTime > 0` block, 32954EF0), `createGuideDesc` (32956BD0) and `showGuideDesc` (3295BA30), the size of the back buffer that `showGuideDesc` reads
(`UIRender.setBackBufferSize` in render.ts, `backBufferWidth` in pick.ts).  The mutants are made from the source by operator, like those of
tools/mutate-edit.py (every comparison, logical and arithmetic operator, number, `!`, condition, `?:`, statement, one at a time), and by swaps no operator
makes: an x that is a y, the width that is the height, the scale of the width that is the scale of the height, the goal that is the place, the colour that
is the goal colour, a red that is a green.  Their names are the text of the line.  The test that runs for each is packages/ui/test/guide.test.ts, whose
every number is worked out from the decompile and the disassembly of the exe (there is no oracle for it: the function builds a dialog from a script).

    python3 tools/mutate-guide.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

The options, the exit code and the way the source is restored are those of tools/mutate-edit.py (this script loads it and replaces its list of mutants): a
mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed.  Commit first, or work in a copy.
"""
import importlib.util, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutate_edit', os.path.join(HERE, 'mutate-edit.py'))
me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(me)

DL, RE, PK = 'dialog.ts', 'render.ts', 'pick.ts'
T = me.T
me.M.clear()
me.TIMEOUT.clear()
for _f in (DL, RE, PK):
    me.TESTS[_f] = [T + 'guide.test.ts']
    me.TIMEOUT[_f] = 30  # the test takes a second; a mutant that loops for ever is a kill

# (the name of the method the region is, first marker, last marker)
REGIONS = {
    DL: [('constructor', '    const fMoveTime = f(opts.moveTime ?? 0);', '\n  }\n'),
         (None, '  createGuideDesc(): void {', '\n  }\n'),
         (None, '  showGuideDesc(control: CKTDGUIControl): void {', '\n  }\n')],
    RE: [('setBackBufferSize', '    this.backBuffer.width = width;', '\n  }\n')],
    PK: [('backBufferWidth', 'export function backBufferWidth(ctx: UIContext): number {', '\n}\n')],
}

WHY = {}


def add(name, why):
    WHY[name] = why


def src(f):
    return open(me.path_of(f)).read()


def swap_mutants(f, regions, patterns, rename=None):
    """[(name, anchor, replacement)]: in the code of the file between each pair of markers, every match of a pattern of `patterns` ([(regex, [new text])]) is
    replaced, one at a time; the anchor is the line, with the lines before it while it is not unique"""
    text = src(f)
    lines = text.split('\n')
    pos = [0]
    for ln in lines:
        pos.append(pos[-1] + len(ln) + 1)
    spans = []
    for first, last in regions:
        a = text.index(first)
        b = text.index(last, a + len(first)) + (len(last) if last.endswith('\n') else 0)
        spans.append((a, b))
    result, seen, func = [], {}, ''
    for n, line in enumerate(lines):
        mo = re.match(r'  (?:private |override |static |protected )*(\w+)\(', line)
        if mo:
            func = mo.group(1)
        if not any(a <= pos[n] < b for a, b in spans):
            continue
        st = line.strip()
        if not st or st.startswith(('*', '/*', '//')):
            continue
        code = line.split(' // ')[0]  # a trailing comment is no code
        for regex, news in patterns:
            for hit in re.finditer(regex, code):
                if re.search(r'\b(?:const|let)\s+$', line[:hit.start()]) or re.match(r'\s*(?:const|let) \{', line):
                    continue  # the name a declaration makes: a swap there is no program
                for new in news:
                    if hit.group() == new:
                        continue
                    changed = line[:hit.start()] + new + line[hit.end():]
                    k, anchor, repl = 0, line, changed
                    while text.count(anchor) != 1 and n - k > 0:
                        k += 1
                        anchor = '\n'.join(lines[n - k:n + 1])
                        repl = '\n'.join(lines[n - k:n] + [changed])
                    if text.count(anchor) != 1:
                        raise SystemExit(f'no unique anchor for line {n + 1}: {st}')
                    snippet = ' '.join(st.split())
                    snippet = snippet if len(snippet) <= 72 else snippet[:72] + '...'
                    name = f'{rename or func}: {hit.group()} -> {new} in `{snippet}`'
                    seen[name] = seen.get(name, 0) + 1
                    if seen[name] > 1:
                        name += f' (#{seen[name]})'
                    result.append((name, anchor, repl))
    return result


# a name that is a whole word and no property (`.x` is one), and is not what an assignment or a declaration writes to (a swap there is no program)
def W(word):
    return r'(?<![.\w])' + word + r'(?![\w])(?!\s*=[^=])'


SWAPS = [
    (r'\bthis\.m_Pos\.x\b', ['this.m_Pos.y']),
    (r'\bthis\.m_Pos\.y\b', ['this.m_Pos.x']),
    (r'\bguide\.m_Pos\.set\(x, y\)', ['guide.m_Pos.set(y, x)']),
    (r'\bscale\.x\b', ['scale.y']),
    (r'\bscale\.y\b', ['scale.x']),
    (r'\bcontrol\.m_OffsetPos\.x\b', ['control.m_OffsetPos.y']),
    (r'\bcontrol\.m_OffsetPos\.y\b', ['control.m_OffsetPos.x']),
    (r'\bcontrol\.getGuideDescPos\(\)\.x\b', ['control.getGuideDescPos().y']),
    (r'\bcontrol\.getGuideDescPos\(\)\.y\b', ['control.getGuideDescPos().x']),
    (r'\bfont\.GetWidth\b', ['font.GetHeight']),
    (r'\bfont\.GetHeight\b', ['font.GetWidth']),
    (r'\bm_GoalPos\b', ['m_Pos']),
    (r'\bm_GoalColor\b', ['m_Color']),
    (r'\bm_Color\b', ['m_GoalColor']),
    (r'\bm_fAnimateTime\b', ['m_fChangeTime']),
    (r'\bm_fChangeTime\b', ['m_fAnimateTime']),
    (r'\bm_pDialogGuideDesc\b', ['m_pStaticGuideDesc']),
    (W('px'), ['py']),
    (W('py'), ['px']),
    (W('ox'), ['oy']),
    (W('oy'), ['ox']),
    (W('x0'), ['y0']),
    (W('y0'), ['x0']),
    (W('width'), ['height', 'boxHeight']),
    (W('height'), ['width']),
    (W('boxHeight'), ['height']),
    (W('w'), ['f(boxHeight)']),
    (W('r'), ['g']),
    (W('g'), ['b']),
    (W('b'), ['r']),
    (r'\.setOffsetPos\(', ['.SetOffsetPos(']),
    (r'\bstat\.SetShow\(true\)', ['stat.SetShow(false)']),
    (r'\bguide\.setShow\(true\)', ['guide.setShow(false)']),
    (r'\bfound\.SetShow\(false\)', ['found.SetShow(true)']),
    (r'\bGetPicture\(0\)', ['GetPicture(1)']),
    (r'\bGetString\(0\)', ['GetString(1)']),
    (r'\bgetUKFont\(2\)', ['getUKFont(1)', 'getUKFont(3)']),
    (r'\bthis\.backBuffer\.width\b', ['this.backBuffer.height']),
    (r'\bthis\.backBuffer\.height\b', ['this.backBuffer.width']),
    (r'\bbackBuffer\.width\b', ['backBuffer.height']),
    (r'\bwidth\b(?= *;)', ['height']),
    (r'\bheight\b(?= *;)', ['width']),
    (r'\bcode === 10\b', ['code === 13']),
    (r'charCodeAt\(i\) === 10', ['charCodeAt(i) === 13']),
]

MUTANTS = []
for _f, _regions in REGIONS.items():
    for _rename, _first, _last in _regions:
        for _name, _a, _b in me.operator_mutants(_f, [(_first, _last)]):
            MUTANTS.append((_f, _rename + _name[_name.index(':'):] if _rename else _name, _a, _b))
        for _name, _a, _b in swap_mutants(_f, [(_first, _last)], SWAPS, _rename):
            MUTANTS.append((_f, _name, _a, _b))

# ---- the mutants that no input can tell from the original (name -> why)

add('showGuideDesc: < -> <= in `else if (f(w + x) < f(screenW)) px = ftoi(x);`',
    'equivalent: the two sides are equal only for an x that is a whole number (the width and the screen are), and then (int)x is the screen less the width, which is the other branch')

for _f, _name, _a, _b in MUTANTS:
    me.m(_f, _name, _a, _b, WHY.get(_name, ''))
for _name in WHY:
    assert any(mu[1] == _name for mu in me.M), f'a reason for a mutant that does not exist: {_name}'

if __name__ == '__main__':
    sys.exit(me.main())
