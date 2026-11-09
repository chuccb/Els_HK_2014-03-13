#!/usr/bin/env python3
"""Mutation check of the editing half of CKTDGUIUniBuffer (packages/ui/src/unibuffer.ts: GetLineCount, GetNextItemPos, GetPriorItemPos, RemoveChar, setCharAt,
InsertChar, InsertString, XYtoCP, GetCaretLineMove and the three tables the buffer takes from the C runtime, `ansiLength`, `towupper`, `iswdigit`).  The
measuring half (CPtoX, CPtoY, GetLineWidth, XtoCP) has its mutants in tools/mutate-edit.py.  The mutants are made from the source by operator, like those of
imeeditbox.ts there (every comparison, logical and arithmetic operator, number, `!`, condition, `?:`, `.left` / ..., statement, one at a time), so their names are
the text of the line.  The test that runs for each is packages/ui/test/unibuffer-ops.test.ts, which replays what the exe answered (tools/oracle-unibuf.py).

    python3 tools/mutate-unibuf.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

The options, the exit code and the way the source is restored are those of tools/mutate-edit.py (this script loads it and replaces its list of mutants): a
mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed.  Commit first, or work in a copy.
"""
import importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutate_edit', os.path.join(HERE, 'mutate-edit.py'))
me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(me)

UB = 'unibuffer.ts'
T = me.T
me.M.clear()
me.TESTS[UB] = [T + 'unibuffer-ops.test.ts']
me.TIMEOUT.clear()
me.TIMEOUT[UB] = 20  # the test takes a second; a mutant that loops for ever is a kill

# the three functions that stand alone are told apart by name (`operator_mutants` names a mutant after the last method it saw: the indented ones)
FREE = [('ansiLength', 'export function ansiLength(', '/** `towupper`'), ('towupper', 'export function towupper(', '/**\n * `iswdigit`'),
        ('iswdigit', 'export function iswdigit(', 'export class CKTDGUIUniBuffer')]
REGIONS = [('  private plain(): string {', '\n}\n')]

WHY = {}


def add(name, why):
    WHY[name] = why


MUTANTS = []
for _func, _first, _last in FREE:
    for _name, _a, _b in me.operator_mutants(UB, [(_first, _last)]):
        MUTANTS.append((_func + _name[_name.index(':'):], _a, _b))
MUTANTS += me.operator_mutants(UB, REGIONS)

# ---- the mutants that no input can tell from the original (name -> why)

NUL = 'equivalent: the character at the length is read as NaN here (the terminating NUL in the exe), which is not the character looked for'
add('GetLineCount: < -> <= in `for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lin...`', NUL)
WALK_END = ('equivalent: the walk may stop one place earlier or later (at the last character, or at the NUL behind it): the last character is either a space, '
            'which has the NUL (no space) behind it and answers its position plus one, the length, or it is none, and the walk ends with the length too')
add('GetNextItemPos: >= -> > in `if (++i >= size - 1) return size;`', WALK_END)
add('GetNextItemPos: - -> + in `if (++i >= size - 1) return size;`', WALK_END)
add('GetNextItemPos: 1 -> 0 in `if (++i >= size - 1) return size;`', WALK_END)
AT_END = 'equivalent: the character at the length is the NUL in the exe and NaN here, and neither is a space'
add('GetPriorItemPos: < -> <= in `return i < text.length ? text.charCodeAt(i) : 0;`', AT_END)
add('GetPriorItemPos: 0 -> 1 in `return i < text.length ? text.charCodeAt(i) : 0;`', 'equivalent: the character at the length is read as 0 or 1, and neither is a space')
BACK_END = ('equivalent: the answer is 0 whichever way the walk ends: a character at position 0 that is none of a space answers 0 itself, and the characters before the text '
            '(which the exe reads as whatever lies there, and the port as nothing) cannot make it answer more')
add('GetPriorItemPos: <= -> < in `if (i <= 0) return 0;`', BACK_END)
add('GetPriorItemPos: condition false in `if (i <= 0) return 0;`', BACK_END)
add('GetPriorItemPos: <= -> < in `if (--i <= 0) return 0;`', BACK_END)
NO_MEMORY = ('equivalent: SetBufferSize says no only to a buffer that has the most room already (0xFFFF), or when an allocation fails, which the port does not model; a buffer with '
             'that much room is never asked here (the one character test is "more than 2 characters of room", the growth test needs a text of 0xFFFE characters, which is turned '
             'away before)')
for _what in ('0x2a -> 0x29', '0x2a -> 0x2b', 'statement deleted'):
    add(f'InsertChar: {_what} in `this.log.push(0x2a, "out of memory");`', NO_MEMORY)
    add(f'InsertChar: {_what} in `this.log.push(0x2a, "out of memory");` (#2)', NO_MEMORY)
add('XYtoCP: 0 -> 1 in `let rx = 0;`', 'equivalent: rx is given the first character of the line before anything reads it (the first character on the line sets onLine and, unless it returns, rx)')
add('GetCaretLineMove: 0 -> 1 in `for (let k = 0; k <= last; k++) {`',
    'equivalent: a position that is in none of the lines is taken for line 0, so leaving line 0 out of the search changes nothing')
add('GetCaretLineMove: statement deleted in `break;`', 'equivalent: the lines do not overlap (a line ends at the position of its break and the next one begins behind it), so no later one matches too')

for _name, _a, _b in MUTANTS:
    me.m(UB, _name, _a, _b, WHY.get(_name, ''))
for _name in WHY:
    assert any(mu[1] == _name for mu in me.M), f'a reason for a mutant that does not exist: {_name}'

if __name__ == '__main__':
    sys.exit(me.main())
