#!/usr/bin/env python3
"""Mutation check of the input of the IME edit box (D3): the handlers of CKTDGUIIMEEditBox in packages/ui/src/imeeditbox.ts (HandleKeyboard, MsgProc and
EBProc, HandleMouse with the clicks on the IME's windows, OnFocusIn, OnFocusOut, ClearText, DeleteSelectionText, CopyToClipboard, PasteFromClipboard,
GetNowText, SendKey, SendCompString, IsKorean, GetPrev/NextIMEEditBox, their helpers, and PlaceCaret) and `ImeSystem.checkToggleState`.  The mutants are made
from the source by operator, like those of the drawing in tools/mutate-edit.py (every comparison, logical and arithmetic operator, number, `!`, condition,
`?:`, `.left` / `.x` / ..., statement, one at a time), and by swaps that no operator makes: a `return true;` that becomes `return false;` and back, a
`m_nCaret` that is `m_nSelStart`, the change message that is the enter message, a control event that is a custom message, the last key-down of Alt that
is Ctrl's, the composition caret that is the first target clause, the vertical candidate list that is the Chinese IME.  Their names are the text of the
line.  The tests that run for each are packages/ui/test/ime-input.test.ts, which replays what the exe answered (tools/oracle-ime.py), and
packages/ui/test/imeeditbox.test.ts (the hand tests).

    python3 tools/mutate-ime.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

The options, the exit code and the way the source is restored are those of tools/mutate-edit.py (this script loads it and replaces its list of mutants): a
mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed.  Commit first, or work in a copy.
"""
import importlib.util, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutate_edit', os.path.join(HERE, 'mutate-edit.py'))
me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(me)

IM = 'imeeditbox.ts'
T = me.T
me.M.clear()
me.TIMEOUT.clear()
me.TESTS[IM] = [T + 'ime-input.test.ts', T + 'imeeditbox.test.ts']
# PlaceCaret has its own tests of what it asks the buffer (imeboxdraw.test.ts, with a buffer whose trailing edge differs from its leading one): the
# exe's `CPtoX` does not look at `bTrail`, so the mutants that only the calls show (not the trailing edge, the exact fit) are killed there, last
me.TESTS[IM].append(T + 'imeboxdraw.test.ts')
me.TIMEOUT[IM] = 60  # the tests take 12 seconds; a mutant that loops for ever is a kill

# (the first marker, the last marker): the code between them
REGIONS = {
    IM: [('function utf16(data: Uint8Array, bytes: number): string {', '\n}\n'), ('function compositionText(host: ImeHost, himc: number, index: number): string | null {', '\n}\n'),
         ('function compositionString(got: ImmBytes): string | null {', '\n}\n'),
         # the IME system: CheckToggleState, the indicator, ResetCompositionString, StaticMsgProc and its two cases, GetPrivateReadingString, GetImeId
         ('  checkToggleState(): void {', '\n}\n'),
         ('  PlaceCaret(nCP: number): void {', '\n  }\n'),
         ('  // ================================================================ the input\n', '\n}\n')],
}

# the tests that are likely to kill the mutants of a function (the groups of scenes of tools/oracle-ime.py): they run first, the others only for a survivor
GROUPS = {
    'checkToggleState': 'T[1-5] |F1 |N5 |L4 ', 'localeIndicator': 'T3 |L[23] ', 'resetCompositionString': 'L1 |W1 |R3 ', 'staticMsgProc': 'L[1-4] ',
    'listKeyboardLayouts': 'L[23] ', 'inputLanguageChanged': 'L4 ', 'getPrivateReadingString': 'Z1 |N6 ', 'getImeId': 'T4 |N[16] |R5 |Z1 ',
    'utf16': 'R3 |H[12] ', 'compositionText': 'R3 |H[12] ', 'compositionString': 'R3 |H[12] ', 'PlaceCaret': 'K9 ', 'msgProc': 'W[1-4] |E9 |R[1-9] |N[1-7] ',
    'modifierProc': 'E9 ', 'postMissingKeyUps': 'E9 ', 'imeComposition': 'R[1-9] ', 'readingFromComposition': 'R5 ', 'TruncateCompString': 'W[15] |R3 ',
    'imeNotify': 'N[1-7] |W[23] ', 'imeCandidateList': 'N[1-3] ', 'ebProc': 'E[1-8] |G[1-5] |H[1-3] ', 'handleKeyboard': 'K[1-8] |G5 ',
    'handleMouse': 'M[0-9]+ |G5 click', 'charAt': 'M[0-9]+ ', 'clickOnImeWindows': 'M[0-9]+ ', 'onFocusIn': 'F1 ', 'onFocusOut': 'F[23] ',
    'groupNeighbour': 'Q5 |G[345] |H[13] ', 'GetPrevIMEEditBox': 'Q5 ', 'GetNextIMEEditBox': 'Q5 ',
}
me.QUICK[IM] = lambda name: GROUPS.get(name.split(':')[0])
me.FUNC_RE = re.compile(r'(?:  (?:private |override |static |protected )*|function )(\w+)\(')  # (the functions of the file that are no methods, too)

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
                    name = f'{func}: {hit.group()} -> {new} in `{snippet}`'
                    seen[name] = seen.get(name, 0) + 1
                    if seen[name] > 1:
                        name += f' (#{seen[name]})'
                    result.append((name, anchor, repl))
    return result


MSGS = ['m_CustomMsgEditBoxChange', 'm_CustomMsgEditBoxEnter', 'm_CustomMsgEditBoxFocusOut', 'm_CustomMsgEditBoxFocusIn']
SWAPS = [
    (r'\breturn true;', ['return false;']),
    (r'\breturn false;', ['return true;']),
    (r'\bthis\.m_nCaret\b', ['this.m_nSelStart']),
    (r'\bthis\.m_nSelStart\b', ['this.m_nCaret']),
    (r'\bUIM\.CONTROL_EVENT\b', ['UIM.CUSTOM_MSG']),
    (r'\bUIM\.CUSTOM_MSG\b', ['UIM.CONTROL_EVENT']),
    *[(rf'\b{a}\b', [b for b in MSGS if b != a]) for a in MSGS],
    (r'\bGetNextItemPos\b', ['GetPriorItemPos']),
    (r'\bGetPriorItemPos\b', ['GetNextItemPos']),
    (r'\bGetPrevIMEEditBox\b', ['GetNextIMEEditBox']),
    (r'\bGetNextIMEEditBox\b', ['GetPrevIMEEditBox']),
    (r'\bm_bEnable\b', ['m_bShow']),
    (r'\bm_bShow\b', ['m_bEnable']),
    (r'\bm_bHasFocus\b', ['m_bMouseDrag']),
    (r'\bm_bMouseDrag\b', ['m_bHasFocus']),
    (r'\bm_nFirstVisible\b', ['m_nCaret']),
    (r'\bime\.lAlt\b', ['ime.lCtrl', 'ime.lShift']),
    (r'\bime\.lCtrl\b', ['ime.lAlt', 'ime.lShift']),
    (r'\bime\.lShift\b', ['ime.lAlt', 'ime.lCtrl']),
    (r'\bs_bVerticalCand\b', ['s_bChineseIME']),
    (r'\bs_bChineseIME\b', ['s_bVerticalCand']),
    (r'\bs_nCompCaret\b', ['s_nFirstTargetConv']),
    (r'\bs_nFirstTargetConv\b', ['s_nCompCaret']),
    (r'(?<![.\w])host\.immGetContext\(\)', ['0']),
    (r'\b(?:this|ime)\.host\.immGetContext\(\)', ['0']),
    (r'\bhost\.immAssociateContext\(0\)', ['host.immAssociateContext(ime.s_hImcDef)']),
    (r'\bbuffer\.GetTextSize\(\)', ['0']),
]

MUTANTS = []
for _f, _regions in REGIONS.items():
    for _name, _a, _b in me.operator_mutants(_f, _regions):
        MUTANTS.append((_f, _name, _a, _b))
    for _name, _a, _b in swap_mutants(_f, _regions, SWAPS):
        MUTANTS.append((_f, _name, _a, _b))

# ---- the mutants that no input can tell from the original (name -> why)

add('checkToggleState: 0xffff -> 0xfffe in `const sub = (hkl & 0xffff) >>> 10;`', 'equivalent: the shift by 10 drops bit 0, so the mask 0xfffe keeps the same bits as 0xffff')
add('listKeyboardLayouts: 0xffff -> 0xfffe in `const sub = (hkl & 0xffff) >>> 10;`', 'equivalent: the shift by 10 drops bit 0, so the mask 0xfffe keeps the same bits as 0xffff')
add("compositionString: 0x200 -> 0x1ff in `if (bytes >= 0x200) throw new Error(`CKTDGUIIMEEditBox: the IME's compos...`",
    'equivalent: `bytes` is `n & -2`, an even number, so `bytes >= 0x1ff` is `bytes >= 0x200`')
add('listKeyboardLayouts: 2 -> 3 in `this.s_Locale.push(new InputLocale(hkl, untilNul(indicator).slice(0, 2),...`',
    'equivalent: the indicator is at most two characters (the first and the second in lower case of a locale name, or one of the four signs), so the exe\'s copy into 3 characters never cuts')
add('utf16: < -> <= in `for (let i = 0; i + 1 < bytes; i += 2) text += String.fromCharCode(data[...`',
    'equivalent: `bytes` is even (the only caller passes `n & -2`) and `i` goes in steps of 2, so `i + 1 <= bytes` holds for the same `i` as `i + 1 < bytes`')
add('utf16: 1 -> 0 in `for (let i = 0; i + 1 < bytes; i += 2) text += String.fromCharCode(data[...`',
    'equivalent: `bytes` is even and `i` goes in steps of 2, so `i + 0 < bytes` holds for the same `i` as `i + 1 < bytes`')
add('postMissingKeyUps: 0x1ff0000 -> 0x1ff0001 in `const post = (vk: number, last: number): void => host.postMessage(host.g...`',
    'equivalent: bit 0 of the result is set by the `| 0xc0000001` that follows the mask')
add('PasteFromClipboard: this.m_nCaret -> this.m_nSelStart in `const caret = this.m_nCaret;`',
    'equivalent: `DeleteSelectionText()` ran first and leaves the caret and the start of the selection at the same place (`PlaceCaret(lo)`, then the start is the caret)')
add('SendCompString: 0 -> 1 in `this.msgProc(null, 0x102, comp.m_pwszBuffer!.charCodeAt(i), 0); // (the ...`',
    "equivalent: the `lParam` of a `WM_CHAR` is not read by anything `EBProc` calls (it only passes it on to the neighbouring box's `EBProc`)")
add('clickOnImeWindows: > -> >= in `key(at > target ? 0x27 : 0x25, Math.abs(at - target));`',
    'equivalent: with `at == target` the key is pressed `abs(0)` times, whichever key it is')
add('clickOnImeWindows: > -> >= in `key(cp > ime.s_nCompCaret ? 0x27 : 0x25, Math.abs(cp - ime.s_nCompCaret)...`',
    'equivalent: with `cp == s_nCompCaret` the key is pressed `abs(0)` times, whichever key it is')
add('clickOnImeWindows: > -> >= in `key(row > selection ? 0x28 : 0x26, Math.abs(row - selection));`',
    'equivalent: with `row == selection` the key is pressed `abs(0)` times, whichever key it is')
add('ebProc: this.m_nCaret -> this.m_nSelStart in `const caret = this.m_nCaret; // (no selection: the start of it is the ca...`',
    'equivalent: this is the branch of the test `m_nCaret !== m_nSelStart` that failed, so the two are equal')
add('ebProc: this.m_nCaret -> this.m_nSelStart in `const caret = this.m_nCaret; // (the selection is gone: the start of it ...`',
    'equivalent: the selection was deleted just before (`DeleteSelectionText` leaves the caret and the start of the selection at the same place), or there was none')
add('handleKeyboard: this.m_nCaret -> this.m_nSelStart in `const caret = this.m_nCaret; // (no selection: the start of it is the ca...`',
    'equivalent: this is the branch of the test `m_nCaret !== m_nSelStart` that failed, so the two are equal')
add('msgProc: 0 -> 1 in `this.TruncateCompString(true, 0);`',
    'equivalent: with the flag true (the backspace way) the second argument, the length to keep, is not looked at')

for _f, _name, _a, _b in MUTANTS:
    me.m(_f, _name, _a, _b, WHY.get(_name, ''))
for _name in WHY:
    assert any(mu[1] == _name for mu in me.M), f'a reason for a mutant that does not exist: {_name}'

if __name__ == '__main__':
    sys.exit(me.main())
