#!/usr/bin/env python3
"""Mutation check of the device reset of the dialogs and of the end of the dialog manager (unit "manager device reset"): `OnLostDevice` /
`OnResetDevice` of the manager (328E09A0 / 328E0A40) and of the dialog (3295A480 / 3295A610), the base control's two no-ops (32840850), the manager's
destructor `Destroy` (328DD8A0), `ImeSystem.uninitialize` (`CKTDGUIIMEEditBox::Uninitialize`, 3293B4B0) and `DummyImmHost`, the host that holds the dummies of
`imm32.dll`'s table after it.  The mutants are made from the source by operator, like those of tools/mutate-edit.py (every comparison, logical and
arithmetic operator, number, `!`, condition, `?:`, statement, one at a time), and by swaps no operator makes: the wrong one of the two device calls, the
wrong one of the two font maps, the wrong control type, the wrong global, the answer of a dummy that is another value, a call of the platform that is not
passed on or passed on with other arguments.  Their names are the text of the line.  The test that runs for each is packages/ui/test/devicelost.test.ts,
whose every number is worked out from the decompile and the disassembly of the exe (there is no oracle for it: the functions walk the dialogs of a world).

    python3 tools/mutate-devicelost.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

The options, the exit code and the way the source is restored are those of tools/mutate-edit.py (this script loads it and replaces its list of mutants): a
mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed.  Commit first, or work in a copy.
"""
import importlib.util, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutate_edit', os.path.join(HERE, 'mutate-edit.py'))
me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(me)

DM, DL, CT, IM, IH = 'dialogmanager.ts', 'dialog.ts', 'control.ts', 'imeeditbox.ts', 'imehost.ts'
T = me.T
me.M.clear()
me.TIMEOUT.clear()
for _f in (DM, DL, CT, IM, IH):
    me.TESTS[_f] = [T + 'devicelost.test.ts']
    me.TIMEOUT[_f] = 30  # the test takes a second; a mutant that loops for ever is a kill

# (the name of the method the region is, first marker, last marker)
REGIONS = {
    DM: [(None, '  onLostDevice(): number {', '\n  }\n'), (None, '  onResetDevice(): number {', '\n  }\n'), (None, '  Destroy(): void {', '\n  }\n')],
    DL: [(None, '  onLostDevice(): number {', '\n  }\n'), (None, '  onResetDevice(): number {', '\n  }\n')],
    CT: [(None, '  onResetDevice(): number {', '\n  }\n'), (None, '  onLostDevice(): number {', '\n  }\n')],
    IM: [(None, '  uninitialize(): void {', '\n  }\n')],
    IH: [(None, 'export class DummyImmHost implements ImeHost {', '\n}\n')],
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
        mo = me.FUNC_RE.match(line)
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
                    name = f'{rename or func}: {hit.group()} -> {new} in `{snippet}`'
                    seen[name] = seen.get(name, 0) + 1
                    if seen[name] > 1:
                        name += f' (#{seen[name]})'
                    result.append((name, anchor, repl))
    return result


# what a passed-on call of `DummyImmHost` is replaced with: the answer of something that was not asked (name -> text of the return)
NEUTRAL = {
    'getKeyboardLayout': '0', 'getAsyncKeyState': '0', 'getFocus': '0', 'getKeyboardLayoutCount': '0', 'getKeyboardLayoutList': '[]',
    'getLocaleAbbreviation': '""', 'getLocaleLanguage': 'null',
}


def passed_on(hit):
    """the replacements of `return this.platform.NAME(ARGS);`: another answer, other arguments"""
    name, args = hit.group(1), hit.group(2)
    news = ['return ' + NEUTRAL[name] + ';']
    parts = [a.strip() for a in args.split(',')] if args.strip() else []
    if len(parts) == 1:
        news.append(f'return this.platform.{name}(0);')
    return news


def passed_on_void(hit):
    """the replacements of `{ this.platform.NAME(ARGS); }` (a call with no answer): not called, called with the first two arguments swapped"""
    name, args = hit.group(1), hit.group(2)
    news = ['{ }']
    parts = [a.strip() for a in args.split(',')]
    if len(parts) >= 2:
        news.append('{ this.platform.' + name + '(' + ', '.join([parts[1], parts[0]] + parts[2:]) + '); }')
    return news


SWAPS = [
    # the two device calls: the wrong one
    (r'\?\.onLostDevice\(\)', ['?.onResetDevice()']),
    (r'\?\.onResetDevice\(\)', ['?.onLostDevice()']),
    (r'\bdialog\.onLostDevice\(\)', ['dialog.onResetDevice()']),
    (r'\bdialog\.onResetDevice\(\)', ['dialog.onLostDevice()']),
    # the control types of the second pass: the neighbours of 8, 9 and 12
    (r'\bUCT\.COMBOBOX\b', ['UCT.LISTBOX', 'UCT.SCROLLBAR']),
    (r'\bUCT\.LISTBOX\b', ['UCT.COMBOBOX', 'UCT.SLIDER']),
    (r'\bUCT\.CONTROLLIST\b', ['UCT.SLOT', 'UCT.NAVIGATION']),
    (r'\bcontrol\.m_ControlType\b', ['control.m_bShow']),
    (r'\.updateRects\(\)', ['.updateThumbRect()']),
    # the destructor: the wrong map, the wrong walk, the wrong global, the wrong class, the wrong container
    (r'\bm_mapUKFontList\b', ['m_mapFontToUKFont']),
    (r'\bm_mapFontToUKFont\b', ['m_mapUKFontList']),
    (r'\bm_vecIterator\b', ['m_vecReverseIterator']),
    (r'\bm_vecReverseIterator\b', ['m_vecIterator']),
    (r'"g_pDialogManager"', ['"g_pDGManager"']),
    (r'"CKTDGUIDialogManager"', ['"CKTDGUIDialog"']),
    (r'setObject\("g_pDialogManager", this,', ['setObject("g_pDialogManager", this.ctx.dialogManager,']),
    (r'\bthis\.ctx\.ime\b', ['this.ctx.ime.host']),
    (r'\bthis\.ctx\.fonts\b', ['this.ctx']),
    (r'\bm_mapDialog\b', ['m_setDialog']),
    (r'\bm_mapDialogListChangeCountWhenLastGetDialog\b', ['m_mapDialog']),
    (r'this\.m_listDialog', ['this.m_mapDialog']),
    # the dialog's walks: the list that is walked
    (r'of this\.m_ControlsList\b', ['of this.m_ControlsList.slice(1)', 'of this.m_ControlsList.slice(0, -1)']),
    (r'\bthis\.walkForward\b', ['this.walkBackwardPlain']),
    # uninitialize: the flag, the wrapper
    (r'this\.immLoaded = false', ['this.immLoaded = true']),
    (r'new DummyImmHost\(this\.host\)', ['new NoImeHost()', 'this.host']),
    # the host of the dummies
    (r'return false;', ['return true;']),
    (r'return null;', ['return { conversion: 0, sentence: 0 };']),
    (r'return "";', ['return "X";']),
    (r'return 0;', ['return -1;']),
    (r'return this\.platform\.(\w+)\(([^)]*)\);', passed_on),
    (r'\{ this\.platform\.(\w+)\(([^)]*)\); \}', passed_on_void),
    (r'\{ result: -2, data: new Uint8Array\(0\) \}', ['{ result: 0, data: new Uint8Array(0) }', '{ result: -1, data: new Uint8Array(0) }']),
    (r'\{ result: 0, data: new Uint8Array\(0\) \}', ['{ result: -2, data: new Uint8Array(0) }']),
]

MUTANTS = []
for _f, _regions in REGIONS.items():
    for _rename, _first, _last in _regions:
        for _name, _a, _b in me.operator_mutants(_f, [(_first, _last)]):
            MUTANTS.append((_f, _name, _a, _b))
        for _name, _a, _b in swap_mutants(_f, [(_first, _last)], SWAPS, _rename):
            MUTANTS.append((_f, _name, _a, _b))

# ---- hand-made mutants (the lines the generators do not reach: a loop that is a statement, the initial value of a flag, the order of the destructor)
HAND = [
    (DL, 'onLostDevice: the loop body is not run', 'for (const control of this.m_ControlsList) control?.onLostDevice();',
     'for (const control of this.m_ControlsList) void control;'),
    (DL, 'onResetDevice: the first pass is not run', 'for (const control of this.m_ControlsList) control?.onResetDevice();',
     'for (const control of this.m_ControlsList) void control;'),
    (DL, 'onResetDevice: the second pass is not run (no rectangles)', '    for (const control of this.m_ControlsList) {\n      if (control && (',
     '    for (const control of this.m_ControlsList.slice(0, 0)) {\n      if (control && ('),
    (DL, 'onResetDevice: the second pass stops after the first control', '    for (const control of this.m_ControlsList) {\n      if (control && (',
     '    for (const control of this.m_ControlsList.slice(0, 1)) {\n      if (control && ('),
    (DL, 'onResetDevice: every control gets the second pass (no type test)',
     'if (control && (control.m_ControlType === UCT.COMBOBOX || control.m_ControlType === UCT.LISTBOX || control.m_ControlType === UCT.CONTROLLIST)) {',
     'if (control && typeof (control as { updateRects?: unknown }).updateRects === "function") {'),
    (DM, 'Destroy: the fonts go before the dialogs', '    this.clearAllDlg();\n    this.ctx.fonts.m_mapUKFontList.clear();\n    this.ctx.fonts.m_mapFontToUKFont.clear();',
     '    this.ctx.fonts.m_mapUKFontList.clear();\n    this.ctx.fonts.m_mapFontToUKFont.clear();\n    this.clearAllDlg();'),
    (DM, 'Destroy: the global is set before the dialogs',
     '    this.clearAllDlg();\n    this.ctx.fonts.m_mapUKFontList.clear();',
     '    this.ctx.world.rt.setObject("g_pDialogManager", this, "CKTDGUIDialogManager");\n    this.clearAllDlg();\n    this.ctx.fonts.m_mapUKFontList.clear();'),
    (DM, 'Destroy: the IME is let go before the dialogs',
     '    this.clearAllDlg();\n    this.ctx.fonts.m_mapUKFontList.clear();',
     '    this.ctx.ime.uninitialize();\n    this.clearAllDlg();\n    this.ctx.fonts.m_mapUKFontList.clear();'),
    (DM, 'Destroy: the dialogs are cleared last',
     '    this.clearAllDlg();\n    this.ctx.fonts.m_mapUKFontList.clear();\n    this.ctx.fonts.m_mapFontToUKFont.clear();\n    this.ctx.world.rt.setObject("g_pDialogManager", this, "CKTDGUIDialogManager");\n    this.ctx.ime.uninitialize();\n    this.m_mapDialogListChangeCountWhenLastGetDialog.clear();\n    this.m_vecReverseIterator.length = 0;\n    this.m_vecIterator.length = 0;\n    this.m_mapDialog.clear();\n',
     '    this.ctx.fonts.m_mapUKFontList.clear();\n    this.ctx.fonts.m_mapFontToUKFont.clear();\n    this.ctx.world.rt.setObject("g_pDialogManager", this, "CKTDGUIDialogManager");\n    this.ctx.ime.uninitialize();\n    this.m_mapDialogListChangeCountWhenLastGetDialog.clear();\n    this.m_vecReverseIterator.length = 0;\n    this.m_vecIterator.length = 0;\n    this.m_mapDialog.clear();\n    this.clearAllDlg();\n'),
    (IM, 'ImeSystem: the imm32 table is not loaded to start with', 'private immLoaded = true;', 'private immLoaded = false;'),
    (IM, 'uninitialize: Initialize is made to load again', '    this.immLoaded = false;\n    this.host = new DummyImmHost(this.host);',
     '    this.immLoaded = false;\n    this.s_bInitialised = false;\n    this.host = new DummyImmHost(this.host);'),
    (IM, 'uninitialize: the flag of Initialize is set', '    this.immLoaded = false;\n    this.host = new DummyImmHost(this.host);',
     '    this.immLoaded = false;\n    this.s_bInitialised = true;\n    this.host = new DummyImmHost(this.host);'),
    (IM, 'uninitialize: a new platform host is wrapped again at the next call', '    if (!this.immLoaded) return;\n    this.immLoaded = false;',
     '    if (!this.immLoaded && this.host instanceof DummyImmHost) return;\n    this.immLoaded = false;'),
]
for _f, _name, _a, _b in HAND:
    MUTANTS.append((_f, _name, _a, _b))

# ---- the mutants that no input can tell from the original (name -> why)

for _f, _name, _a, _b in MUTANTS:
    me.m(_f, _name, _a, _b, WHY.get(_name, ''))
for _name in WHY:
    assert any(mu[1] == _name for mu in me.M), f'a reason for a mutant that does not exist: {_name}'

if __name__ == '__main__':
    sys.exit(me.main())
