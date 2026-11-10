#!/usr/bin/env python3
"""Mutation check of the line map of packages/world (`CKTDGLineMap`: linemap.ts, its data types: linedata.ts, and the ordered map of the start positions: intmap.ts).
One small change at a time is applied to a source file of packages/world/src, the tests of the line map are run and the script reports whether a test notices
(killed) or not (SURVIVED).  The mutants are made from the source by operator, like those of tools/mutate-edit.py (every comparison, logical and arithmetic
operator, number, `!`, condition, `?:`, statement, one at a time; their names are the text of the line), and by swaps no operator makes: a key of a script's
table read as another type (`getInt` for `getFloat` for `getBool`), a default of `true` for `false`, a key that is not the one the script wrote, the wrong end
of a pair (before / next, x / y, the camera's eye / look-at).

    python3 tools/mutate-linemap.py [--list] [--check] [--survivors=LOG] [--shard=K/N] [substring of a mutant name ...]

The options, the exit code and the way the source is restored are those of tools/mutate-edit.py (this script loads it and replaces its list of mutants): a
mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed.  Commit first, or work in a copy.  The tests that
run for a mutant are the unit tests of packages/world/test (0.5 s) and, for a mutant they do not kill, the census of the 523 scripts of the game too (3 s).
"""
import importlib.util, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutate_edit', os.path.join(HERE, 'mutate-edit.py'))
me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(me)

me.SRC = 'packages/world/src/'
LM, LD, IM = 'linemap.ts', 'linedata.ts', 'intmap.ts'
T = 'packages/world/test/'
# the names of the mutants say the method they are in: a method may be `private` or `override`, and a function of the file is `function name(`
me.FUNC_RE = re.compile(r'(?:  (?:private |override |static |async |get )*|(?:export )?function )(\w+)(?:<\w+>)?\(')
me.M.clear()
me.TESTS.clear()
me.TIMEOUT.clear()
me.QUICK.clear()
for _f in (LM, LD, IM):
    me.TESTS[_f] = [T + 'linemap.test.ts', T + 'intmap.test.ts', T + 'census.test.ts']
    # the unit tests first: the census (all the 523 scripts of the game) only runs for a mutant that they do not kill
    me.QUICK[_f] = lambda name: '^(?!the line-map scripts)'
    me.TIMEOUT[_f] = 40  # the tests take 4 s; a mutant that loops for ever is a kill

# (the name of the method the region is, first marker, last marker); the constants at the top of linemap.ts are mutated by hand below
METHOD_END = '\n  }\n'
REGIONS = [
    ('SetLandHeight', '  SetLandHeight(fLandHeight: number): void {', METHOD_END),
    ('SetTeamStartPos', '  SetTeamStartPos(bRed: boolean', METHOD_END),
    ('AddStartPos', '  AddStartPos(key: number', METHOD_END),
    ('AddCameraData_LUA', '  AddCameraData_LUA(): boolean {', METHOD_END),
    ('AddLine_LUA', '  AddLine_LUA(): boolean {', METHOD_END),
    ('takeInBounds', '  private takeInBounds(line: LineData): void {', METHOD_END),
    ('AddLineAnim_LUA', '  AddLineAnim_LUA(): boolean {', METHOD_END),
    ('AddTrigger_LUA', '  AddTrigger_LUA(): boolean {', METHOD_END),
    ('EnableLineData_LUA', '  EnableLineData_LUA(iIndex: number', METHOD_END),
    ('SetStartEndPosAtThisLineMap_LUA', '  SetStartEndPosAtThisLineMap_LUA(iIndex: number', METHOD_END),
    ('GetNumLineData_LUA', '  GetNumLineData_LUA(): number {', METHOD_END),
    ('GetStartPosition', '  GetStartPosition(key: number): Vec3 {', METHOD_END),
    ('GetStartLineIndex', '  GetStartLineIndex(key: number): number {', METHOD_END),
    ('enableLineData', '  enableLineData(iIndex: number', METHOD_END),
    ('updateLineData', '  updateLineData(iIndex: number', METHOD_END),
    ('makeLine', '  makeLine(line: LineData): void {', METHOD_END),
    ('reBuildLineGroup', '  reBuildLineGroup(): void {', METHOD_END),
    ('loadLineMap', '  loadLineMap(fileName: string): boolean {', METHOD_END),
    ('sortTriggerSegments', 'export function sortTriggerSegments(segments: TriggerSegment[]): void {', '\n}\n'),
    ('readTriggerMesh', 'function readTriggerMesh(m: KLuaManager): TriggerDataMesh {', '\n}\n'),
    ('readTriggerLine', 'function readTriggerLine(m: KLuaManager): TriggerDataLine {', '\n}\n'),
    ('readTriggerEtc', 'function readTriggerEtc(m: KLuaManager): TriggerDataEtc {', '\n}\n'),
]
OTHER_REGIONS = [
    (LD, 'LineData', 'export class LineData {', '\n}\n'),
    (LD, 'StartInfo', 'export class StartInfo {', '\n}\n'),
    (LD, 'CameraData', 'export class CameraData {', '\n}\n'),
    (IM, 'IntMap', 'export class IntMap<V>', '\n}\n'),
]

WHY = {}


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
    result, seen = [], {}
    for n, line in enumerate(lines):
        if not any(a <= pos[n] < b for a, b in spans):
            continue
        st = line.strip()
        if not st or st.startswith(('*', '/*', '//')):
            continue
        code = line.split(' // ')[0]  # a trailing comment is no code
        for regex, news in patterns:
            for hit in re.finditer(regex, code):
                for new in news(hit) if callable(news) else news:
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
                    name = f'{rename}: {hit.group()} -> {new} in `{snippet}`'
                    seen[name] = seen.get(name, 0) + 1
                    if seen[name] > 1:
                        name += f' (#{seen[name]})'
                    result.append((name, anchor, repl))
    return result


SWAPS = [
    # a default that is the other boolean
    (r'\?\? true\b', ['?? false']),
    (r'\?\? false\b', ['?? true']),
    # a number read as another type of number (an int is cut, a float is rounded to a float32, a bool is an int that is not 0)
    (r'm\.getInt\(', ['m.getFloat(', 'm.getBool(']),
    (r'm\.getFloat\(', ['m.getInt(']),
    (r'm\.getBool\(', ['m.getInt(']),
    (r'm\.getString\(', ['m.getInt(']),
    # a key that is not the one the script writes
    (r'(m\.get(?:Int|Float|Bool|String|Vec3)\()(")(\w+)(?=")', lambda hit: ['%s%s%sX' % (hit.group(1), hit.group(2), hit.group(3))]),
    (r'(m\.beginTable\()(`)(\w+)(?=\$)', lambda hit: ['%s%s%sX' % (hit.group(1), hit.group(2), hit.group(3))]),
    # the wrong end of a pair
    (r'line\.beforeLine = ', ['line.nextLine = ']),
    (r'line\.nextLine = ', ['line.beforeLine = ']),
    (r'm_vJumpSpeed\.x = ', ['m_vJumpSpeed.y = ']),
    (r'm_vJumpSpeed\.y = ', ['m_vJumpSpeed.x = ']),
    (r'm_vEye\.', ['m_vLookAt.']),
    (r'm_vLookAt\.', ['m_vEye.']),
    (r'm_vecRedTeamStartInfo', ['m_vecBlueTeamStartInfo']),
    (r'm_vecBlueTeamStartInfo', ['m_vecRedTeamStartInfo']),
    (r'line\.startPos', ['line.endPos']),
    (r'line\.endPos', ['line.startPos']),
    (r'm_iStartLineIndex', ['m_iEndLineIndex']),
    (r'm_iEndLineIndex', ['m_iStartLineIndex']),
    (r'taken\[(\w+)\] = 1', ['taken[\\1] = 0']),
    (r'LT\.WALL', ['LT.BUNGEE']),
    (r'LT\.BUNGEE', ['LT.WALL']),
    (r'LCT\.RELATIE_POSITION', ['LCT.ABSOULTE_POSITION']),
    (r'LCT\.ABSOULTE_POSITION', ['LCT.RELATIE_POSITION']),
    (r'fail\(0x48', ['fail(0x49']),
    (r'fail\(0x49', ['fail(0x48']),
    (r'log\.push\(0x14', ['log.push(0x48']),
    (r'minss\(', ['maxss(']),
    (r'maxss\(', ['minss(']),
]

MUTANTS = []
for _rename, _first, _last in REGIONS:
    for _name, _a, _b in me.operator_mutants(LM, [(_first, _last)]):
        MUTANTS.append((LM, _name, _a, _b))
    for _name, _a, _b in swap_mutants(LM, [(_first, _last)], SWAPS, _rename):
        MUTANTS.append((LM, _name, _a, _b))
for _f, _rename, _first, _last in OTHER_REGIONS:
    for _name, _a, _b in me.operator_mutants(_f, [(_first, _last)]):
        # (a field of a class has no function to name it: the class does)
        MUTANTS.append((_f, _rename + _name if _name.startswith(':') else f'{_rename}.{_name}', _a, _b))

# ---- hand-made mutants (the lines the generators do not reach)
HAND = [
    (LM, 'constants: RAD_TO_DEG is 180 / pi as a double', 'const RAD_TO_DEG = 57.2957763671875;', 'const RAD_TO_DEG = 57.29577951308232;'),
    (LM, 'constants: minss / maxss answer the first operand when the two are equal', 'const minss = (a: number, b: number): number => (a < b ? a : b);',
     'const minss = (a: number, b: number): number => (a <= b ? a : b);'),
    (LM, 'constants: maxss answers the first operand when the two are equal', 'const maxss = (a: number, b: number): number => (a > b ? a : b);',
     'const maxss = (a: number, b: number): number => (a >= b ? a : b);'),
    (LM, 'constants: the stale matrix is not zeros', 'const STALE_MATRIX = new Float32Array(16);', 'const STALE_MATRIX = new Float32Array(16).fill(1);'),
]
for _f, _name, _a, _b in HAND:
    MUTANTS.append((_f, _name, _a, _b))

# ---- the mutants that no input can tell from the original (the reason, and how many mutants the pattern of their names must find)


def why(pattern, reason, count):
    hits = [name for _f, name, _a, _b in MUTANTS if re.search(pattern, name)]
    assert len(hits) == count, f'{pattern}: {len(hits)} mutants, not {count}: {hits}'
    for name in hits:
        WHY[name] = reason


why(r'^takeInBounds: statement deleted in `this\.m_fYMax = y;`$',
    'a dead store: the last statement of the method writes m_fYMax again, from the same `y` (the exe keeps it in a register)', 1)
why(r'^makeLine: 1 -> 2 in `const inverse = matInverse',
    'LookAt normalises (up x dir): with up = (0,2,0) the cross product is exactly twice as long and the normalised x axis is the same, bit for bit (a factor of 2 '
    'is exact in a double, and the D3DX math of the port works in doubles)', 1)
why(r'^makeLine: 1 -> [02] in `if \(I\[1\] === 0 && I\[5\] === 0\)',
    'only a matrix of zeros (a line without a D3DX inverse) takes this branch (the test "a line has an inverse unless ..." runs 20,007 directions): '
    'the entry that is read instead of _12 is 0 in it, and in every other matrix _22 is not 0 whatever that entry is', 2)
why(r'^makeLine: (6 -> [57]|2 -> [13]) in `radX = f\(Math\.atan2',
    'that branch is only taken with a matrix of zeros (see the mutants of its condition): every entry is 0, so atan2(-0, 0) = -0 whichever two are read', 4)
why(r'^makeLine: \* -> / in `degX = f\(radX \* RAD_TO_DEG\);`$',
    'that branch is only taken with a matrix of zeros: radX is -0 and -0 times or over 57.29 is -0', 1)
why(r'^reBuildLineGroup: (condition false|<= -> <) in `if \(n <= 0\) return;`$',
    'with no line no loop runs (tools/equiv-linegroup.ts: the groups of 28.5 million sets of lines are the same without the line)', 2)
why(r'^reBuildLineGroup: (>= -> >|0 -> 1) in `for \(let prev = line\.beforeLine; prev >= 0 && prev < n && taken\[prev\] ==\.\.\.`$',
    'a back link to line 0 is never followed: line 0 is the first start line and its forward walk has taken every line that links back to it '
    '(tools/equiv-linegroup.ts: the same groups for 28.5 million sets of lines)', 2)
why(r'^reBuildLineGroup: < -> <= in `for \(let (next|prev) = line\.(next|before)Line; (next|prev) >= 0 && (next|prev) < n && taken\[(next|prev)\] ==*',
    'taken[n] is undefined, not 0: the loop ends where `< n` ends it (tools/equiv-linegroup.ts: the same groups for 28.5 million sets of lines)', 2)
why(r'^readTriggerLine: -1 -> 0 in `m_iTriggerLineIndex: -1,`$',
    'the initial value is written again, from LINE_ID, before the entry is used', 1)
why(r'^readTrigger(Line|Etc): 0 -> 1 in `m_fTriggerTime: 0,`$',
    'the initial value is written again, from DELAY_TIME, before the entry is used', 2)
why(r'^readTriggerEtc: statement deleted in `break;` \(#3\)$',
    'the break of the last case: nothing follows it', 1)
why(r'^IntMap\.clear: (0 -> 1|statement deleted) in `this\.values\.length = 0;`$',
    'the values past the last key are never read: every read goes through a position of `keys`', 2)

for _f, _name, _a, _b in MUTANTS:
    me.m(_f, _name, _a, _b, WHY.get(_name, ''))
for _name in WHY:
    assert any(mu[1] == _name for mu in me.M), f'a reason for a mutant that does not exist: {_name}'

if __name__ == '__main__':
    sys.exit(me.main())
