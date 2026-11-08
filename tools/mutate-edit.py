#!/usr/bin/env python3
"""Mutation check of the text boxes of packages/ui: the measuring of CKTDGUIUniBuffer (unibuffer.ts: CPtoX, CPtoY, GetLineWidth, XtoCP),
the drawing of CKTDGUIEditBox (editbox.ts: OnFrameRender, PlaceCaret, DrawTextW, DrawRect), the user32 rectangle helpers it uses
(rect.ts: IsRectEmpty, IntersectRect) and the drawing of CKTDGUIIMEEditBox (imeeditbox.ts: OnFrameRender, DrawRect, DrawTextW, CalcTextRect,
RenderComposition, RenderCandidateReadingWindow).  One small change at a time is applied to a source file of packages/ui/src, the tests of the
text boxes are run and the script reports whether a test notices (killed) or not (SURVIVED).  The mutants of the first three files are written
out; those of imeeditbox.ts are made from its source by operator (`operator_mutants`: every comparison, logical and arithmetic operator, number,
`!`, condition, `?:`, `.left` / `.top` / `.x` / ..., colour field and statement of the drawing, one at a time), so their names are the text of the line.

    python3 tools/mutate-edit.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

A mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed (the reason is out of
date).  The reason (the last argument of `m(...)`) says why no input can tell the mutant from the original.  `--check` only verifies that
every anchor text occurs exactly once; `--survivors=LOG` runs only the mutants that survived in an earlier run's output.  The source is
restored after every mutant (also on Ctrl-C), but do not run this with edits you cannot afford to lose in the mutated files and edit
nothing meanwhile.  Needs `bun` in ./node_modules/.bin.  Each run has a 90 s timeout and an 8 GB address-space limit: a mutant that
loops or blows up is killed, too.
"""
import os, re, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
SRC = 'packages/ui/src/'
T = 'packages/ui/test/'
# the tests that run for the mutants of a file
TESTS = {
    'unibuffer.ts': [T + 'unibuffer.test.ts', T + 'editboxdraw.test.ts', T + 'imeeditbox.test.ts'],
    'editbox.ts': [T + 'editboxdraw.test.ts'],
    'rect.ts': [T + 'rect.test.ts', T + 'editboxdraw.test.ts'],
    'imeeditbox.ts': [T + 'imeboxdraw.test.ts', T + 'imeeditbox.test.ts'],
}
# seconds a run of the tests may take before the mutant counts as killed (a mutant that loops for ever): the unmutated tests take 2
TIMEOUT = {'imeeditbox.ts': 40}

M = []


def m(f, name, a, b, why=''):
    M.append((f, name, a, b, why))


def path_of(f):
    return os.path.join(ROOT, SRC + f)


UB = 'unibuffer.ts'

# ---- the text the measuring works on
m(UB, 'measured: a buffer nobody allocated is an Error', r'''if (text === null) throw new Error("CKTDGUIUniBuffer: no buffer is allocated; the exe measures a null pointer (wcslen)");
    return this.m_bUseHideChar''', r'''return this.m_bUseHideChar''')
m(UB, 'measured: a buffer that hides its text has the hide character', r'''return this.m_bUseHideChar ? String.fromCharCode(this.m_cHideChar).repeat(text.length) : text;''', r'''return text;''')
m(UB, 'measured: a buffer that shows its text has its text', r'''return this.m_bUseHideChar ? String.fromCharCode(this.m_cHideChar).repeat(text.length) : text;''', r'''return String.fromCharCode(this.m_cHideChar).repeat(text.length);''')
m(UB, 'measured: the hide character is the buffer\'s', r'''String.fromCharCode(this.m_cHideChar).repeat(text.length)''', r'''String.fromCharCode(0x2a).repeat(text.length)''')
m(UB, 'measured: one hide character for every character', r'''.repeat(text.length) : text;''', r'''.repeat(1) : text;''')
m(UB, 'measured: not one more hide character than there are characters', r'''.repeat(text.length) : text;''', r'''.repeat(text.length + 1) : text;''')

# ---- layoutWidth
m(UB, 'layoutWidth: the x scale', r'''f(f(font.GetWidth(text)) / font.scale.x)''', r'''f(f(font.GetWidth(text)) / font.scale.y)''')
m(UB, 'layoutWidth: a quotient', r'''f(f(font.GetWidth(text)) / font.scale.x)''', r'''f(f(font.GetWidth(text)) * font.scale.x)''')
m(UB, 'layoutWidth: cut, not rounded', r'''return ftoi(f(f(font.GetWidth(text)) / font.scale.x));''', r'''return Math.round(f(f(font.GetWidth(text)) / font.scale.x));''')
m(UB, 'layoutWidth: cut towards 0, not down', r'''return ftoi(f(f(font.GetWidth(text)) / font.scale.x));''', r'''return Math.floor(f(f(font.GetWidth(text)) / font.scale.x));''',
  'equivalent: a width is never below 0 (GetWidth starts from 0), and for a number of 0 or more cutting towards 0 and down agree')
m(UB, 'layoutWidth: the quotient is a float', r'''ftoi(f(f(font.GetWidth(text)) / font.scale.x))''', r'''ftoi(f(font.GetWidth(text)) / font.scale.x)''',
  'equivalent: for every back buffer 200 to 8000 pixels wide and every width up to 2999 (searched in Python) an int over the scale is cut to the same int as the float of it: the quotient is never within a float\'s rounding of a whole number without being one')
m(UB, 'layoutWidth: the width is a float', r'''ftoi(f(f(font.GetWidth(text)) / font.scale.x))''', r'''ftoi(f(font.GetWidth(text) / font.scale.x))''',
  'equivalent: a width is an int far below 2^24, which a float holds exactly')
m(UB, 'layoutWidth: the font measures the text', r'''f(f(font.GetWidth(text)) / font.scale.x)''', r'''f(f(font.GetWidth("")) / font.scale.x)''')

# ---- CPtoX
m(UB, 'CPtoX: bTrail is not looked at', r'''void bTrail;
    const font = this.m_pFontNode;
    if (font === null) return 0;
    let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf''', r'''if (bTrail) return 0;
    const font = this.m_pFontNode;
    if (font === null) return 0;
    let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf''')
m(UB, 'CPtoX: without a font the x is 0', r'''if (font === null) return 0;
    let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf''', r'''let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf''')
m(UB, 'CPtoX: the count is unsigned', r'''let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf''', r'''let text = this.measured().slice(0, nCP);
    const lf = text.lastIndexOf''')
m(UB, 'CPtoX: the text is cut at the character', r'''let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf''', r'''let text = this.measured();
    const lf = text.lastIndexOf''')
m(UB, 'CPtoX: the character itself is not measured', r'''let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf''', r'''let text = this.measured().slice(0, (nCP >>> 0) - 1);
    const lf = text.lastIndexOf''')
m(UB, 'CPtoX: the character itself is not measured (one more)', r'''let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf''', r'''let text = this.measured().slice(0, (nCP >>> 0) + 1);
    const lf = text.lastIndexOf''')
m(UB, 'CPtoX: the last line break', r'''const lf = text.lastIndexOf("\n");
    if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);''', r'''const lf = text.indexOf("\n");
    if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);''')
m(UB, 'CPtoX: the line starts after the break', r'''if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);''', r'''if (lf >= 0) text = text.slice(lf + 2);
    return this.layoutWidth(font, text);''')
m(UB, 'CPtoX: the line starts at the break', r'''if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);''', r'''if (lf >= 0) text = text.slice(lf);
    return this.layoutWidth(font, text);''',
  'equivalent: the line break is 0 wide and starts a line of its own, so the widest line is the same with or without it')
m(UB, 'CPtoX: a break is cut', r'''if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);''', r'''return this.layoutWidth(font, text);''')
m(UB, 'CPtoX: a break at the very start is cut too', r'''if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);''', r'''if (lf > 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);''',
  'equivalent: what the cut leaves out is an empty line, 0 wide, whatever follows')
m(UB, 'CPtoX: the line is measured', r'''if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);''', r'''if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, this.measured());''')

# ---- CPtoY
m(UB, 'CPtoY: bTrail is not looked at', r'''void bTrail;
    const font = this.m_pFontNode;
    if (font === null) return 0;
    let text = this.measured().slice(0, nCP >>> 0);
    let lines = 0;''', r'''if (bTrail) return 0;
    const font = this.m_pFontNode;
    if (font === null) return 0;
    let text = this.measured().slice(0, nCP >>> 0);
    let lines = 0;''')
m(UB, 'CPtoY: without a font the y is 0', r'''if (font === null) return 0;
    let text = this.measured().slice(0, nCP >>> 0);
    let lines = 0;''', r'''let text = this.measured().slice(0, nCP >>> 0);
    let lines = 0;''')
m(UB, 'CPtoY: the count is unsigned', r'''let text = this.measured().slice(0, nCP >>> 0);
    let lines = 0;''', r'''let text = this.measured().slice(0, nCP);
    let lines = 0;''')
m(UB, 'CPtoY: the text is cut at the character', r'''let text = this.measured().slice(0, nCP >>> 0);
    let lines = 0;''', r'''let text = this.measured();
    let lines = 0;''')
m(UB, 'CPtoY: the character itself is not counted', r'''let text = this.measured().slice(0, nCP >>> 0);
    let lines = 0;''', r'''let text = this.measured().slice(0, (nCP >>> 0) - 1);
    let lines = 0;''')
m(UB, 'CPtoY: the first break starts the count', r'''let lf = text.indexOf("\n");
    while (lf >= 0) {''', r'''let lf = text.lastIndexOf("\n");
    while (lf >= 0) {''')
m(UB, 'CPtoY: a break at the very start is counted', r'''while (lf >= 0) {
      lines++;''', r'''while (lf > 0) {
      lines++;''')
m(UB, 'CPtoY: a break is counted', r'''      lines++;
      if (text.length - 1 <= lf) break;''', r'''      if (text.length - 1 <= lf) break;''')
m(UB, 'CPtoY: a break is counted once', r'''      lines++;
      if (text.length - 1 <= lf) break;''', r'''      lines += 2;
      if (text.length - 1 <= lf) break;''')
m(UB, 'CPtoY: a break that is the last character ends the count', r'''      if (text.length - 1 <= lf) break;
''', '',
  'equivalent: without the break the text is cut after the break and is empty, which is as high (one line) as the line the break ended, and nothing is left to count')
m(UB, 'CPtoY: a break that is the last character ends the count (strictly)', r'''if (text.length - 1 <= lf) break;''', r'''if (text.length - 1 < lf) break;''',
  'equivalent: for a break that is the last character the two comparisons differ, and the count goes on with an empty text, which ends it at once')
m(UB, 'CPtoY: a break that is one before the last character ends the count', r'''if (text.length - 1 <= lf) break;''', r'''if (text.length - 2 <= lf) break;''')
m(UB, 'CPtoY: the text after the break', r'''      text = text.slice(lf + 1);
      lf = text.indexOf("\n");''', r'''      text = text.slice(lf);
      lf = text.indexOf("\n");''')
m(UB, 'CPtoY: the text after the break (not one more)', r'''      text = text.slice(lf + 1);
      lf = text.indexOf("\n");''', r'''      text = text.slice(lf + 2);
      lf = text.indexOf("\n");''')
m(UB, 'CPtoY: the next break is the first', r'''      text = text.slice(lf + 1);
      lf = text.indexOf("\n");''', r'''      text = text.slice(lf + 1);
      lf = text.lastIndexOf("\n");''')
m(UB, 'CPtoY: the count goes on until there is no break', r'''      lf = text.indexOf("\n");
    }''', r'''      lf = -1;
    }''')
m(UB, 'CPtoY: the break that ends the text is dropped', r'''if (text.length !== 0 && text.charCodeAt(text.length - 1) === 10) text = text.slice(0, -1);''', '')
m(UB, 'CPtoY: it is a line break that is dropped', r'''text.charCodeAt(text.length - 1) === 10) text = text.slice(0, -1);''', r'''text.charCodeAt(text.length - 1) === 13) text = text.slice(0, -1);''')
m(UB, 'CPtoY: only the break is dropped', r'''text.charCodeAt(text.length - 1) === 10) text = text.slice(0, -1);''', r'''text.charCodeAt(text.length - 1) === 10) text = text.slice(1);''')
m(UB, 'CPtoY: the drop does not need a text (the exe reads a character before an empty one)', r'''if (text.length !== 0 && text.charCodeAt(text.length - 1) === 10)''', r'''if (text.charCodeAt(text.length - 1) === 10)''',
  'equivalent: the character before the start of an empty text is NaN here, and what the exe reads there is cut to nothing: an empty text stays empty')
m(UB, 'CPtoY: the height is measured', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''', r'''return ftoi(f(f(f(font.GetHeight("A\nB")) / font.scale.y) * f(lines)));''')
m(UB, 'CPtoY: the height is of the text, whatever it is', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''', r'''return ftoi(f(f(f(font.GetHeight("")) / font.scale.y) * f(lines)));''',
  'equivalent: the text is one line (or an empty one, as high) after the count, whatever the line holds')
m(UB, 'CPtoY: the y scale', r'''/ font.scale.y) * f(lines)));''', r'''/ font.scale.x) * f(lines)));''')
m(UB, 'CPtoY: a quotient', r'''/ font.scale.y) * f(lines)));''', r'''* font.scale.y) * f(lines)));''')
m(UB, 'CPtoY: times the breaks', r'''/ font.scale.y) * f(lines)));''', r'''/ font.scale.y) + f(lines)));''')
m(UB, 'CPtoY: cut, not rounded', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''', r'''return Math.round(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''')
m(UB, 'CPtoY: cut towards 0, not down', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''', r'''return Math.floor(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''',
  'equivalent: a height and a count of breaks are never below 0, and for a number of 0 or more cutting towards 0 and down agree')
m(UB, 'CPtoY: the product is a float', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''', r'''return ftoi(f(f(font.GetHeight(text)) / font.scale.y) * f(lines));''')
m(UB, 'CPtoY: the quotient is a float', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''', r'''return ftoi(f(f(font.GetHeight(text)) / font.scale.y * f(lines)));''')
m(UB, 'CPtoY: the height is a float', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''', r'''return ftoi(f(f(font.GetHeight(text) / font.scale.y) * f(lines)));''',
  'equivalent: a height is an int far below 2^24, which a float holds exactly')
m(UB, 'CPtoY: the count is a float', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));''', r'''return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * lines));''',
  'equivalent: a count of breaks is an int far below 2^24, which a float holds exactly')

# ---- GetLineWidth
m(UB, 'GetLineWidth: without a font the width is 0', r'''if (font === null) return 0;
    const n = nCP >>> 0;''', r'''const n = nCP >>> 0;''')
m(UB, 'GetLineWidth: the count is unsigned', r'''const n = nCP >>> 0;
    const text = this.measured();
    if (text.length < n)''', r'''const n = nCP;
    const text = this.measured();
    if (text.length < n)''')
m(UB, 'GetLineWidth: a position past the text is an Error', r'''if (text.length < n) throw new RangeError("CKTDGUIUniBuffer::GetLineWidth: invalid string position (std::out_of_range)");''', '')
m(UB, 'GetLineWidth: the end of the text is a position', r'''if (text.length < n) throw''', r'''if (text.length <= n) throw''')
m(UB, 'GetLineWidth: a position one past the end is an Error', r'''if (text.length < n) throw''', r'''if (text.length + 1 < n) throw''')
m(UB, 'GetLineWidth: the break before is the last one', r'''const last = text.slice(0, n).lastIndexOf("\n");''', r'''const last = text.slice(0, n).indexOf("\n");''')
m(UB, 'GetLineWidth: the break before is before the character', r'''const last = text.slice(0, n).lastIndexOf("\n");''', r'''const last = text.slice(0, n + 1).lastIndexOf("\n");''')
m(UB, 'GetLineWidth: the break before is before the character (not two before)', r'''const last = text.slice(0, n).lastIndexOf("\n");''', r'''const last = text.slice(0, n - 1).lastIndexOf("\n");''')
m(UB, 'GetLineWidth: the break after is the first one', r'''const first = text.slice(n).indexOf("\n");''', r'''const first = text.slice(n).lastIndexOf("\n");''')
m(UB, 'GetLineWidth: the break after may be at the character', r'''const first = text.slice(n).indexOf("\n");''', r'''const first = text.slice(n + 1).indexOf("\n");''')
m(UB, 'GetLineWidth: the break after may be at the character (not one before)', r'''const first = text.slice(n).indexOf("\n");''', r'''const first = text.slice(n - 1).indexOf("\n");''')
m(UB, 'GetLineWidth: a line from the start to the break after ends before it', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text;''', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first + 1) : text;''',
  'equivalent: the line break is 0 wide and ends the line, so the widest line is the same with or without it')
m(UB, 'GetLineWidth: a line from the start to the break after ends before it (not one early)', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text;''', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first - 1) : text;''')
m(UB, 'GetLineWidth: a line from the start to the break after takes no more', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text;''', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first + 2) : text;''')
m(UB, 'GetLineWidth: a line with no break after goes to the end', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text;''', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text.slice(0, n);''')
m(UB, 'GetLineWidth: a line with no break at all is all of the text', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text;''', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text.slice(1);''')
m(UB, 'GetLineWidth: a line that starts at the start with a break after', r'''if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text;''', r'''if (last < 0) line = first >= 0 ? text.slice(1, n + first) : text;''')
m(UB, 'GetLineWidth: the break before decides', r'''if (last < 0) line = first >= 0 ?''', r'''if (last <= 0) line = first >= 0 ?''',
  'equivalent: a break at the very start is 0 wide and starts a line of its own, so the line from the start and the line after the break are as wide')
m(UB, 'GetLineWidth: a line after a break starts after it', r'''else line = first >= 0 ? text.slice(last + 1, n + first + 1) : text.slice(last + 1);''', r'''else line = first >= 0 ? text.slice(last, n + first + 1) : text.slice(last + 1);''',
  'equivalent: the line break is 0 wide and starts a line of its own, so the widest line is the same with or without it')
m(UB, 'GetLineWidth: a line after a break starts after it (not one late)', r'''else line = first >= 0 ? text.slice(last + 1, n + first + 1) : text.slice(last + 1);''', r'''else line = first >= 0 ? text.slice(last + 2, n + first + 1) : text.slice(last + 1);''')
m(UB, 'GetLineWidth: a line after a break ends after the break after (the exe takes it)', r'''else line = first >= 0 ? text.slice(last + 1, n + first + 1) : text.slice(last + 1);''', r'''else line = first >= 0 ? text.slice(last + 1, n + first) : text.slice(last + 1);''',
  'equivalent: the line break is 0 wide and ends the line, so the widest line is the same with or without it')
m(UB, 'GetLineWidth: a line after a break ends at the break after (not one character more)', r'''else line = first >= 0 ? text.slice(last + 1, n + first + 1) : text.slice(last + 1);''', r'''else line = first >= 0 ? text.slice(last + 1, n + first + 2) : text.slice(last + 1);''')
m(UB, 'GetLineWidth: a line after a break ends before the break after (not one early)', r'''else line = first >= 0 ? text.slice(last + 1, n + first + 1) : text.slice(last + 1);''', r'''else line = first >= 0 ? text.slice(last + 1, n + first - 1) : text.slice(last + 1);''')
m(UB, 'GetLineWidth: a line after a break with none after goes to the end', r'''text.slice(last + 1, n + first + 1) : text.slice(last + 1);''', r'''text.slice(last + 1, n + first + 1) : text.slice(last + 1, n);''')
m(UB, 'GetLineWidth: a line after a break with none after starts after the break', r'''text.slice(last + 1, n + first + 1) : text.slice(last + 1);''', r'''text.slice(last + 1, n + first + 1) : text.slice(last);''',
  'equivalent: the line break is 0 wide and starts a line of its own, so the widest line is the same with or without it')
m(UB, 'GetLineWidth: the line is measured', r'''return this.layoutWidth(font, line);''', r'''return this.layoutWidth(font, text);''')

# ---- XtoCP
m(UB, 'XtoCP: without a font the position is 0', r'''if (font === null) return { cp: 0, trail: 0 };
    const text = this.m_pwszBuffer;''', r'''const text = this.m_pwszBuffer;''')
m(UB, 'XtoCP: a buffer nobody allocated is an Error', r'''if (text === null) throw new Error("CKTDGUIUniBuffer::XtoCP: no buffer is allocated; the exe measures a null pointer (wcslen)");
''', '')
m(UB, 'XtoCP: x is scaled by the x scale', r'''const x = ftoi(f(f(nX) * font.scale.x));''', r'''const x = ftoi(f(f(nX) * font.scale.y));''')
m(UB, 'XtoCP: x is scaled by a product', r'''const x = ftoi(f(f(nX) * font.scale.x));''', r'''const x = ftoi(f(f(nX) / font.scale.x));''')
m(UB, 'XtoCP: x is cut, not rounded', r'''const x = ftoi(f(f(nX) * font.scale.x));''', r'''const x = Math.round(f(f(nX) * font.scale.x));''')
m(UB, 'XtoCP: x is cut towards 0, not down', r'''const x = ftoi(f(f(nX) * font.scale.x));''', r'''const x = Math.floor(f(f(nX) * font.scale.x));''',
  'equivalent: below 0 the first character reaches x either way (cp 0), and from 0 on cutting towards 0 and down agree')
m(UB, 'XtoCP: the product is a float', r'''const x = ftoi(f(f(nX) * font.scale.x));''', r'''const x = ftoi(f(nX) * font.scale.x);''',
  'equivalent: for every back buffer up to 5624 pixels wide and every x up to 2999 (searched in Python) a product of an int and the scale is cut to the same int as the float of it: it is never within a float\'s rounding of a whole number without being one')
m(UB, 'XtoCP: x is a float', r'''const x = ftoi(f(f(nX) * font.scale.x));''', r'''const x = ftoi(f(nX * font.scale.x));''',
  'equivalent: x is an int far below 2^24, which a float holds exactly')
m(UB, 'XtoCP: a character reaches x when its end is at x', r'''if (font.GetWidth(text.slice(0, i + 1)) >= x) return''', r'''if (font.GetWidth(text.slice(0, i + 1)) > x) return''')
m(UB, 'XtoCP: a character reaches x when its end is beyond x', r'''if (font.GetWidth(text.slice(0, i + 1)) >= x) return''', r'''if (font.GetWidth(text.slice(0, i + 1)) >= x + 1) return''')
m(UB, 'XtoCP: a character reaches x when its end is not short of it', r'''if (font.GetWidth(text.slice(0, i + 1)) >= x) return''', r'''if (font.GetWidth(text.slice(0, i + 1)) < x) return''')
m(UB, 'XtoCP: the end of a character is the width of the text up to and with it', r'''font.GetWidth(text.slice(0, i + 1))''', r'''font.GetWidth(text.slice(0, i))''')
m(UB, 'XtoCP: the width is of the whole text up to there', r'''font.GetWidth(text.slice(0, i + 1))''', r'''font.GetWidth(text.slice(i, i + 1))''')
m(UB, 'XtoCP: the answer is the character', r'''if (font.GetWidth(text.slice(0, i + 1)) >= x) return { cp: i, trail: 0 };''', r'''if (font.GetWidth(text.slice(0, i + 1)) >= x) return { cp: i + 1, trail: 0 };''')
m(UB, 'XtoCP: the answer has no trail', r'''if (font.GetWidth(text.slice(0, i + 1)) >= x) return { cp: i, trail: 0 };''', r'''if (font.GetWidth(text.slice(0, i + 1)) >= x) return { cp: i, trail: 1 };''')
m(UB, 'XtoCP: the search starts at the first character', r'''for (let i = 0; i < size; i++) {''', r'''for (let i = 1; i < size; i++) {''')
m(UB, 'XtoCP: the search goes to the last character', r'''for (let i = 0; i < size; i++) {''', r'''for (let i = 0; i < size - 1; i++) {''')
m(UB, 'XtoCP: no character reaching x is the end of the text', r'''return { cp: size, trail: 0 };
  }''', r'''return { cp: size - 1, trail: 0 };
  }''')
m(UB, 'XtoCP: no character reaching x is the end of the text (not 0)', r'''return { cp: size, trail: 0 };
  }''', r'''return { cp: 0, trail: 0 };
  }''')
m(UB, 'XtoCP: no character reaching x has no trail', r'''return { cp: size, trail: 0 };
  }''', r'''return { cp: size, trail: 1 };
  }''')

# ---- rect.ts: IntersectRect
RC = 'rect.ts'
m(RC, 'intersectRect: the left side is the larger of the two', r'''const left = Math.max(src1.left, src2.left);''', r'''const left = Math.min(src1.left, src2.left);''')
m(RC, 'intersectRect: the left side is of both', r'''const left = Math.max(src1.left, src2.left);''', r'''const left = src1.left;''')
m(RC, 'intersectRect: the right side is the smaller of the two', r'''const right = Math.min(src1.right, src2.right);''', r'''const right = Math.max(src1.right, src2.right);''')
m(RC, 'intersectRect: the right side is of both', r'''const right = Math.min(src1.right, src2.right);''', r'''const right = src1.right;''')
m(RC, 'intersectRect: the top side is the larger of the two', r'''const top = Math.max(src1.top, src2.top);''', r'''const top = Math.min(src1.top, src2.top);''')
m(RC, 'intersectRect: the top side is of both', r'''const top = Math.max(src1.top, src2.top);''', r'''const top = src2.top;''')
m(RC, 'intersectRect: the bottom side is the smaller of the two', r'''const bottom = Math.min(src1.bottom, src2.bottom);''', r'''const bottom = Math.max(src1.bottom, src2.bottom);''')
m(RC, 'intersectRect: the bottom side is of both', r'''const bottom = Math.min(src1.bottom, src2.bottom);''', r'''const bottom = src2.bottom;''')
m(RC, 'intersectRect: a width of 0 is no common part', r'''if (left < right && top < bottom) {''', r'''if (left <= right && top < bottom) {''')
m(RC, 'intersectRect: a height of 0 is no common part', r'''if (left < right && top < bottom) {''', r'''if (left < right && top <= bottom) {''')
m(RC, 'intersectRect: both a width and a height are needed', r'''if (left < right && top < bottom) {''', r'''if (left < right || top < bottom) {''')
m(RC, 'intersectRect: the width is right minus left', r'''if (left < right && top < bottom) {''', r'''if (left > right && top < bottom) {''')
m(RC, 'intersectRect: the height is bottom minus top', r'''if (left < right && top < bottom) {''', r'''if (left < right && top > bottom) {''')
m(RC, 'intersectRect: the left side is set', r'''    dst.left = left;
    dst.top = top;''', r'''    dst.top = top;''')
m(RC, 'intersectRect: the left side is the left', r'''    dst.left = left;
    dst.top = top;''', r'''    dst.left = right;
    dst.top = top;''')
m(RC, 'intersectRect: the top side is set', r'''    dst.top = top;
    dst.right = right;''', r'''    dst.right = right;''')
m(RC, 'intersectRect: the top side is the top', r'''    dst.top = top;
    dst.right = right;''', r'''    dst.top = bottom;
    dst.right = right;''')
m(RC, 'intersectRect: the right side is set', r'''    dst.right = right;
    dst.bottom = bottom;
    return true;''', r'''    dst.bottom = bottom;
    return true;''')
m(RC, 'intersectRect: the right side is the right', r'''    dst.right = right;
    dst.bottom = bottom;
    return true;''', r'''    dst.right = left;
    dst.bottom = bottom;
    return true;''')
m(RC, 'intersectRect: the bottom side is set', r'''    dst.bottom = bottom;
    return true;''', r'''    return true;''')
m(RC, 'intersectRect: the bottom side is the bottom', r'''    dst.bottom = bottom;
    return true;''', r'''    dst.bottom = top;
    return true;''')
m(RC, 'intersectRect: a common part is true', r'''    dst.bottom = bottom;
    return true;''', r'''    dst.bottom = bottom;
    return false;''')
m(RC, 'intersectRect: no common part is an empty rectangle', r'''  dst.left = dst.top = dst.right = dst.bottom = 0;
  return false;''', r'''  return false;''')
m(RC, 'intersectRect: no common part is an empty rectangle (every side)', r'''  dst.left = dst.top = dst.right = dst.bottom = 0;
  return false;''', r'''  dst.left = dst.top = dst.right = 0;
  return false;''')
m(RC, 'intersectRect: no common part is an empty rectangle (the bottom too)', r'''  dst.left = dst.top = dst.right = dst.bottom = 0;
  return false;''', r'''  dst.top = dst.right = dst.bottom = 0;
  return false;''')
m(RC, 'intersectRect: no common part is an empty rectangle (the top too)', r'''  dst.left = dst.top = dst.right = dst.bottom = 0;
  return false;''', r'''  dst.left = dst.right = dst.bottom = 0;
  return false;''')
m(RC, 'intersectRect: no common part is an empty rectangle (the right too)', r'''  dst.left = dst.top = dst.right = dst.bottom = 0;
  return false;''', r'''  dst.left = dst.top = dst.bottom = 0;
  return false;''')
m(RC, 'intersectRect: no common part is false', r'''  dst.left = dst.top = dst.right = dst.bottom = 0;
  return false;''', r'''  dst.left = dst.top = dst.right = dst.bottom = 0;
  return true;''')

# ---- editbox.ts: PlaceCaret
EB = 'editbox.ts'
m(EB, 'PlaceCaret: the caret is stored', r'''    this.m_nCaret = nCP;
    const nX1st''', r'''    const nX1st''')
m(EB, 'PlaceCaret: the caret is the one given', r'''    this.m_nCaret = nCP;
    const nX1st''', r'''    this.m_nCaret = 0;
    const nX1st''')
m(EB, 'PlaceCaret: the x of the first visible character', r'''const nX1st = b.CPtoX(this.m_nFirstVisible, false);''', r'''const nX1st = b.CPtoX(0, false);''')
m(EB, 'PlaceCaret: the x of the first visible character (not of the caret)', r'''const nX1st = b.CPtoX(this.m_nFirstVisible, false);''', r'''const nX1st = b.CPtoX(nCP, false);''')
m(EB, 'PlaceCaret: no trail for the first visible character', r'''const nX1st = b.CPtoX(this.m_nFirstVisible, false);''', r'''const nX1st = b.CPtoX(this.m_nFirstVisible, true);''')
m(EB, 'PlaceCaret: the x of the caret', r'''const nX = b.CPtoX(nCP, false);''', r'''const nX = b.CPtoX(0, false);''')
m(EB, 'PlaceCaret: the x of the caret (not of the first visible character)', r'''const nX = b.CPtoX(nCP, false);''', r'''const nX = b.CPtoX(this.m_nFirstVisible, false);''')
m(EB, 'PlaceCaret: no trail for the caret', r'''const nX = b.CPtoX(nCP, false);''', r'''const nX = b.CPtoX(nCP, true);''')
m(EB, 'PlaceCaret: the trailing x is asked with the trail', r'''b.CPtoX(nCP, true);
    if (nX >= nX1st)''', r'''b.CPtoX(nCP, false);
    if (nX >= nX1st)''')
m(EB, 'PlaceCaret: the trailing x is the caret\'s', r'''b.CPtoX(nCP, true);
    if (nX >= nX1st)''', r'''b.CPtoX(this.m_nFirstVisible, true);
    if (nX >= nX1st)''')
m(EB, 'PlaceCaret: the end of the text has no trail asked', r'''const nX2 = nCP === b.GetTextSize() ? nX : b.CPtoX(nCP, true);''', r'''const nX2 = nCP !== b.GetTextSize() ? nX : b.CPtoX(nCP, true);''')
m(EB, 'PlaceCaret: always the trail', r'''const nX2 = nCP === b.GetTextSize() ? nX : b.CPtoX(nCP, true);''', r'''const nX2 = b.CPtoX(nCP, true);''')
m(EB, 'PlaceCaret: never the trail', r'''const nX2 = nCP === b.GetTextSize() ? nX : b.CPtoX(nCP, true);''', r'''const nX2 = nX;''')
m(EB, 'PlaceCaret: the end of the text is the size of the text', r'''const nX2 = nCP === b.GetTextSize() ? nX : b.CPtoX(nCP, true);''', r'''const nX2 = nCP === 0 ? nX : b.CPtoX(nCP, true);''')
m(EB, 'PlaceCaret: the end of the text is the caret at the size or beyond', r'''const nX2 = nCP === b.GetTextSize() ? nX : b.CPtoX(nCP, true);''', r'''const nX2 = nCP >= b.GetTextSize() ? nX : b.CPtoX(nCP, true);''',
  'equivalent: a caret is never beyond the text (the text boxes put it between 0 and the size)')
m(EB, 'PlaceCaret: a caret at the first visible character stays', r'''if (nX >= nX1st) {''', r'''if (nX > nX1st) {''')
m(EB, 'PlaceCaret: a caret left of the first visible character moves it', r'''if (nX >= nX1st) {''', r'''if (nX <= nX1st) {''')
m(EB, 'PlaceCaret: a caret left of the first visible character moves it (not right of it)', r'''if (nX >= nX1st) {''', r'''if (nX < nX1st) {''')
m(EB, 'PlaceCaret: the width of the text rectangle is right minus left', r'''if (nX2 > nX1st + this.m_rcText.right - left) {''', r'''if (nX2 > nX1st + this.m_rcText.right + left) {''')
m(EB, 'PlaceCaret: the width is from the first visible character', r'''if (nX2 > nX1st + this.m_rcText.right - left) {''', r'''if (nX2 > this.m_rcText.right - left) {''')
m(EB, 'PlaceCaret: the width is of the right side', r'''if (nX2 > nX1st + this.m_rcText.right - left) {''', r'''if (nX2 > nX1st + this.m_rcText.left - left) {''')
m(EB, 'PlaceCaret: the trailing x past the right side scrolls', r'''if (nX2 > nX1st + this.m_rcText.right - left) {''', r'''if (nX2 >= nX1st + this.m_rcText.right - left) {''')
m(EB, 'PlaceCaret: the trailing x scrolls, not the x', r'''if (nX2 > nX1st + this.m_rcText.right - left) {''', r'''if (nX > nX1st + this.m_rcText.right - left) {''')
m(EB, 'PlaceCaret: a trailing x short of the right side does not scroll', r'''if (nX2 > nX1st + this.m_rcText.right - left) {''', r'''if (nX2 < nX1st + this.m_rcText.right - left) {''')
m(EB, 'PlaceCaret: the new first x is the trailing x plus left minus right', r'''const nXNewLeft = nX2 + left - this.m_rcText.right;''', r'''const nXNewLeft = nX2 + this.m_rcText.right - left;''')
m(EB, 'PlaceCaret: the new first x is from the trailing x', r'''const nXNewLeft = nX2 + left - this.m_rcText.right;''', r'''const nXNewLeft = nX + left - this.m_rcText.right;''')
m(EB, 'PlaceCaret: the new first x is the trailing x moved to the left side', r'''const nXNewLeft = nX2 + left - this.m_rcText.right;''', r'''const nXNewLeft = nX2 - this.m_rcText.right;''')
m(EB, 'PlaceCaret: the new first x is the trailing x moved by the right side', r'''const nXNewLeft = nX2 + left - this.m_rcText.right;''', r'''const nXNewLeft = nX2 + left;''')
m(EB, 'PlaceCaret: the character at the new first x is XtoCP of it', r'''const { cp } = b.XtoCP(nXNewLeft);''', r'''const { cp } = b.XtoCP(nX2);''')
m(EB, 'PlaceCaret: the character at the new first x is XtoCP of it (not of the old)', r'''const { cp } = b.XtoCP(nXNewLeft);''', r'''const { cp } = b.XtoCP(nX1st);''')
m(EB, 'PlaceCaret: the x of that character', r'''const nXNew1st = b.CPtoX(cp, false);''', r'''const nXNew1st = b.CPtoX(cp, true);''')
m(EB, 'PlaceCaret: the x of that character (not of the caret)', r'''const nXNew1st = b.CPtoX(cp, false);''', r'''const nXNew1st = b.CPtoX(nCP, false);''')
m(EB, 'PlaceCaret: a character short of the new first x is skipped', r'''this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 1 : cp;''', r'''this.m_nFirstVisible = nXNew1st <= nXNewLeft ? cp + 1 : cp;''')
m(EB, 'PlaceCaret: a character beyond the new first x is not skipped', r'''this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 1 : cp;''', r'''this.m_nFirstVisible = nXNew1st > nXNewLeft ? cp + 1 : cp;''')
m(EB, 'PlaceCaret: skipped is one more', r'''this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 1 : cp;''', r'''this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 2 : cp;''')
m(EB, 'PlaceCaret: the first visible character is stored', r'''this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 1 : cp;''', r'''this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 1 : this.m_nFirstVisible;''')
m(EB, 'PlaceCaret: the first visible character is the caret when it is left of it', r'''    } else {
      this.m_nFirstVisible = nCP;
    }''', r'''    } else {
      this.m_nFirstVisible = 0;
    }''')
m(EB, 'PlaceCaret: the first visible character is moved when the caret is left of it', r'''    } else {
      this.m_nFirstVisible = nCP;
    }''', r'''    }''')

# ---- editbox.ts: DrawRect
m(EB, 'DrawRect: a box in no dialog is an Error', r'''    if (!dialog) throw new Error("CKTDGUIEditBox::DrawRect: the box is in no dialog (the exe's handle answers a null object)");
''', '')
m(EB, 'DrawRect: the scale without a render is 1 (nothing is drawn: the scale is not seen)', r'''const sx = render ? render.resolutionScale.x : 1, sy = render ? render.resolutionScale.y : 1;''', r'''const sx = render ? render.resolutionScale.x : 2, sy = render ? render.resolutionScale.y : 2;''',
  'equivalent: without a render the quad is not drawn (an error is logged), so the scale it was made with is never seen')
m(EB, 'DrawRect: the x scale', r'''const sx = render ? render.resolutionScale.x : 1, sy = render ? render.resolutionScale.y : 1;''', r'''const sx = render ? render.resolutionScale.y : 1, sy = render ? render.resolutionScale.y : 1;''')
m(EB, 'DrawRect: the y scale', r'''const sx = render ? render.resolutionScale.x : 1, sy = render ? render.resolutionScale.y : 1;''', r'''const sx = render ? render.resolutionScale.x : 1, sy = render ? render.resolutionScale.x : 1;''')
m(EB, 'DrawRect: the dialog\'s x is scaled', r'''const px = f(sx * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.y);''', r'''const px = f(sx * dialog.m_Pos.y), py = f(sy * dialog.m_Pos.y);''')
m(EB, 'DrawRect: the dialog\'s y is scaled', r'''const px = f(sx * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.y);''', r'''const px = f(sx * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.x);''')
m(EB, 'DrawRect: the dialog\'s x is scaled by the x scale', r'''const px = f(sx * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.y);''', r'''const px = f(sy * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.y);''')
m(EB, 'DrawRect: the dialog\'s y is scaled by the y scale', r'''const px = f(sx * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.y);''', r'''const px = f(sx * dialog.m_Pos.x), py = f(sx * dialog.m_Pos.y);''')
m(EB, 'DrawRect: the dialog\'s x is a float', r'''const px = f(sx * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.y);''', r'''const px = sx * dialog.m_Pos.x, py = f(sy * dialog.m_Pos.y);''')
m(EB, 'DrawRect: the dialog\'s y is a float', r'''const px = f(sx * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.y);''', r'''const px = f(sx * dialog.m_Pos.x), py = sy * dialog.m_Pos.y;''')
m(EB, 'DrawRect: left is the left', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = ftoi(f(f(f(prcDest.right) * sx) + px));''')
m(EB, 'DrawRect: left is scaled by the x scale', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = ftoi(f(f(f(prcDest.left) * sy) + px));''')
m(EB, 'DrawRect: left is moved by the dialog', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + py));''')
m(EB, 'DrawRect: left is a sum', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = ftoi(f(f(f(prcDest.left) * sx) - px));''')
m(EB, 'DrawRect: left is cut, not rounded', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = Math.round(f(f(f(prcDest.left) * sx) + px));''')
m(EB, 'DrawRect: left is cut towards 0, not down', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = Math.floor(f(f(f(prcDest.left) * sx) + px));''')
m(EB, 'DrawRect: the sum of left is a float', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = ftoi(f(f(prcDest.left) * sx) + px);''')
m(EB, 'DrawRect: the product of left is a float', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = ftoi(f(f(prcDest.left) * sx + px));''')
m(EB, 'DrawRect: left is a float before it is scaled', r'''const left = ftoi(f(f(f(prcDest.left) * sx) + px));''', r'''const left = ftoi(f(f(prcDest.left * sx) + px));''')
m(EB, 'DrawRect: top is the top', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = ftoi(f(f(f(prcDest.bottom) * sy) + py));''')
m(EB, 'DrawRect: top is scaled by the y scale', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = ftoi(f(f(f(prcDest.top) * sx) + py));''')
m(EB, 'DrawRect: top is moved by the dialog', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + px));''')
m(EB, 'DrawRect: top is a sum', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = ftoi(f(f(f(prcDest.top) * sy) - py));''')
m(EB, 'DrawRect: top is cut, not rounded', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = Math.round(f(f(f(prcDest.top) * sy) + py));''')
m(EB, 'DrawRect: top is cut towards 0, not down', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = Math.floor(f(f(f(prcDest.top) * sy) + py));''')
m(EB, 'DrawRect: the sum of top is a float', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = ftoi(f(f(prcDest.top) * sy) + py);''')
m(EB, 'DrawRect: the product of top is a float', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = ftoi(f(f(prcDest.top) * sy + py));''')
m(EB, 'DrawRect: top is a float before it is scaled', r'''const top = ftoi(f(f(f(prcDest.top) * sy) + py));''', r'''const top = ftoi(f(f(prcDest.top * sy) + py));''')
m(EB, 'DrawRect: right is the right', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = ftoi(f(f(f(prcDest.left) * sx) + px));''')
m(EB, 'DrawRect: right is scaled by the x scale', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = ftoi(f(f(f(prcDest.right) * sy) + px));''')
m(EB, 'DrawRect: right is moved by the dialog', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + py));''')
m(EB, 'DrawRect: right is a sum', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = ftoi(f(f(f(prcDest.right) * sx) - px));''')
m(EB, 'DrawRect: right is cut, not rounded', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = Math.round(f(f(f(prcDest.right) * sx) + px));''')
m(EB, 'DrawRect: right is cut towards 0, not down', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = Math.floor(f(f(f(prcDest.right) * sx) + px));''')
m(EB, 'DrawRect: the sum of right is a float', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = ftoi(f(f(prcDest.right) * sx) + px);''')
m(EB, 'DrawRect: the product of right is a float', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = ftoi(f(f(prcDest.right) * sx + px));''')
m(EB, 'DrawRect: right is a float before it is scaled', r'''const right = ftoi(f(f(f(prcDest.right) * sx) + px));''', r'''const right = ftoi(f(f(prcDest.right * sx) + px));''')
m(EB, 'DrawRect: bottom is the bottom', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = ftoi(f(f(f(prcDest.top) * sy) + py));''')
m(EB, 'DrawRect: bottom is scaled by the y scale', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sx) + py));''')
m(EB, 'DrawRect: bottom is moved by the dialog', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + px));''')
m(EB, 'DrawRect: bottom is a sum', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) - py));''')
m(EB, 'DrawRect: bottom is cut, not rounded', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = Math.round(f(f(f(prcDest.bottom) * sy) + py));''')
m(EB, 'DrawRect: bottom is cut towards 0, not down', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = Math.floor(f(f(f(prcDest.bottom) * sy) + py));''')
m(EB, 'DrawRect: the sum of bottom is a float', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = ftoi(f(f(prcDest.bottom) * sy) + py);''')
m(EB, 'DrawRect: the product of bottom is a float', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = ftoi(f(f(prcDest.bottom) * sy + py));''')
m(EB, 'DrawRect: bottom is a float before it is scaled', r'''const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));''', r'''const bottom = ftoi(f(f(prcDest.bottom * sy) + py));''')
m(EB, 'DrawRect: a vertex is half a pixel up and left', r'''const x0 = f(f(left) - 0.5), x1 = f(f(right) - 0.5), y0 = f(f(top) - 0.5), y1 = f(f(bottom) - 0.5);''', r'''const x0 = f(f(left)), x1 = f(f(right)), y0 = f(f(top)), y1 = f(f(bottom));''')
m(EB, 'DrawRect: a vertex is half a pixel up and left (not down and right)', r'''const x0 = f(f(left) - 0.5), x1 = f(f(right) - 0.5), y0 = f(f(top) - 0.5), y1 = f(f(bottom) - 0.5);''', r'''const x0 = f(f(left) + 0.5), x1 = f(f(right) + 0.5), y0 = f(f(top) + 0.5), y1 = f(f(bottom) + 0.5);''')
m(EB, 'DrawRect: x0 is the left', r'''const x0 = f(f(left) - 0.5), x1''', r'''const x0 = f(f(right) - 0.5), x1''')
m(EB, 'DrawRect: x1 is the right', r'''x1 = f(f(right) - 0.5), y0''', r'''x1 = f(f(left) - 0.5), y0''')
m(EB, 'DrawRect: y0 is the top', r'''y0 = f(f(top) - 0.5), y1''', r'''y0 = f(f(bottom) - 0.5), y1''')
m(EB, 'DrawRect: y1 is the bottom', r'''y1 = f(f(bottom) - 0.5);''', r'''y1 = f(f(top) - 0.5);''')
m(EB, 'DrawRect: the x of a vertex is a float', r'''const x0 = f(f(left) - 0.5), x1''', r'''const x0 = f(left) - 0.5, x1''',
  'equivalent: the vertex stores its x in a float, which rounds the same')
m(EB, 'DrawRect: the side is a float before the half pixel goes off', r'''const x0 = f(f(left) - 0.5), x1''', r'''const x0 = f(left - 0.5), x1''',
  'equivalent: the side was cut from a float: it is a whole number a float holds exactly')
m(EB, 'DrawRect: the corners are left-top, right-top, left-bottom, right-bottom', r'''const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const;''', r'''const corners = [[x0, y0], [x0, y1], [x1, y0], [x1, y1]] as const;''')
m(EB, 'DrawRect: the corners (the x of the second)', r'''const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const;''', r'''const corners = [[x0, y0], [x0, y0], [x0, y1], [x1, y1]] as const;''')
m(EB, 'DrawRect: the corners (the y of the third)', r'''const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const;''', r'''const corners = [[x0, y0], [x1, y0], [x0, y0], [x1, y1]] as const;''')
m(EB, 'DrawRect: the corners (the last)', r'''const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const;''', r'''const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y0]] as const;''')
m(EB, 'DrawRect: a vertex has an x', r'''      quad.setX(i, corners[i]![0]);
''', '')
m(EB, 'DrawRect: a vertex has a y', r'''      quad.setY(i, corners[i]![1]);
''', '')
m(EB, 'DrawRect: z is 0.5', r'''quad.setZ(i, 0.5);''', r'''quad.setZ(i, 1);''')
m(EB, 'DrawRect: z is set', r'''      quad.setZ(i, 0.5);
''', '')
m(EB, 'DrawRect: rhw is 1', r'''quad.setRhw(i, 1);''', r'''quad.setRhw(i, 0.5);''')
m(EB, 'DrawRect: rhw is set', r'''      quad.setRhw(i, 1);
''', '')
m(EB, 'DrawRect: the colour is set', r'''      quad.setColor(i, color);
''', '')
m(EB, 'DrawRect: the colour is the colour given', r'''quad.setColor(i, color);''', r'''quad.setColor(i, 0xffffffff);''')
m(EB, 'DrawRect: u is 0', r'''quad.setU(i, 0);''', r'''quad.setU(i, 1);''')
m(EB, 'DrawRect: v is 0', r'''quad.setV(i, 0);''', r'''quad.setV(i, 1);''')
m(EB, 'DrawRect: the vertex buffer has four vertices', r'''for (let i = 0; i < 4; i++) {
      quad.setX(i, corners[i]![0]);''', r'''for (let i = 0; i < 3; i++) {
      quad.setX(i, corners[i]![0]);''')
m(EB, 'DrawRect: the stage state is pushed on a stack that was empty or not', r'''const top0 = states?.stackPointer ?? 0;''', r'''const top0 = 0;''')
m(EB, 'DrawRect: the colour operation is SELECTARG2', r'''states?.setTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG2);''', r'''states?.setTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1);''')
m(EB, 'DrawRect: the colour operation is set', r'''    states?.setTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG2);
''', '')
m(EB, 'DrawRect: the colour operation is of stage 0', r'''states?.setTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG2);''', r'''states?.setTextureStageState(1, D3DTSS.COLOROP, D3DTOP.SELECTARG2);''')
m(EB, 'DrawRect: the colour operation is the colour operation', r'''states?.setTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG2);''', r'''states?.setTextureStageState(0, D3DTSS.COLORARG1, D3DTOP.SELECTARG2);''')
m(EB, 'DrawRect: the alpha operation is SELECTARG2', r'''states?.setTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG2);''', r'''states?.setTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG1);''')
m(EB, 'DrawRect: the alpha operation is set', r'''    states?.setTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG2);
''', '')
m(EB, 'DrawRect: the alpha operation is of stage 0', r'''states?.setTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG2);''', r'''states?.setTextureStageState(1, D3DTSS.ALPHAOP, D3DTOP.SELECTARG2);''')
m(EB, 'DrawRect: the alpha operation is the alpha operation', r'''states?.setTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG2);''', r'''states?.setTextureStageState(0, D3DTSS.ALPHAARG1, D3DTOP.SELECTARG2);''')
m(EB, 'DrawRect: the quad keeps the vertex declaration', r'''this.renderVertex(quad, true);''', r'''this.renderVertex(quad, false);''')
m(EB, 'DrawRect: the quad is drawn', r'''    this.renderVertex(quad, true);
''', '')
m(EB, 'DrawRect: the operations go back to MODULATE', r'''    states?.set(MODULATE_OPERATIONS);
''', '')
m(EB, 'DrawRect: the old states come back', r'''    states?.popTo(top0);
''', '')
m(EB, 'DrawRect: the states come back to where they were', r'''states?.popTo(top0);''', r'''states?.popTo(top0 + 1);''')
m(EB, 'MODULATE_OPERATIONS: the colour operation', r'''{ m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },''', r'''{ m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.SELECTARG1 },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },''')
m(EB, 'MODULATE_OPERATIONS: the alpha operation', r'''{ m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },''', r'''{ m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.SELECTARG1 },''')
m(EB, 'MODULATE_OPERATIONS: the colour operation is of the colour', r'''m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE },''', r'''m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },''')
m(EB, 'MODULATE_OPERATIONS: the alpha operation is of the alpha', r'''m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },
];''', r'''m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE },
];''')

# ---- editbox.ts: DrawTextW
m(EB, 'DrawTextW: a box in no dialog is an Error', r'''    if (!dialog) throw new Error("CKTDGUIEditBox::DrawTextW: the box is in no dialog (the exe's handle answers a null object)");
''', '')
m(EB, 'DrawTextW: the rectangle is the one given (left)', r'''const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };''', r'''const rcScreen: Rect = { left: prcDest.right, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };''')
m(EB, 'DrawTextW: the rectangle is the one given (top)', r'''const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };''', r'''const rcScreen: Rect = { left: prcDest.left, top: prcDest.bottom, right: prcDest.right, bottom: prcDest.bottom };''')
m(EB, 'DrawTextW: the rectangle is the one given (right)', r'''const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };''', r'''const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.left, bottom: prcDest.bottom };''')
m(EB, 'DrawTextW: the rectangle is the one given (bottom)', r'''const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };''', r'''const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.top };''')
m(EB, 'DrawTextW: the rectangle is a copy', r'''const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };''', r'''const rcScreen: Rect = prcDest;''')
m(EB, 'DrawTextW: the rectangle is moved', r'''    offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)), ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));
''', '')
m(EB, 'DrawTextW: the x is the dialog\'s plus the offset', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)),''', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x - this.m_OffsetPos.x)),''')
m(EB, 'DrawTextW: the x is the dialog\'s x', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)),''', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.x)),''')
m(EB, 'DrawTextW: the x is the offset\'s x', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)),''', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.y)),''')
m(EB, 'DrawTextW: the x is cut, not rounded', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)),''', r'''offsetRect(rcScreen, Math.round(f(dialog.m_Pos.x + this.m_OffsetPos.x)),''')
m(EB, 'DrawTextW: the x is cut towards 0, not down', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)),''', r'''offsetRect(rcScreen, Math.floor(f(dialog.m_Pos.x + this.m_OffsetPos.x)),''')
m(EB, 'DrawTextW: the sum of x is a float', r'''offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)),''', r'''offsetRect(rcScreen, ftoi(dialog.m_Pos.x + this.m_OffsetPos.x),''')
m(EB, 'DrawTextW: the y is the dialog\'s plus the offset', r'''ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));''', r'''ftoi(f(dialog.m_Pos.y - this.m_OffsetPos.y)));''')
m(EB, 'DrawTextW: the y is the dialog\'s y', r'''ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));''', r'''ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.y)));''')
m(EB, 'DrawTextW: the y is the offset\'s y', r'''ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));''', r'''ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.x)));''')
m(EB, 'DrawTextW: the y is cut, not rounded', r'''ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));''', r'''Math.round(f(dialog.m_Pos.y + this.m_OffsetPos.y)));''')
m(EB, 'DrawTextW: the y is cut towards 0, not down', r'''ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));''', r'''Math.floor(f(dialog.m_Pos.y + this.m_OffsetPos.y)));''')
m(EB, 'DrawTextW: the sum of y is a float', r'''ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));''', r'''ftoi(dialog.m_Pos.y + this.m_OffsetPos.y));''')
m(EB, 'DrawTextW: a box without a font draws nothing of an empty text', r'''if (wcslen(strText) === 0 || nCount === 0) return 0;''', r'''if (wcslen(strText) === 0 && nCount === 0) return 0;''')
m(EB, 'DrawTextW: a box without a font draws nothing of a text it is told to draw none of', r'''if (wcslen(strText) === 0 || nCount === 0) return 0;''', r'''if (wcslen(strText) === 0) return 0;''')
m(EB, 'DrawTextW: a box without a font draws nothing of an empty text (not of a text)', r'''if (wcslen(strText) === 0 || nCount === 0) return 0;''', r'''if (nCount === 0) return 0;''')
m(EB, 'DrawTextW: a box without a font and a text to draw is an Error', r'''if (wcslen(strText) === 0 || nCount === 0) return 0;
      throw new Error''', r'''return 0;
      throw new Error''')
m(EB, 'DrawTextW: a count of 0 is 0 (not 1)', r'''if (wcslen(strText) === 0 || nCount === 0) return 0;''', r'''if (wcslen(strText) === 0 || nCount === 1) return 0;''')
m(EB, 'DrawTextW: the font draws', r'''    font.DrawTextFont(strText, rcScreen, nCount, this.m_NowFontColor, this.m_bOutlineCheck, this.m_OutlineColor, format);
''', '')
m(EB, 'DrawTextW: the font draws the text', r'''font.DrawTextFont(strText, rcScreen, nCount,''', r'''font.DrawTextFont("", rcScreen, nCount,''')
m(EB, 'DrawTextW: the font draws in the rectangle', r'''font.DrawTextFont(strText, rcScreen, nCount,''', r'''font.DrawTextFont(strText, prcDest, nCount,''')
m(EB, 'DrawTextW: the font draws the count', r'''font.DrawTextFont(strText, rcScreen, nCount,''', r'''font.DrawTextFont(strText, rcScreen, -1,''')
m(EB, 'DrawTextW: the font draws in the font colour', r'''nCount, this.m_NowFontColor, this.m_bOutlineCheck,''', r'''nCount, this.m_OutlineColor, this.m_bOutlineCheck,''')
m(EB, 'DrawTextW: the font draws with the outline when it is on', r'''this.m_bOutlineCheck, this.m_OutlineColor, format);''', r'''false, this.m_OutlineColor, format);''')
m(EB, 'DrawTextW: the font draws with the outline when it is on (not always)', r'''this.m_bOutlineCheck, this.m_OutlineColor, format);''', r'''true, this.m_OutlineColor, format);''')
m(EB, 'DrawTextW: the font draws with the outline colour', r'''this.m_bOutlineCheck, this.m_OutlineColor, format);''', r'''this.m_bOutlineCheck, this.m_NowFontColor, format);''')
m(EB, 'DrawTextW: the font draws with the format', r'''this.m_OutlineColor, format);''', r'''this.m_OutlineColor, 0);''')

# ---- editbox.ts: setFontColor
m(EB, 'setFontColor: the red is the third byte', r'''c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''', r'''c.r = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);''')
m(EB, 'setFontColor: the red is a byte', r'''c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''', r'''c.r = f(f((packed >>> 16) & 0x7f) * ONE_OVER_255);''')
m(EB, 'setFontColor: the red is a byte, of the colour', r'''c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''', r'''c.r = f(f(packed >>> 16) * ONE_OVER_255);''')
m(EB, 'setFontColor: the red is times 1/255', r'''c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''', r'''c.r = f(f((packed >>> 16) & 0xff) / 255);''')
m(EB, 'setFontColor: the red is times the float 1/255', r'''c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''', r'''c.r = f(f((packed >>> 16) & 0xff) * (1 / 255));''')
m(EB, 'setFontColor: the red is a float', r'''c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''', r'''c.r = f((packed >>> 16) & 0xff) * ONE_OVER_255;''',
  'equivalent: the colour keeps its channels in a Float32Array, which rounds the product to a float all the same')
m(EB, 'setFontColor: the red byte is a float', r'''c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''', r'''c.r = f(((packed >>> 16) & 0xff) * ONE_OVER_255);''',
  'equivalent: a byte is an int a float holds exactly')
m(EB, 'setFontColor: the green is the second byte', r'''c.g = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);''', r'''c.g = f(f(packed & 0xff) * ONE_OVER_255);''')
m(EB, 'setFontColor: the green is a byte', r'''c.g = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);''', r'''c.g = f(f((packed >>> 8) & 0x7f) * ONE_OVER_255);''')
m(EB, 'setFontColor: the green is a byte, of the colour', r'''c.g = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);''', r'''c.g = f(f(packed >>> 8) * ONE_OVER_255);''')
m(EB, 'setFontColor: the green is times 1/255', r'''c.g = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);''', r'''c.g = f(f((packed >>> 8) & 0xff) / 255);''')
m(EB, 'setFontColor: the green is times the float 1/255', r'''c.g = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);''', r'''c.g = f(f((packed >>> 8) & 0xff) * (1 / 255));''')
m(EB, 'setFontColor: the green is a float', r'''c.g = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);''', r'''c.g = f((packed >>> 8) & 0xff) * ONE_OVER_255;''',
  'equivalent: the colour keeps its channels in a Float32Array, which rounds the product to a float all the same')
m(EB, 'setFontColor: the blue is the first byte', r'''c.b = f(f(packed & 0xff) * ONE_OVER_255);''', r'''c.b = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''')
m(EB, 'setFontColor: the blue is a byte', r'''c.b = f(f(packed & 0xff) * ONE_OVER_255);''', r'''c.b = f(f(packed & 0x7f) * ONE_OVER_255);''')
m(EB, 'setFontColor: the blue is a byte, of the colour', r'''c.b = f(f(packed & 0xff) * ONE_OVER_255);''', r'''c.b = f(f(packed) * ONE_OVER_255);''')
m(EB, 'setFontColor: the blue is times 1/255', r'''c.b = f(f(packed & 0xff) * ONE_OVER_255);''', r'''c.b = f(f(packed & 0xff) / 255);''')
m(EB, 'setFontColor: the blue is times the float 1/255', r'''c.b = f(f(packed & 0xff) * ONE_OVER_255);''', r'''c.b = f(f(packed & 0xff) * (1 / 255));''')
m(EB, 'setFontColor: the blue is a float', r'''c.b = f(f(packed & 0xff) * ONE_OVER_255);''', r'''c.b = f(packed & 0xff) * ONE_OVER_255;''',
  'equivalent: the colour keeps its channels in a Float32Array, which rounds the product to a float all the same')
m(EB, 'setFontColor: the alpha is the last byte', r'''c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);''', r'''c.a = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);''')
m(EB, 'setFontColor: the alpha is a byte', r'''c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);''', r'''c.a = f(f((packed >>> 24) & 0x7f) * ONE_OVER_255);''')
m(EB, 'setFontColor: the alpha is a byte, of the unsigned colour', r'''c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);''', r'''c.a = f(f(packed >>> 24) * ONE_OVER_255);''',
  'equivalent: an unsigned shift by 24 leaves a byte, so the mask changes nothing')
m(EB, 'setFontColor: the alpha is of the unsigned colour', r'''c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);''', r'''c.a = f(f((packed >> 24) & 0xff) * ONE_OVER_255);''',
  'equivalent: the mask makes the byte the same whether the shift keeps the sign or not')
m(EB, 'setFontColor: the alpha is times 1/255', r'''c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);''', r'''c.a = f(f((packed >>> 24) & 0xff) / 255);''')
m(EB, 'setFontColor: the alpha is times the float 1/255', r'''c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);''', r'''c.a = f(f((packed >>> 24) & 0xff) * (1 / 255));''')
m(EB, 'setFontColor: the alpha is a float', r'''c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);''', r'''c.a = f((packed >>> 24) & 0xff) * ONE_OVER_255;''',
  'equivalent: the colour keeps its channels in a Float32Array, which rounds the product to a float all the same')
m(EB, 'setFontColor: the font colour is the box\'s', r'''const c = this.m_NowFontColor;
    c.r =''', r'''const c = this.m_OutlineColor;
    c.r =''')

# ---- editbox.ts: onFrameRender
m(EB, 'onFrameRender: a hidden box draws nothing', r'''    if (!this.m_bShow) return 0;
    const buffer = this.m_Buffer;''', r'''    const buffer = this.m_Buffer;''')
m(EB, 'onFrameRender: a shown box draws', r'''    if (!this.m_bShow) return 0;
    const buffer = this.m_Buffer;''', r'''    if (this.m_bShow) return 0;
    const buffer = this.m_Buffer;''')
m(EB, 'onFrameRender: the buffer measures with the box\'s font', r'''    buffer.m_pFontNode = this.m_pFont;
''', '')
m(EB, 'onFrameRender: the caret is placed', r'''    this.PlaceCaret(this.m_nCaret);
    if (this.m_bBGCheck) {''', r'''    if (this.m_bBGCheck) {''')
m(EB, 'onFrameRender: the caret that is placed is the caret', r'''    this.PlaceCaret(this.m_nCaret);
    if (this.m_bBGCheck) {''', r'''    this.PlaceCaret(this.m_nSelStart);
    if (this.m_bBGCheck) {''')
m(EB, 'onFrameRender: a box with a background draws it', r'''    if (this.m_bBGCheck) {
      this.updateVertex(this.m_Vertex, this.m_NowPoint);''', r'''    if (!this.m_bBGCheck) {
      this.updateVertex(this.m_Vertex, this.m_NowPoint);''')
m(EB, 'onFrameRender: the background is a quad of the current point', r'''      this.updateVertex(this.m_Vertex, this.m_NowPoint);
      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);''', r'''      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);''')
m(EB, 'onFrameRender: the background quad is rendered', r'''      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);
    }
    const text''', r'''    }
    const text''')
m(EB, 'onFrameRender: the background quad is the box\'s', r'''      this.updateVertex(this.m_Vertex, this.m_NowPoint);
      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);''', r'''      this.updateVertex(this.m_Vertex, this.m_NowPoint);
      this.renderVertex(new VertexUI4(), this.m_NowPoint, 1);''')
m(EB, 'onFrameRender: the background is one quad', r'''this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);''', r'''this.renderVertex(this.m_Vertex, this.m_NowPoint, 2);''')
m(EB, 'onFrameRender: the background is drawn from the point (not from nothing)', r'''this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);''', r'''this.renderVertex(this.m_Vertex, this.m_NowPoint, 0);''')
m(EB, 'onFrameRender: the text rectangle', r'''    const text = this.m_rcText;
    const nXFirst''', r'''    const text = newRect();
    const nXFirst''')
m(EB, 'onFrameRender: the x of the first visible character', r'''const nXFirst = buffer.CPtoX(this.m_nFirstVisible, false);''', r'''const nXFirst = buffer.CPtoX(0, false);''')
m(EB, 'onFrameRender: the x of the first visible character has no trail', r'''const nXFirst = buffer.CPtoX(this.m_nFirstVisible, false);''', r'''const nXFirst = buffer.CPtoX(this.m_nFirstVisible, true);''')
m(EB, 'onFrameRender: the x of the first visible character (not of the caret)', r'''const nXFirst = buffer.CPtoX(this.m_nFirstVisible, false);''', r'''const nXFirst = buffer.CPtoX(this.m_nCaret, false);''')
m(EB, 'onFrameRender: the x of the caret', r'''const nCaretX = buffer.CPtoX(this.m_nCaret, false);''', r'''const nCaretX = buffer.CPtoX(0, false);''')
m(EB, 'onFrameRender: the x of the caret has no trail', r'''const nCaretX = buffer.CPtoX(this.m_nCaret, false);''', r'''const nCaretX = buffer.CPtoX(this.m_nCaret, true);''')
m(EB, 'onFrameRender: the x of the caret (not of the selection\'s start)', r'''const nCaretX = buffer.CPtoX(this.m_nCaret, false);''', r'''const nCaretX = buffer.CPtoX(this.m_nSelStart, false);''')
m(EB, 'onFrameRender: the selection\'s start x is the caret\'s with no selection', r'''    let nSelStartX = nCaretX;
    if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, false);''', r'''    let nSelStartX = 0;
    if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, false);''',
  'equivalent: nSelStartX is only read when the caret is not at the selection start, which sets it')
m(EB, 'onFrameRender: the selection\'s start x is measured with a selection', r'''if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, false);''', r'''if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nCaret, false);''')
m(EB, 'onFrameRender: the selection\'s start x has no trail', r'''if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, false);''', r'''if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, true);''')
m(EB, 'onFrameRender: the selection\'s start x is not measured without a selection', r'''if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, false);''', r'''nSelStartX = buffer.CPtoX(this.m_nSelStart, false);''')
m(EB, 'onFrameRender: a selection is drawn when the caret is not at its start', r'''    if (this.m_nCaret !== this.m_nSelStart) {
      const left = nCaretX''', r'''    if (this.m_nCaret === this.m_nSelStart) {
      const left = nCaretX''')
m(EB, 'onFrameRender: the selection starts at the smaller x', r'''const left = nCaretX <= nSelStartX ? nCaretX : nSelStartX;''', r'''const left = nCaretX <= nSelStartX ? nSelStartX : nCaretX;''')
m(EB, 'onFrameRender: the selection starts at the smaller x (not the caret\'s)', r'''const left = nCaretX <= nSelStartX ? nCaretX : nSelStartX;''', r'''const left = nCaretX;''')
m(EB, 'onFrameRender: the selection starts at the smaller x (equal x)', r'''const left = nCaretX <= nSelStartX ? nCaretX : nSelStartX;''', r'''const left = nCaretX < nSelStartX ? nCaretX : nSelStartX;''',
  'equivalent: for two x that are equal either one is the smaller')
m(EB, 'onFrameRender: the selection ends at the larger x', r'''const right = nCaretX <= nSelStartX ? nSelStartX : nCaretX;''', r'''const right = nCaretX <= nSelStartX ? nCaretX : nSelStartX;''')
m(EB, 'onFrameRender: the selection ends at the larger x (not the caret\'s)', r'''const right = nCaretX <= nSelStartX ? nSelStartX : nCaretX;''', r'''const right = nCaretX;''')
m(EB, 'onFrameRender: the selection ends at the larger x (equal x)', r'''const right = nCaretX <= nSelStartX ? nSelStartX : nCaretX;''', r'''const right = nCaretX < nSelStartX ? nSelStartX : nCaretX;''',
  'equivalent: for two x that are equal either one is the larger')
m(EB, 'onFrameRender: the selection is as high as the text rectangle (top)', r'''setRect(rcSelection, left, text.top, right, text.bottom);''', r'''setRect(rcSelection, left, text.bottom, right, text.bottom);''')
m(EB, 'onFrameRender: the selection is as high as the text rectangle (bottom)', r'''setRect(rcSelection, left, text.top, right, text.bottom);''', r'''setRect(rcSelection, left, text.top, right, text.top);''')
m(EB, 'onFrameRender: the selection is set', r'''      setRect(rcSelection, left, text.top, right, text.bottom);
''', '')
m(EB, 'onFrameRender: the selection is moved', r'''      offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);
''', '')
m(EB, 'onFrameRender: the selection is moved by the left side minus the first x', r'''offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);''', r'''offsetRect(rcSelection, (text.left + nXFirst) | 0, 0);''')
m(EB, 'onFrameRender: the selection is moved by the text rectangle\'s left', r'''offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);''', r'''offsetRect(rcSelection, (text.right - nXFirst) | 0, 0);''')
m(EB, 'onFrameRender: the selection is moved by the first x', r'''offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);''', r'''offsetRect(rcSelection, (text.left - nCaretX) | 0, 0);''')
m(EB, 'onFrameRender: the selection is not moved down', r'''offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);''', r'''offsetRect(rcSelection, (text.left - nXFirst) | 0, 1);''')
m(EB, 'onFrameRender: the selection is moved by an int', r'''offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);''', r'''offsetRect(rcSelection, (text.left - nXFirst), 0);''',
  'equivalent: a left side and an x are ints, so their difference is an int already')
m(EB, 'onFrameRender: the selection is cut to the text rectangle', r'''      intersectRect(rcSelection, text, rcSelection);
''', '')
m(EB, 'onFrameRender: the selection is cut to the text rectangle (not to itself)', r'''intersectRect(rcSelection, text, rcSelection);''', r'''intersectRect(rcSelection, rcSelection, rcSelection);''')
m(EB, 'onFrameRender: the selection is cut to the text rectangle (not the text rectangle)', r'''intersectRect(rcSelection, text, rcSelection);''', r'''intersectRect(rcSelection, text, text);''')
m(EB, 'onFrameRender: the selection is cut to the text rectangle (the text rectangle stays)', r'''intersectRect(rcSelection, text, rcSelection);''', r'''intersectRect(text, text, rcSelection);''')
m(EB, 'onFrameRender: the selection is drawn', r'''      this.DrawRect(rcSelection, this.m_SelBkColor);
''', '')
m(EB, 'onFrameRender: the selection is drawn in the selection background colour', r'''this.DrawRect(rcSelection, this.m_SelBkColor);''', r'''this.DrawRect(rcSelection, this.m_CaretColor);''')
m(EB, 'onFrameRender: the font colour of the text is the text colour', r'''    this.setFontColor(this.m_TextColor);
    const typed''', r'''    this.setFontColor(this.m_SelTextColor);
    const typed''')
m(EB, 'onFrameRender: the font colour of the text is set', r'''    this.setFontColor(this.m_TextColor);
    const typed''', r'''    const typed''')
m(EB, 'onFrameRender: a buffer without text (never null)', r'''const typed = buffer.m_pwszBuffer ?? "";''', r'''const typed = buffer.m_pwszBuffer ?? "x";''',
  'equivalent: the buffer the constructor allocates is never null here')
m(EB, 'onFrameRender: a hide character for every character', r'''String.fromCharCode(this.m_HideChar).repeat(buffer.GetTextSize());''', r'''String.fromCharCode(this.m_HideChar).repeat(buffer.GetTextSize() + 1);''')
m(EB, 'onFrameRender: the hide character is the box\'s', r'''String.fromCharCode(this.m_HideChar).repeat(buffer.GetTextSize());''', r'''String.fromCharCode(0x2a).repeat(buffer.GetTextSize());''')
m(EB, 'onFrameRender: a hide character for every character of the text', r'''String.fromCharCode(this.m_HideChar).repeat(buffer.GetTextSize());''', r'''String.fromCharCode(this.m_HideChar).repeat(1);''')
m(EB, 'onFrameRender: a password box shows the hide character', r'''const shown = this.m_bPasswordEditBox ? hidden() : typed;''', r'''const shown = typed;''')
m(EB, 'onFrameRender: a box that is no password box shows its text', r'''const shown = this.m_bPasswordEditBox ? hidden() : typed;''', r'''const shown = hidden();''')
m(EB, 'onFrameRender: a password box shows the hide character (inverted)', r'''const shown = this.m_bPasswordEditBox ? hidden() : typed;''', r'''const shown = !this.m_bPasswordEditBox ? hidden() : typed;''')
m(EB, 'onFrameRender: the text is shown from the first visible character', r'''this.DrawTextW(shown.slice(this.m_nFirstVisible), text, -1, 4);''', r'''this.DrawTextW(shown, text, -1, 4);''')
m(EB, 'onFrameRender: the text is shown from the first visible character (not from the caret)', r'''this.DrawTextW(shown.slice(this.m_nFirstVisible), text, -1, 4);''', r'''this.DrawTextW(shown.slice(this.m_nCaret), text, -1, 4);''')
m(EB, 'onFrameRender: the text is shown in the text rectangle', r'''this.DrawTextW(shown.slice(this.m_nFirstVisible), text, -1, 4);''', r'''this.DrawTextW(shown.slice(this.m_nFirstVisible), rcSelection, -1, 4);''')
m(EB, 'onFrameRender: the text is all of it', r'''this.DrawTextW(shown.slice(this.m_nFirstVisible), text, -1, 4);''', r'''this.DrawTextW(shown.slice(this.m_nFirstVisible), text, 1, 4);''')
m(EB, 'onFrameRender: the text is vertically centred', r'''this.DrawTextW(shown.slice(this.m_nFirstVisible), text, -1, 4);''', r'''this.DrawTextW(shown.slice(this.m_nFirstVisible), text, -1, 0);''')
m(EB, 'onFrameRender: the text is drawn', r'''    this.DrawTextW(shown.slice(this.m_nFirstVisible), text, -1, 4);
''', '')
m(EB, 'onFrameRender: the selected part has its own colour when the caret is not at the selection start', r'''    if (caret !== selStart) {
      const lower''', r'''    if (caret === selStart) {
      const lower''')
m(EB, 'onFrameRender: the selected part starts at the smaller of the caret and the start', r'''const lower = Math.min(caret, selStart);''', r'''const lower = Math.max(caret, selStart);''')
m(EB, 'onFrameRender: the selected part starts at the smaller (not the caret)', r'''const lower = Math.min(caret, selStart);''', r'''const lower = caret;''')
m(EB, 'onFrameRender: the selected part starts at the smaller (not the start)', r'''const lower = Math.min(caret, selStart);''', r'''const lower = selStart;''')
m(EB, 'onFrameRender: the selected part starts at the first visible character or after', r'''const start = this.m_nFirstVisible <= lower ? lower : this.m_nFirstVisible;''', r'''const start = this.m_nFirstVisible < lower ? lower : this.m_nFirstVisible;''',
  'equivalent: for a first visible character that is the lower one either gives it')
m(EB, 'onFrameRender: the selected part starts at the larger of the first visible character and the lower', r'''const start = this.m_nFirstVisible <= lower ? lower : this.m_nFirstVisible;''', r'''const start = this.m_nFirstVisible <= lower ? this.m_nFirstVisible : lower;''')
m(EB, 'onFrameRender: the selected part starts at the lower when it is not before the first visible character', r'''const start = this.m_nFirstVisible <= lower ? lower : this.m_nFirstVisible;''', r'''const start = lower;''')
m(EB, 'onFrameRender: the selected part starts at the first visible character when the lower is before it', r'''const start = this.m_nFirstVisible <= lower ? lower : this.m_nFirstVisible;''', r'''const start = this.m_nFirstVisible;''')
m(EB, 'onFrameRender: the selected part ends at the larger of the caret and the start', r'''const end = Math.max(caret, selStart);''', r'''const end = Math.min(caret, selStart);''')
m(EB, 'onFrameRender: the selected part ends at the larger (not the caret)', r'''const end = Math.max(caret, selStart);''', r'''const end = caret;''')
m(EB, 'onFrameRender: the selected part ends at the larger (not the start)', r'''const end = Math.max(caret, selStart);''', r'''const end = selStart;''')
m(EB, 'onFrameRender: the font colour of the selected part is the selected text colour', r'''      this.setFontColor(this.m_SelTextColor);
      const selected''', r'''      this.setFontColor(this.m_TextColor);
      const selected''')
m(EB, 'onFrameRender: the font colour of the selected part is set', r'''      this.setFontColor(this.m_SelTextColor);
      const selected''', r'''      const selected''')
m(EB, 'onFrameRender: a password box shows the selected part as the hide character', r'''const selected = this.m_bPasswordEditBox ? hidden() : typed;''', r'''const selected = typed;''')
m(EB, 'onFrameRender: a box that is no password box shows the selected part of its text', r'''const selected = this.m_bPasswordEditBox ? hidden() : typed;''', r'''const selected = hidden();''')
m(EB, 'onFrameRender: a password box shows the selected part as the hide character (inverted)', r'''const selected = this.m_bPasswordEditBox ? hidden() : typed;''', r'''const selected = !this.m_bPasswordEditBox ? hidden() : typed;''')
m(EB, 'onFrameRender: the selected part is shown from where it starts', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);''', r'''this.DrawTextW(selected.slice(lower), rcSelection, (end - start) | 0, 4);''')
m(EB, 'onFrameRender: the selected part is shown from where it starts (not from the first visible character)', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);''', r'''this.DrawTextW(selected.slice(this.m_nFirstVisible), rcSelection, (end - start) | 0, 4);''')
m(EB, 'onFrameRender: the selected part is shown in the selection rectangle', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);''', r'''this.DrawTextW(selected.slice(start), text, (end - start) | 0, 4);''')
m(EB, 'onFrameRender: the selected part has the characters from its start to its end', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);''', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - lower) | 0, 4);''')
m(EB, 'onFrameRender: the selected part has the characters from its start to its end (not to the caret)', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);''', r'''this.DrawTextW(selected.slice(start), rcSelection, (caret - start) | 0, 4);''')
m(EB, 'onFrameRender: the selected part has the characters from its start to its end (not all)', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);''', r'''this.DrawTextW(selected.slice(start), rcSelection, -1, 4);''')
m(EB, 'onFrameRender: the count of the selected part is an int', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);''', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start), 4);''',
  'equivalent: two character positions are ints, so their difference is an int already')
m(EB, 'onFrameRender: the selected part is vertically centred', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);''', r'''this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 0);''')
m(EB, 'onFrameRender: the selected part is drawn', r'''      this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);
''', '')
m(EB, 'onFrameRender: the blink is of the application\'s time', r'''if (devices.absoluteTime() - this.m_dfLastBlink >= this.m_dfBlink) {''', r'''if (devices.absoluteTime() + this.m_dfLastBlink >= this.m_dfBlink) {''')
m(EB, 'onFrameRender: the blink is a time since the last blink', r'''if (devices.absoluteTime() - this.m_dfLastBlink >= this.m_dfBlink) {''', r'''if (this.m_dfLastBlink - devices.absoluteTime() >= this.m_dfBlink) {''')
m(EB, 'onFrameRender: the caret toggles when the blink time has gone', r'''if (devices.absoluteTime() - this.m_dfLastBlink >= this.m_dfBlink) {''', r'''if (devices.absoluteTime() - this.m_dfLastBlink > this.m_dfBlink) {''')
m(EB, 'onFrameRender: the caret toggles when the blink time has gone (not before)', r'''if (devices.absoluteTime() - this.m_dfLastBlink >= this.m_dfBlink) {''', r'''if (devices.absoluteTime() - this.m_dfLastBlink <= this.m_dfBlink) {''')
m(EB, 'onFrameRender: the caret toggles when the blink time has gone (the time of the box)', r'''if (devices.absoluteTime() - this.m_dfLastBlink >= this.m_dfBlink) {''', r'''if (devices.absoluteTime() - this.m_dfLastBlink >= 0) {''')
m(EB, 'onFrameRender: the caret toggles', r'''      this.m_bCaretOn = !this.m_bCaretOn;
      this.m_dfLastBlink''', r'''      this.m_dfLastBlink''')
m(EB, 'onFrameRender: the caret toggles (to on)', r'''      this.m_bCaretOn = !this.m_bCaretOn;
      this.m_dfLastBlink''', r'''      this.m_bCaretOn = true;
      this.m_dfLastBlink''')
m(EB, 'onFrameRender: the time of the blink is taken again', r'''      this.m_dfLastBlink = devices.absoluteTime();
    }
    if (this.m_bHasFocus''', r'''    }
    if (this.m_bHasFocus''')
m(EB, 'onFrameRender: the time of the blink is taken again (the time then)', r'''      this.m_dfLastBlink = devices.absoluteTime();
    }
    if (this.m_bHasFocus''', r'''      this.m_dfLastBlink += this.m_dfBlink;
    }
    if (this.m_bHasFocus''')
m(EB, 'onFrameRender: the caret needs the focus', r'''if (this.m_bHasFocus && this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {''', r'''if (this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {''')
m(EB, 'onFrameRender: the caret needs to be on', r'''if (this.m_bHasFocus && this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {''', r'''if (this.m_bHasFocus && !CKTDGUIEditBox.s_bHideCaret) {''')
m(EB, 'onFrameRender: the caret is not hidden', r'''if (this.m_bHasFocus && this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {''', r'''if (this.m_bHasFocus && this.m_bCaretOn) {''')
m(EB, 'onFrameRender: the caret is not hidden (the class\'s flag)', r'''if (this.m_bHasFocus && this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {''', r'''if (this.m_bHasFocus && this.m_bCaretOn && CKTDGUIEditBox.s_bHideCaret) {''')
m(EB, 'onFrameRender: the caret needs the focus (or)', r'''if (this.m_bHasFocus && this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {''', r'''if (this.m_bHasFocus || this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {''')
m(EB, 'onFrameRender: the caret needs to be on (or)', r'''if (this.m_bHasFocus && this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {''', r'''if (this.m_bHasFocus && (this.m_bCaretOn || !CKTDGUIEditBox.s_bHideCaret)) {''')
m(EB, 'onFrameRender: the caret is moved by the left side minus the first x', r'''const x = (text.left - nXFirst) | 0;''', r'''const x = (text.left + nXFirst) | 0;''')
m(EB, 'onFrameRender: the caret is moved by the left side', r'''const x = (text.left - nXFirst) | 0;''', r'''const x = (text.right - nXFirst) | 0;''')
m(EB, 'onFrameRender: the caret is moved by the first x', r'''const x = (text.left - nXFirst) | 0;''', r'''const x = (text.left - nCaretX) | 0;''')
m(EB, 'onFrameRender: the caret\'s move is an int', r'''const x = (text.left - nXFirst) | 0;''', r'''const x = (text.left - nXFirst);''',
  'equivalent: a left side and an x are ints, so their difference is an int already')
m(EB, 'onFrameRender: the caret starts one pixel before its x', r'''left: (nCaretX - 1 + x) | 0,''', r'''left: (nCaretX + x) | 0,''')
m(EB, 'onFrameRender: the caret starts one pixel before its x (not after)', r'''left: (nCaretX - 1 + x) | 0,''', r'''left: (nCaretX + 1 + x) | 0,''')
m(EB, 'onFrameRender: the caret starts moved', r'''left: (nCaretX - 1 + x) | 0,''', r'''left: (nCaretX - 1) | 0,''')
m(EB, 'onFrameRender: the caret starts at the caret\'s x', r'''left: (nCaretX - 1 + x) | 0,''', r'''left: (nXFirst - 1 + x) | 0,''')
m(EB, 'onFrameRender: the left of the caret is an int', r'''left: (nCaretX - 1 + x) | 0,''', r'''left: (nCaretX - 1 + x),''',
  'equivalent: an x is an int, so the sum is an int already')
m(EB, 'onFrameRender: the caret is as high as the text rectangle (top)', r'''top: text.top, right: (nCaretX + 1 + x) | 0, bottom: text.bottom };''', r'''top: text.bottom, right: (nCaretX + 1 + x) | 0, bottom: text.bottom };''')
m(EB, 'onFrameRender: the caret ends one pixel after its x', r'''right: (nCaretX + 1 + x) | 0,''', r'''right: (nCaretX + x) | 0,''')
m(EB, 'onFrameRender: the caret ends one pixel after its x (not before)', r'''right: (nCaretX + 1 + x) | 0,''', r'''right: (nCaretX - 1 + x) | 0,''')
m(EB, 'onFrameRender: the caret ends moved', r'''right: (nCaretX + 1 + x) | 0,''', r'''right: (nCaretX + 1) | 0,''')
m(EB, 'onFrameRender: the caret ends at the caret\'s x', r'''right: (nCaretX + 1 + x) | 0,''', r'''right: (nXFirst + 1 + x) | 0,''')
m(EB, 'onFrameRender: the right of the caret is an int', r'''right: (nCaretX + 1 + x) | 0,''', r'''right: (nCaretX + 1 + x),''',
  'equivalent: an x is an int, so the sum is an int already')
m(EB, 'onFrameRender: the caret is as high as the text rectangle (bottom)', r'''right: (nCaretX + 1 + x) | 0, bottom: text.bottom };''', r'''right: (nCaretX + 1 + x) | 0, bottom: text.top };''')
m(EB, 'onFrameRender: the caret in the overwrite mode is as wide as the character', r'''      if (!this.m_bInsertMode) rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;
''', '')
m(EB, 'onFrameRender: the caret in the insert mode is two pixels wide', r'''if (!this.m_bInsertMode) rcCaret.right''', r'''if (this.m_bInsertMode) rcCaret.right''')
m(EB, 'onFrameRender: the caret in the overwrite mode ends at the trailing edge', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;''', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, false) + text.left - nXFirst) | 0;''')
m(EB, 'onFrameRender: the caret in the overwrite mode ends at the trailing edge (of the caret)', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;''', r'''rcCaret.right = (buffer.CPtoX(this.m_nSelStart, true) + text.left - nXFirst) | 0;''')
m(EB, 'onFrameRender: the caret in the overwrite mode ends at the trailing edge (moved)', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;''', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true)) | 0;''')
m(EB, 'onFrameRender: the caret in the overwrite mode ends at the trailing edge (the text rectangle\'s left)', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;''', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.right - nXFirst) | 0;''')
m(EB, 'onFrameRender: the caret in the overwrite mode ends at the trailing edge (minus the first x)', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;''', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left + nXFirst) | 0;''')
m(EB, 'onFrameRender: the caret in the overwrite mode ends at the trailing edge (an int)', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;''', r'''rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst);''',
  'equivalent: an x is an int, so the sum is an int already')
m(EB, 'onFrameRender: the caret is drawn', r'''      this.DrawRect(rcCaret, this.m_CaretColor);
''', '')
m(EB, 'onFrameRender: the caret is drawn in the caret colour', r'''this.DrawRect(rcCaret, this.m_CaretColor);''', r'''this.DrawRect(rcCaret, this.m_SelBkColor);''')
m(EB, 'onFrameRender: the rectangle of the caret is its own', r'''this.DrawRect(rcCaret, this.m_CaretColor);''', r'''this.DrawRect(rcSelection, this.m_CaretColor);''')
m(EB, 'onFrameRender: the box answers 0', r'''      this.DrawRect(rcCaret, this.m_CaretColor);
    }
    return 0;''', r'''      this.DrawRect(rcCaret, this.m_CaretColor);
    }
    return 1;''')


# ---- imeeditbox.ts: the drawing, by operator
IM = 'imeeditbox.ts'
# the code the mutants are made of: the unsigned compare of GetImeId, then everything from the font colour to the end of
# RenderCandidateReadingWindow (the helpers, CalcTextRect, DrawTextW, DrawRect, OnFrameRender, RenderComposition, the window of candidates)
IM_REGIONS = [('  getImeId(uIndex: number): number {', '\n  }\n'), ('  /** the font colour the text is drawn in', '  override textureData(')]
# what the mutants of a colour field swap it for (a colour of the tests that no other field has)
IM_OTHER_COLOUR = {'m_TextColor': 'm_SelTextColor'}
IM_COLOUR = 'm_TextColor'


def mask(line):
    """The line with the inside of its strings and its trailing comment blanked (same length), so a regular expression does not see them."""
    out, quote, i = [], None, 0
    while i < len(line):
        c = line[i]
        if quote:
            if c == '\\' and i + 1 < len(line):
                out.append('SS')
                i += 2
                continue
            out.append(c if c == quote else 'S')
            if c == quote:
                quote = None
        elif line.startswith('//', i):
            out.append('C' * (len(line) - i))
            break
        else:
            if c in '"\'`':
                quote = c
            out.append(c)
        i += 1
    return ''.join(out)


def balanced_end(masked, start):
    """The index after the `)` that closes the `(` at `start`."""
    depth = 0
    for i in range(start, len(masked)):
        if masked[i] == '(':
            depth += 1
        elif masked[i] == ')':
            depth -= 1
            if depth == 0:
                return i + 1
    return -1


def line_mutants(line):
    """Every one-operator change of a line of code: [(what, new line)]."""
    mk = mask(line)
    out = []

    def at(mo_start, mo_end, text, what):
        out.append((what, line[:mo_start] + text + line[mo_end:]))

    if re.search(r'\w<\w', mk):
        return out  # a type argument: not an operator
    for mo in re.finditer(r'(?<![<>=!&|?])(<=|>=|===|!==|<|>)(?![<>=])', mk):
        op = mo.group(1)
        for new in {'<=': ['<'], '>=': ['>'], '<': ['<='], '>': ['>='], '===': ['!=='], '!==': ['===']}[op]:
            at(mo.start(), mo.end(), new, f'{op} -> {new}')
    for mo in re.finditer(r'&&|\|\|', mk):
        at(mo.start(), mo.end(), '||' if mo.group() == '&&' else '&&', f'{mo.group()} -> ' + ('||' if mo.group() == '&&' else '&&'))
    for mo in re.finditer(r'(?<=[\w)\]]) ([-+*/]) (?=[\w(-])', mk):
        new = {'+': '-', '-': '+', '*': '/', '/': '*'}[mo.group(1)]
        at(mo.start(1), mo.end(1), new, f'{mo.group(1)} -> {new}')
    for mo in re.finditer(r'(?<=\s)([-+])=', mk):
        at(mo.start(1), mo.end(1), '-' if mo.group(1) == '+' else '+', f'{mo.group(1)}= -> ' + ('-' if mo.group(1) == '+' else '+') + '=')
    for mo in re.finditer(r'(?<![\w.])(-?)(0x[0-9a-fA-F]+|\d+\.\d+|\d+)(?![\w.])', mk):
        text = mo.group(2)
        if re.search(r'(\|\s|>>>\s)$', mk[:mo.start()]):
            continue  # `| 0`, `>>> 0`
        if text.startswith('0x'):
            v = int(text, 16)
            news = {v + 1, v - 1} if not mo.group(1) else {v - 1}
            if v == 0x404:
                news |= {0x400, 0x4}
            if v == 0x400:
                news |= {0x0}
            news = [hex(n) for n in sorted(news) if n >= 0]
        elif '.' in text:
            news = [str(float(text) / 2)]
        else:
            v = int(text)
            news = [str(v + 1), str(v - 1)] if v >= 1 and not mo.group(1) else ([str(v + 1)] if not mo.group(1) else [str(v - 1) if v > 1 else '0'])
        for new in news:
            at(mo.start(), mo.end(), new if not mo.group(1) or new != '0' and not new.startswith('-') else new, f'{mo.group()} -> {new}')
    for mo in re.finditer(r'(?<![\w\])!])!(?=[\w(])', mk):
        at(mo.start(), mo.end(), '', '! dropped')
    for mo in re.finditer(r'Math\.(min|max)', mk):
        new = 'max' if mo.group(1) == 'min' else 'min'
        at(mo.start(1), mo.end(1), new, f'Math.{mo.group(1)} -> Math.{new}')
    for mo in re.finditer(r'\.(left|right|top|bottom|x|y|width|height)\b(?!\()', mk):
        new = {'left': 'right', 'right': 'left', 'top': 'bottom', 'bottom': 'top', 'x': 'y', 'y': 'x', 'width': 'height', 'height': 'width'}[mo.group(1)]
        at(mo.start(1), mo.end(1), new, f'.{mo.group(1)} -> .{new}')
    for mo in re.finditer(r'this\.(m_\w*Color)\b', mk):
        new = IM_OTHER_COLOUR.get(mo.group(1), IM_COLOUR)
        if new != mo.group(1):
            at(mo.start(1), mo.end(1), new, f'{mo.group(1)} -> {new}')
    # a condition: always true, never true
    mo = re.match(r'(\s*(?:\} else )?if )\(', mk)
    if mo:
        end = balanced_end(mk, mo.end() - 1)
        if end > 0:
            for new in ('true', 'false'):
                at(mo.end() - 1, end, f'({new})', f'condition {new}')
    # the arms of a `?:` swapped
    if mk.count(' ? ') == 1:
        q = mk.index(' ? ')
        depth, i, colon, end = 0, q + 3, -1, -1
        while i < len(mk):
            c = mk[i]
            if c in '([{':
                depth += 1
            elif c in ')]}':
                if depth == 0:
                    end = i
                    break
                depth -= 1
            elif depth == 0 and c == ':' and colon < 0:
                colon = i
            elif depth == 0 and c in ';,' and colon >= 0:
                end = i
                break
            i += 1
        if colon > 0 and end > 0:
            yes, no = line[q + 3:colon].strip(), line[colon + 1:end].strip()
            out.append(('arms of ?: swapped', line[:q + 3] + no + ' : ' + yes + line[end:]))
    # a statement that does nothing
    st = mk.strip()
    if (st.endswith(';') and not re.match(r'(const|let|for|if|return [^;]|throw|\} else)\b', st) and not st.startswith(('if ', '} ', 'for '))
            and sum(mk.count(c) for c in '([{') == sum(mk.count(c) for c in ')]}') and re.match(r'[\w.?!\[\]]+(\(| = | \+= | -= |;)', st)):
        out.append(('statement deleted', line[:len(line) - len(line.lstrip())]))
    return out


def operator_mutants(f, regions):
    """[(name, anchor, replacement)] for the code of the file between each pair of markers (see `line_mutants`)."""
    src = open(path_of(f)).read()
    lines = src.split('\n')
    starts = []  # the line numbers (0-based) of the regions
    pos = [0]
    for ln in lines:
        pos.append(pos[-1] + len(ln) + 1)
    spans = []
    for first, last in regions:
        a = src.index(first)
        b = src.index(last, a + len(first)) + (len(last) if last.endswith('\n') else 0)
        spans.append((a, b))
    result, seen, func = [], {}, ''
    for n, line in enumerate(lines):
        mo = re.match(r'  (?:private |override |static )*(\w+)\(', line)
        if mo:
            func = mo.group(1)
        if not any(a <= pos[n] < b for a, b in spans):
            continue
        st = line.strip()
        if not st or st.startswith(('*', '/*', '//')):
            continue
        for what, new in line_mutants(line):
            # the anchor: the line, with the line before it while the text is not unique
            k = 0
            anchor, repl = line, new
            while src.count(anchor) != 1 and n - k > 0:
                k += 1
                anchor = '\n'.join(lines[n - k:n + 1])
                repl = '\n'.join(lines[n - k:n] + [new])
            if src.count(anchor) != 1:
                raise SystemExit(f'no unique anchor for line {n + 1}: {st}')
            if not anchor.startswith(' ') or k == 0:
                # without the indentation of the first line (shorter, and the same place)
                anchor, repl = anchor.lstrip(' '), repl.lstrip(' ')
                if src.count(anchor) != 1:
                    anchor, repl = ' ' * (len(line) - len(line.lstrip())) + anchor, ' ' * (len(line) - len(line.lstrip())) + repl
            snippet = ' '.join(st.split())
            snippet = snippet if len(snippet) <= 72 else snippet[:72] + '...'
            name = f'{func}: {what} in `{snippet}`'
            seen[name] = seen.get(name, 0) + 1
            if seen[name] > 1:
                name += f' (#{seen[name]})'
            result.append((name, anchor, repl))
    return result


# the mutants of imeeditbox.ts that no input can tell from the original: name -> why
IM_WHY = {
    'textLength: 0 -> 1 in `return text === null ? 0 : wcslen(text);`':
        'equivalent: the text is null only for a buffer that holds none, and CPtoX of such a buffer answers 0 without a font and throws with one, whatever index it is given',
    'DrawRect: 1 -> 2 in `const sx = render ? render.resolutionScale.x : 1, sy = render ? render.r...`':
        'equivalent: without a render the quad is never drawn (renderVertex only logs "device null"), so the scale it is made with is never seen',
    'DrawRect: 1 -> 0 in `const sx = render ? render.resolutionScale.x : 1, sy = render ? render.r...`':
        'equivalent: without a render the quad is never drawn (renderVertex only logs "device null"), so the scale it is made with is never seen',
    'DrawRect: 1 -> 2 in `const sx = render ? render.resolutionScale.x : 1, sy = render ? render.r...` (#2)':
        'equivalent: without a render the quad is never drawn (renderVertex only logs "device null"), so the scale it is made with is never seen',
    'DrawRect: 1 -> 0 in `const sx = render ? render.resolutionScale.x : 1, sy = render ? render.r...` (#2)':
        'equivalent: without a render the quad is never drawn (renderVertex only logs "device null"), so the scale it is made with is never seen',
    'DrawRect: statement deleted in `quad.setU(i, 0);`':
        'equivalent: the quad is new and its bytes are zero, so its U is 0 already',
    'DrawRect: statement deleted in `quad.setV(i, 0);`':
        'equivalent: the quad is new and its bytes are zero, so its V is 0 already',
    'DrawRect: 0 -> 1 in `const top0 = states?.stackPointer ?? 0;`':
        'equivalent: without a render there is no state stack, and the value is only used to pop one',
    'onFrameRender: 0 -> 1 in `let nCaretY = 0, nYFirst = 0;`':
        'equivalent: the value is read only for a box of a group, which assigns it first',
    'onFrameRender: 0 -> 1 in `let nCaretY = 0, nYFirst = 0;` (#2)':
        'equivalent: the value is read only for a box of a group, which assigns it first',
    'onFrameRender: <= -> < in `const left = nCaretX <= nSelStartX ? nCaretX : nSelStartX;`':
        'equivalent: when the two compared values are equal both arms of the ?: give the same value',
    'onFrameRender: <= -> < in `const right = nCaretX <= nSelStartX ? nSelStartX : nCaretX;`':
        'equivalent: when the two compared values are equal both arms of the ?: give the same value',
    'onFrameRender: 31 -> 30 in `this.DrawTextW(typed.slice(this.m_nFirstVisible), rcText, -1, (this.m_Gr...`':
        'equivalent: bit 2 of x >> 30 is the sign of x, as it is of x >> 31 (the values are -2, -1, 0, 1 and 0, -1), so (m_GroupID >> n) & 4 is the same',
    'onFrameRender: <= -> < in `const start = this.m_nFirstVisible <= lower ? lower : this.m_nFirstVisib...`':
        'equivalent: when the two compared values are equal both arms of the ?: give the same value',
    'RenderComposition: 0 -> 1 in `let nY = 0, nYFirst = 0;`':
        'equivalent: the value is read only for a box of a group, which assigns it first',
    'RenderComposition: 0 -> 1 in `let nY = 0, nYFirst = 0;` (#2)':
        'equivalent: the value is read only for a box of a group, which assigns it first',
    'RenderComposition: .bottom -> .top in `const rc: Rect = { left: startX, top: text.top, right: startX, bottom: t...`':
        'equivalent: the bottom of the starting rectangle is overwritten by CalcTextRect (all four sides for an empty text) before anything reads it',
    'RenderComposition: + -> - in `rc.bottom = (nY + text.top + this.lineHeight() - nYFirst) | 0;`':
        'equivalent: the bottom assigned here is overwritten by CalcTextRect (all four sides for an empty text) before anything reads it; only the top, the origin of the measure, matters',
    'RenderComposition: + -> - in `rc.bottom = (nY + text.top + this.lineHeight() - nYFirst) | 0;` (#2)':
        'equivalent: the bottom assigned here is overwritten by CalcTextRect (all four sides for an empty text) before anything reads it; only the top, the origin of the measure, matters',
    'RenderComposition: - -> + in `rc.bottom = (nY + text.top + this.lineHeight() - nYFirst) | 0;`':
        'equivalent: the bottom assigned here is overwritten by CalcTextRect (all four sides for an empty text) before anything reads it; only the top, the origin of the measure, matters',
    'RenderComposition: .top -> .bottom in `rc.bottom = (nY + text.top + this.lineHeight() - nYFirst) | 0;`':
        'equivalent: the bottom assigned here is overwritten by CalcTextRect (all four sides for an empty text) before anything reads it; only the top, the origin of the measure, matters',
    'RenderComposition: statement deleted in `rc.bottom = (nY + text.top + this.lineHeight() - nYFirst) | 0;`':
        'equivalent: the bottom assigned here is overwritten by CalcTextRect (all four sides for an empty text) before anything reads it; only the top, the origin of the measure, matters',
    'RenderComposition: .right -> .left in `let right = rc.right;`':
        'equivalent: right is read after the loop only for a string that wrapped before it, where it is assigned again; otherwise it only goes into rc.right, which nothing reads',
    'RenderComposition: < -> <= in `const length = nCount < cp ? nCount : cp;`':
        'equivalent: when the two compared values are equal both arms of the ?: give the same value',
    'RenderComposition: 31 -> 30 in `this.DrawTextW(compText.slice(at), target, length, (this.m_GroupID >> 31...`':
        'equivalent: bit 2 of x >> 30 is the sign of x, as it is of x >> 31 (the values are -2, -1, 0, 1 and 0, -1), so (m_GroupID >> n) & 4 is the same',
    'RenderComposition: .right -> .left in `rcTemp = { left: rc.left, top: rc.top, right: rc.right, bottom: rc.botto...` (#2)':
        'equivalent: the right of rcTemp is never read: rcCaret copies the rectangle and then sets its own left and right',
    'RenderComposition: .right -> .left in `if (wrapped && !secondLine) setRect(rcTemp, (firstLeft + text.right - ri...` (#2)':
        'equivalent: the right of rcTemp is never read: rcCaret copies the rectangle and then sets its own left and right',
    'RenderComposition: .left -> .right in `rcCaret = { left: rcTemp.left, top: rcTemp.top, right: rcTemp.right, bot...`':
        'equivalent: the caret rectangle is copied from rcTemp and given its own left and right right after, before it is drawn',
    'RenderComposition: .right -> .left in `rcCaret = { left: rcTemp.left, top: rcTemp.top, right: rcTemp.right, bot...`':
        'equivalent: the caret rectangle is copied from rcTemp and given its own left and right right after, before it is drawn',
    'RenderComposition: .left -> .right in `const target: Rect = { left: (clause.left - ox) | 0, top: (rc.top - oy) ...`':
        'equivalent: CPtoX does not look at the trail (the exe never reads bTrail), so the clause has no width and its left and right are the same number',
    'RenderComposition: .right -> .left in `const target: Rect = { left: (clause.left - ox) | 0, top: (rc.top - oy) ...`':
        'equivalent: CPtoX does not look at the trail (the exe never reads bTrail), so the clause has no width and its left and right are the same number',
    'RenderComposition: .left -> .right in `rcCaret = { left: rcTemp.left, top: rcTemp.top, right: rcTemp.right, bot...` (#2)':
        'equivalent: the caret rectangle is copied from rcTemp and given its own left and right right after, before it is drawn',
    'RenderComposition: .right -> .left in `rcCaret = { left: rcTemp.left, top: rcTemp.top, right: rcTemp.right, bot...` (#2)':
        'equivalent: the caret rectangle is copied from rcTemp and given its own left and right right after, before it is drawn',
    'RenderCandidateReadingWindow: - -> + in `width = (rc.right - rc.left) | 0;`':
        'equivalent: the rectangle starts at (0, 0) and CalcTextRect only adds the width and the height to it, so its left and top are 0 here',
    'RenderCandidateReadingWindow: - -> + in `rowHeight = total = (rc.bottom - rc.top) | 0;`':
        'equivalent: the rectangle starts at (0, 0) and CalcTextRect only adds the width and the height to it, so its left and top are 0 here',
    'RenderCandidateReadingWindow: 0 -> 1 in `setRect(rc, 0, 0, 0, 0);`':
        'equivalent: CalcTextRect adds the origin to the width and the height it measures, so right - left and bottom - top do not depend on the origin set here',
    'RenderCandidateReadingWindow: 0 -> 1 in `setRect(rc, 0, 0, 0, 0);` (#2)':
        'equivalent: CalcTextRect adds the origin to the width and the height it measures, so right - left and bottom - top do not depend on the origin set here',
    'RenderCandidateReadingWindow: 0 -> 1 in `setRect(rc, 0, 0, 0, 0);` (#3)':
        'equivalent: the right and the bottom set here are overwritten by CalcTextRect before they are read',
    'RenderCandidateReadingWindow: 0 -> 1 in `setRect(rc, 0, 0, 0, 0);` (#4)':
        'equivalent: the right and the bottom set here are overwritten by CalcTextRect before they are read',
    'RenderCandidateReadingWindow: statement deleted in `setRect(rc, 0, 0, 0, 0);`':
        'equivalent: the rectangle left from the row before is (0, 0, w, h): its left and top are 0 and CalcTextRect overwrites the rest',
    'RenderCandidateReadingWindow: - -> + in `const w = (rc.right - rc.left) | 0, h = (rc.bottom - rc.top) | 0;`':
        'equivalent: the rectangle starts at (0, 0) and CalcTextRect only adds the width and the height to it, so its left and top are 0 here',
    'RenderCandidateReadingWindow: - -> + in `const w = (rc.right - rc.left) | 0, h = (rc.bottom - rc.top) | 0;` (#2)':
        'equivalent: the rectangle starts at (0, 0) and CalcTextRect only adds the width and the height to it, so its left and top are 0 here',
    'RenderCandidateReadingWindow: > -> >= in `width = width > w ? width : w;`':
        'equivalent: when the two compared values are equal both arms of the ?: give the same value',
    'RenderCandidateReadingWindow: > -> >= in `rowHeight = rowHeight > h ? rowHeight : h;`':
        'equivalent: when the two compared values are equal both arms of the ?: give the same value',
    'RenderCandidateReadingWindow: > -> >= in `if (rc.right > viewport.width) {`':
        'equivalent: a window that ends exactly at the right side of the view port is pulled back by 0',
}
for _name, _a, _b in operator_mutants(IM, IM_REGIONS):
    m(IM, _name, _a, _b, IM_WHY.get(_name, ''))
for _name in IM_WHY:
    if not any(mu[1] == _name for mu in M):
        raise SystemExit(f'a reason for a mutant that is not made any more: {_name}')


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (8 * 2**30, 8 * 2**30))


def main():
    args = sys.argv[1:]
    mutants = M
    if '--list' in args:
        for f, name, a, b, why in mutants:
            print(f'{f:18s} {name}' + (f'   [survives: {why}]' if why else ''))
        print(f'{len(mutants)} mutants')
        return 0
    pick = [a for a in args if not a.startswith('--')]
    for a in args:
        if a.startswith('--survivors='):
            # only the mutants that survived in an earlier run (its log): to see which a new test now kills
            gone = {m_.group(1) + ': ' + m_.group(2) for m_ in (re.match(r'SURVIVED  (\S+): (.*?)(   |$)', ln) for ln in open(a.split('=', 1)[1])) if m_}
            mutants = [mu for mu in mutants if mu[0] + ': ' + mu[1] in gone]
    sources = {}
    errors = []
    for f, name, a, b, why in mutants:
        path = path_of(f)
        if path not in sources:
            sources[path] = open(path).read()
        if sources[path].count(a) != 1:
            errors.append(f'anchor found {sources[path].count(a)} times: {f}: {name}')
        if a == b:
            errors.append(f'no change: {name}')
    names = [(f, name) for f, name, *_ in mutants]
    for dup in sorted({n for n in names if names.count(n) > 1}):
        errors.append(f'duplicate name: {dup}')
    if errors:
        print('\n'.join(errors))
        return 2
    if '--check' in args:
        print(f'{len(mutants)} mutants, every anchor occurs exactly once')
        return 0
    bad = survived = run = stale = 0
    try:
        for f, name, a, b, why in mutants:
            if pick and not any(p in name for p in pick):
                continue
            path = path_of(f)
            orig = sources[path]
            open(path, 'w').write(orig.replace(a, b, 1))
            try:
                r = subprocess.run([BUN, 'test', '--bail', *TESTS[f]], cwd=ROOT, capture_output=True, text=True, timeout=TIMEOUT.get(f, 90), preexec_fn=limits)
                killed = r.returncode != 0
            except subprocess.TimeoutExpired:
                killed = True
            finally:
                open(path, 'w').write(orig)
            run += 1
            if killed:
                if why:
                    stale += 1
                    print(f'killed    {f}: {name}   <-- its reason to survive is out of date: {why}', flush=True)
                else:
                    print(f'killed    {f}: {name}', flush=True)
            else:
                survived += 1
                if why:
                    print(f'SURVIVED  {f}: {name}   (expected: {why})', flush=True)
                else:
                    bad += 1
                    print(f'SURVIVED  {f}: {name}   <-- not expected', flush=True)
    finally:
        for path, orig in sources.items():
            open(path, 'w').write(orig)
    print(f'{run} mutants: {run - survived} killed, {survived} survived ({survived - bad} expected, {bad} not), {stale} reasons out of date')
    return 1 if (bad or stale) else 0


if __name__ == '__main__':
    sys.exit(main())
