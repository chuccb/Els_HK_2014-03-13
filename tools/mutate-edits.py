#!/usr/bin/env python3
"""Mutation check of the input of the edit box (D2): the handlers of CKTDGUIEditBox in packages/ui/src/editbox.ts (HandleKeyboard, MsgProc, HandleMouse,
OnFocusOut, ContainPTForEditBox, CopyToClipboard, DeleteSelectionText, PasteFromClipboard, ClearText, their helpers, and PlaceCaret), the keyboard state of
the world (world.ts: getKeyState), the clipboard in memory (input.ts: MemoryClipboard) and the dialog position of a control (control.ts: dialogPos).  The
mutants are made from the source by operator, like those of imeeditbox.ts in tools/mutate-edit.py (every comparison, logical and arithmetic operator, number,
`!`, condition, `?:`, `.left` / ..., statement, one at a time), and by swaps that no operator makes: a `return true;` that becomes `return false;` and back, a
`m_nCaret` that is `m_nSelStart`, the change message that is the enter message, a control event that is a custom message, the next word that is the prior one,
a corner of the quad that is another.  Their names are the text of the line.  The test that runs for each is packages/ui/test/edits-input.test.ts, which
replays what the exe answered (tools/oracle-edits.py) and has the hand tests of the clipboard, the keyboard state and the box without a dialog.

    python3 tools/mutate-edits.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

The options, the exit code and the way the source is restored are those of tools/mutate-edit.py (this script loads it and replaces its list of mutants): a
mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed.  Commit first, or work in a copy.
"""
import importlib.util, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutate_edit', os.path.join(HERE, 'mutate-edit.py'))
me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(me)

EB, WO, IN, CT = 'editbox.ts', 'world.ts', 'input.ts', 'control.ts'
T = me.T
me.M.clear()
me.TIMEOUT.clear()
for _f in (EB, WO, IN, CT):
    me.TESTS[_f] = [T + 'edits-input.test.ts']
    me.TIMEOUT[_f] = 40  # the test takes 7 seconds; a mutant that loops for ever is a kill
# PlaceCaret has its own tests of what it asks the buffer (tools/mutate-edit.py): the mutants that no answer shows are killed there
me.TESTS[EB].append(T + 'editboxdraw.test.ts')

REGIONS = {
    EB: [('  PlaceCaret(nCP: number): void {', '\n  }\n'), ('  // ---- the input\n', '  /** `SetNormalTex_LUA(file, key)`')],
    WO: [('  getKeyState(vk: number): number {', '\n  }\n')],
    IN: [('export class MemoryClipboard', '\n}\n')],
    CT: [('  protected dialogPos()', '\n  }\n')],
}
# `operator_mutants` names a mutant after the last method it saw with a modifier it knows: `protected` is none of them
RENAME = {CT: 'dialogPos'}

WHY = {}


def add(name, why):
    WHY[name] = why


def src(f):
    return open(me.path_of(f)).read()


def swap_mutants(f, regions, patterns):
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
                    name = f'{RENAME.get(f, func)}: {hit.group()} -> {new} in `{snippet}`'
                    seen[name] = seen.get(name, 0) + 1
                    if seen[name] > 1:
                        name += f' (#{seen[name]})'
                    result.append((name, anchor, repl))
    return result


SWAPS = [
    (r'\breturn true;', ['return false;']),
    (r'\breturn false;', ['return true;']),
    (r'\bthis\.m_nCaret\b', ['this.m_nSelStart']),
    (r'\bthis\.m_nSelStart\b', ['this.m_nCaret']),
    (r'\bUIM\.CONTROL_EVENT\b', ['UIM.CUSTOM_MSG']),
    (r'\bUIM\.CUSTOM_MSG\b', ['UIM.CONTROL_EVENT']),
    (r'\bm_CustomMsgEditBoxChange\b', ['m_CustomMsgEditBoxEnter', 'm_CustomMsgEditBoxFocusOut']),
    (r'\bm_CustomMsgEditBoxEnter\b', ['m_CustomMsgEditBoxChange', 'm_CustomMsgEditBoxFocusOut']),
    (r'\bm_CustomMsgEditBoxFocusOut\b', ['m_CustomMsgEditBoxChange', 'm_CustomMsgEditBoxEnter']),
    (r'\bGetNextItemPos\b', ['GetPriorItemPos']),
    (r'\bGetPriorItemPos\b', ['GetNextItemPos']),
    (r'\b(?:leftTopPoint|rightTopPoint|leftBottomPoint|rightBottomPoint)\b', ['leftTopPoint', 'rightTopPoint', 'leftBottomPoint', 'rightBottomPoint']),
    (r'\bm_bEnable\b', ['m_bShow', 'm_bEnableInput']),
    (r'\bm_bEnableInput\b', ['m_bEnable', 'm_bShow']),
    (r'\bm_bShow\b', ['m_bEnable']),
    (r'\bm_bHasFocus\b', ['m_bMouseDrag']),
    (r'\bm_bMouseDrag\b', ['m_bHasFocus']),
    (r'\bm_nFirstVisible\b', ['m_nCaret']),
    (r'\bbuffer\.GetTextSize\(\)', ['0']),
]

MUTANTS = []
for _f, _regions in REGIONS.items():
    for _name, _a, _b in me.operator_mutants(_f, _regions):
        MUTANTS.append((_f, RENAME[_f] + _name[_name.index(':'):] if _f in RENAME else _name, _a, _b))
    for _name, _a, _b in swap_mutants(_f, _regions, SWAPS):
        MUTANTS.append((_f, _name, _a, _b))

# ---- the mutants that no input can tell from the original (name -> why)

COLLAPSED = ('equivalent: this runs after the selection was deleted or when there was none, and the selection start is the caret then (DeleteSelectionText puts it '
             'there: it is the caret)')
ELSE_BRANCH = 'equivalent: this is the branch of a box whose caret and selection start are the same, so one is as good as the other'
for _name in ('handleKeyboard: this.m_nCaret -> this.m_nSelStart in `} else if (buffer.RemoveChar(this.m_nCaret)) this.sendChange();`',
              'msgProc: this.m_nCaret -> this.m_nSelStart in `} else if (this.m_nCaret > 0) {`',
              'msgProc: this.m_nCaret -> this.m_nSelStart in `this.PlaceCaret(this.m_nCaret - 1);`'):
    add(_name, ELSE_BRANCH)
add('msgProc: this.m_nCaret -> this.m_nSelStart in `buffer.RemoveChar(this.m_nCaret);`', 'equivalent: the line before sets the selection start to the caret')
for _name in ('msgProc: this.m_nCaret -> this.m_nSelStart in `if (this.m_bInsertMode || this.m_nCaret >= buffer.GetTextSize()) moved =...`',
              'msgProc: this.m_nCaret -> this.m_nSelStart in `if (this.m_bInsertMode || this.m_nCaret >= buffer.GetTextSize()) moved =...` (#2)',
              'msgProc: this.m_nCaret -> this.m_nSelStart in `else buffer.setCharAt(this.m_nCaret, ch);`',
              'msgProc: this.m_nCaret -> this.m_nSelStart in `this.PlaceCaret(this.m_nCaret + 1);`',
              'PasteFromClipboard: this.m_nCaret -> this.m_nSelStart in `const caret = this.m_nCaret;`'):
    add(_name, COLLAPSED)
add('close: statement deleted in `busy = false;`', 'equivalent: the property is never set to anything else, and a property that was never set reads as undefined, which is as false as false is (only `if (this.busy)` reads it)')

for _f, _name, _a, _b in MUTANTS:
    me.m(_f, _name, _a, _b, WHY.get(_name, ''))
for _name in WHY:
    assert any(mu[1] == _name for mu in me.M), f'a reason for a mutant that does not exist: {_name}'

if __name__ == '__main__':
    sys.exit(me.main())
