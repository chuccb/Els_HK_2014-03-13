#!/usr/bin/env python3
"""Mutation check of the dialog manager: CKTDGUIDialogManager (dialogmanager.ts: the ring list of dialogs, AddDlg, _InsertIntoDialogListTop,
_RemoveFromDialogList and the walks it keeps valid, ChangeFront / ChangeLayer / both ChangeSequence, UnmanageDlg, DeleteDlg, ClearAllDlg,
GetDialog, the getters, OnFrameMove, OnFrameRender, OnFrameRenderTopModal, MsgProc) and the dialog's side of it in dialog.ts (SetFront,
SetLayer, ~CKTDGUIDialog), plus the small pieces E4a added (WStringMap.clear, UIInputManager, ErrorLog.setLastErrorLog).  One small change at
a time is applied to a source file, the tests of the manager are run and the script reports whether a test notices (killed) or not (SURVIVED).

    python3 tools/mutate-manager.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

A mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed (the reason is out of date).
The reason (the last argument of `m(...)`) says why no input can tell the mutant from the original.  `--check` only verifies that every anchor
text occurs exactly once; `--survivors=LOG` runs only the mutants that survived in an earlier run's output.  The source is restored after
every mutant (also on Ctrl-C), but do not run this with edits you cannot afford to lose in the mutated files and edit nothing meanwhile.
Needs `bun` in ./node_modules/.bin.  Each run has a 90 s timeout and an 8 GB address-space limit: a mutant that loops or blows up is killed,
too.  (The mutants of the manager that the older tests of framemove.test.ts killed -- CheckDlg, CheckFrontModalDlg, CountModalDialog,
GetHideDialog -- are in tools/mutate-framemove.py.)
"""
import os, re, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
T = 'packages/ui/test/'
# the source files of the mutants, and the tests that run for the mutants of a file
SRC = {
    'dialogmanager.ts': 'packages/ui/src/dialogmanager.ts',
    'dialog.ts': 'packages/ui/src/dialog.ts',
    'stdmap.ts': 'packages/ui/src/stdmap.ts',
    'input.ts': 'packages/ui/src/input.ts',
    'massfile.ts': 'packages/host/src/classes/massfile.ts',
}
TESTS = {
    'dialogmanager.ts': [T + 'dialogmanager.test.ts', T + 'framemove.test.ts'],
    'dialog.ts': [T + 'dialogmanager.test.ts', T + 'dialog.test.ts', T + 'framemove.test.ts'],
    'stdmap.ts': [T + 'widgets.test.ts'],
    'input.ts': [T + 'framemove.test.ts', T + 'dialogmanager.test.ts'],
    'massfile.ts': ['packages/host/test/errorlog.test.ts', T + 'dialogmanager.test.ts'],
}

M = []


def m(f, name, a, b, why=''):
    M.append((f, name, a, b, why))


def path_of(f):
    return os.path.join(ROOT, SRC[f])


dm = 'dialogmanager.ts'

# ---- the ring list ------------------------------------------------------------------------------------------------------------------
m(dm, 'list: a new node points back at the node before the place', 'node.prev = where.prev;', 'node.prev = where;')
m(dm, 'list: the node before the place points on to the new node', 'where.prev.next = node;', 'where.next.prev = node;')
m(dm, 'list: the place points back at the new node', 'where.prev = node;', '')
m(dm, 'list: an insertion makes the list one longer', 'this.size++;', 'this.size += 2;')
m(dm, 'list: push appends', 'for (const d of dialogs) this.insert(this.head, d);', 'for (const d of dialogs) this.insert(this.head.next, d);')
m(dm, 'list: find starts at the back of the list', 'for (let n = this.head.next; n !== this.head; n = n.next) if (n.value === dialog) return n;',
  'for (let n = this.head.prev; n !== this.head; n = n.prev) if (n.value === dialog) return n;',
  'equivalent: a dialog is in the list once (AddDlg needs a dialog without a manager, and every other way into the list follows its removal), so the first and the last match are one')
m(dm, 'list: erase relinks the node before', 'node.prev.next = node.next;', '')
m(dm, 'list: erase relinks the node after', 'node.next.prev = node.prev;', '')
m(dm, 'list: erase makes the list one shorter', 'this.size--;', '')
m(dm, 'list: the iterator goes from the back to the front', '''Iterator<CKTDGUIDialog> {
    for (let n = this.head.next; n !== this.head; n = n.next) yield n.value!;''', '''Iterator<CKTDGUIDialog> {
    for (let n = this.head.prev; n !== this.head; n = n.prev) yield n.value!;''')
m(dm, 'handle: a destroyed dialog is not there', 'return dialog !== null && !dialog.destroyed;', 'return dialog !== null;')
m(dm, 'handle: null is not there', 'return dialog !== null && !dialog.destroyed;', 'return !dialog!.destroyed;')

# ---- fields and the small getters -----------------------------------------------------------------------------------------------------
m(dm, 'manager: the layer is shown at first', 'm_bShow = true;\n  m_bCanHide = false;', 'm_bShow = false;\n  m_bCanHide = false;')
m(dm, 'manager: the layer cannot hide at first', 'm_bShow = true;\n  m_bCanHide = false;', 'm_bShow = true;\n  m_bCanHide = true;')
m(dm, 'manager: no modal dialog at first', 'm_iModalDialogCount = 0;\n  /**', 'm_iModalDialogCount = 1;\n  /**')
m(dm, 'manager: the count of changes starts at 0', 'm_iDialogListChangeCount = 0;\n  /**', 'm_iDialogListChangeCount = 1;\n  /**')
m(dm, 'manager: SetShow sets the flag', 'this.m_bShow = show;', 'this.m_bShow = !show;')
m(dm, 'manager: CheckModalDlg: more than none', 'return this.m_iModalDialogCount > 0;', 'return this.m_iModalDialogCount >= 0;')
m(dm, 'manager: CheckModalDlg: one is enough', 'return this.m_iModalDialogCount > 0;', 'return this.m_iModalDialogCount > 1;')

# ---- the count of changes ---------------------------------------------------------------------------------------------------------------
m(dm, 'count: one more per change', 'let count = this.m_iDialogListChangeCount + 1;', 'let count = this.m_iDialogListChangeCount + 2;')
m(dm, 'count: the manager keeps it', 'this.m_iDialogListChangeCount = count;\n    if', 'if')
m(dm, 'count: back to 1 only above the limit', 'if (count > CHANGE_COUNT_LIMIT) {', 'if (count >= CHANGE_COUNT_LIMIT) {')
m(dm, 'count: the limit', 'const CHANGE_COUNT_LIMIT = 2147483637;', 'const CHANGE_COUNT_LIMIT = 2147483647;')
m(dm, 'count: the manager goes back to 1', '''this.m_iDialogListChangeCount = 1;
      count = 1;''', '''this.m_iDialogListChangeCount = 0;
      count = 1;''')
m(dm, 'count: the dialog gets 1 too', '''this.m_iDialogListChangeCount = 1;
      count = 1;''', '''this.m_iDialogListChangeCount = 1;
      count = 0;''')

# ---- AddDlg -----------------------------------------------------------------------------------------------------------------------------
m(dm, 'AddDlg: a destroyed dialog does not join', 'if (!live(dialog) || dialog.m_pkUIDialogManager !== null) return false;',
  'if (dialog === null || dialog.m_pkUIDialogManager !== null) return false;')
m(dm, 'AddDlg: a dialog that has a manager does not join', 'if (!live(dialog) || dialog.m_pkUIDialogManager !== null) return false;',
  'if (!live(dialog)) return false;')
m(dm, 'AddDlg: the dialog takes the manager', '    dialog.m_pkUIDialogManager = this;\n    this.insertIntoDialogListTop(dialog);', '    this.insertIntoDialogListTop(dialog);')
m(dm, 'AddDlg: the dialog goes in the list', '    dialog.m_pkUIDialogManager = this;\n    this.insertIntoDialogListTop(dialog);', '    dialog.m_pkUIDialogManager = this;')
m(dm, 'AddDlg: true', 'this.insertIntoDialogListTop(dialog);\n    return true;\n  }\n\n  /**\n   * `_InsertIntoDialogListTop', 'this.insertIntoDialogListTop(dialog);\n    return false;\n  }\n\n  /**\n   * `_InsertIntoDialogListTop')

# ---- _InsertIntoDialogListTop -----------------------------------------------------------------------------------------------------------
BEFORE = 'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer < other.m_iLayer : other.m_bFront || dialog.m_iLayer < other.m_iLayer;'


def before(f, b):
    return 'const before = ' + f + ' : ' + b + ';'


m(dm, 'insert: a front dialog: behind none of the dialogs of its layer and the front ones below', BEFORE,
  before('dialog.m_bFront ? other.m_bFront && dialog.m_iLayer <= other.m_iLayer', 'other.m_bFront || dialog.m_iLayer < other.m_iLayer'))
m(dm, 'insert: a front dialog: a front dialog before it must have a higher layer', BEFORE,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer > other.m_iLayer : other.m_bFront || dialog.m_iLayer < other.m_iLayer;')
m(dm, 'insert: a front dialog goes before a dialog that is not front', BEFORE,
  'const before = dialog.m_bFront ? other.m_bFront || dialog.m_iLayer < other.m_iLayer : other.m_bFront || dialog.m_iLayer < other.m_iLayer;')
m(dm, 'insert: a front dialog is not before a dialog that is not front by its layer alone', BEFORE,
  'const before = dialog.m_bFront ? dialog.m_iLayer < other.m_iLayer : other.m_bFront || dialog.m_iLayer < other.m_iLayer;')
m(dm, 'insert: a dialog that is not front: the layer alone', BEFORE,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer < other.m_iLayer : other.m_bFront && dialog.m_iLayer < other.m_iLayer;')
m(dm, 'insert: a dialog that is not front: a dialog of its layer is behind it', BEFORE,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer < other.m_iLayer : other.m_bFront || dialog.m_iLayer <= other.m_iLayer;')
m(dm, 'insert: a dialog that is not front: a lower layer is not before it', BEFORE,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer < other.m_iLayer : other.m_bFront || dialog.m_iLayer > other.m_iLayer;')
m(dm, 'insert: a dialog that is not front goes before the front dialogs', BEFORE,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer < other.m_iLayer : dialog.m_iLayer < other.m_iLayer;')
m(dm, 'insert: the flag decides', BEFORE,
  'const before = !dialog.m_bFront ? other.m_bFront && dialog.m_iLayer < other.m_iLayer : other.m_bFront || dialog.m_iLayer < other.m_iLayer;')
TOP = '''    list.insert(at, dialog);
    this.m_setDialog.add(dialog);
    dialog.m_iDialogListChangeCount = this.bumpChangeCount();
    this.countModalDialog(dialog);'''
m(dm, 'insert: the dialog goes in the list', TOP, TOP.replace('    list.insert(at, dialog);\n', ''))
m(dm, 'insert: the dialog joins the set', TOP, TOP.replace('    this.m_setDialog.add(dialog);\n', ''))
m(dm, 'insert: the count of changes goes up', TOP, TOP.replace('this.bumpChangeCount()', 'this.m_iDialogListChangeCount'))
m(dm, 'insert: the dialog takes the new count', TOP, TOP.replace('this.bumpChangeCount()', 'this.bumpChangeCount() + 1'))
m(dm, 'insert: the modal dialogs are counted with the dialog', TOP, TOP.replace('countModalDialog(dialog)', 'countModalDialog(null)'))
m(dm, 'insert: the modal dialogs are counted', TOP, TOP.replace('\n    this.countModalDialog(dialog);', ''))

# ---- _RemoveFromDialogList --------------------------------------------------------------------------------------------------------------
m(dm, 'remove: a dialog that is not in the list answers false', 'if (node === null) return false;', 'if (node === null) return true;')
FWD = 'if (it !== head && it.value === dialog) forward[i] = it.next;'
m(dm, 'remove: a forward walk: the sentinel is left alone', FWD, 'if (it.value === dialog) forward[i] = it.next;',
  'equivalent: the sentinel holds null, which is never the dialog (the exe tests for it because it would read a value that is not there)')
m(dm, 'remove: a forward walk: only the walks that stand on the dialog move', FWD, 'if (it !== head && it.value !== dialog) forward[i] = it.next;')
m(dm, 'remove: a forward walk moves to the next dialog', FWD, 'if (it !== head && it.value === dialog) forward[i] = it.prev;')
m(dm, 'remove: a forward walk does not end', FWD, 'if (it !== head && it.value === dialog) forward[i] = head;')
m(dm, 'remove: every forward walk is moved: not the last', 'const forward = this.m_vecIterator;\n    for (let i = 0; i < forward.length; i++) {',
  'const forward = this.m_vecIterator;\n    for (let i = 0; i < forward.length - 1; i++) {')
m(dm, 'remove: every forward walk is moved: not the first', 'const forward = this.m_vecIterator;\n    for (let i = 0; i < forward.length; i++) {',
  'const forward = this.m_vecIterator;\n    for (let i = 1; i < forward.length; i++) {')
BWD = 'if (it !== head && it.value === dialog) backward[i] = it.prev;'
m(dm, 'remove: a backward walk: the sentinel is left alone', BWD, 'if (it.value === dialog) backward[i] = it.prev;',
  'equivalent: the sentinel holds null, which is never the dialog (the exe tests for it because it would read a value that is not there)')
m(dm, 'remove: a backward walk: only the walks that stand on the dialog move', BWD, 'if (it !== head && it.value !== dialog) backward[i] = it.prev;')
m(dm, 'remove: a backward walk moves to the previous dialog', BWD, 'if (it !== head && it.value === dialog) backward[i] = it.next;')
m(dm, 'remove: a backward walk does not end', BWD, 'if (it !== head && it.value === dialog) backward[i] = head;')
m(dm, 'remove: every backward walk is moved: not the last', 'const backward = this.m_vecReverseIterator;\n    for (let i = 0; i < backward.length; i++) {',
  'const backward = this.m_vecReverseIterator;\n    for (let i = 0; i < backward.length - 1; i++) {')
m(dm, 'remove: every backward walk is moved: not the first', 'const backward = this.m_vecReverseIterator;\n    for (let i = 0; i < backward.length; i++) {',
  'const backward = this.m_vecReverseIterator;\n    for (let i = 1; i < backward.length; i++) {')
m(dm, 'remove: the node leaves the list', '    list.erase(node);\n    this.m_setDialog.delete(dialog);', '    this.m_setDialog.delete(dialog);')
m(dm, 'remove: the dialog leaves the set', '    this.m_setDialog.delete(dialog);\n    this.bumpChangeCount();', '    this.bumpChangeCount();')
m(dm, 'remove: the count of changes goes up', '    this.m_setDialog.delete(dialog);\n    this.bumpChangeCount();', '    this.m_setDialog.delete(dialog);')
m(dm, 'remove: the dialog\'s count is 0', 'dialog.m_iDialogListChangeCount = 0;\n    this.countModalDialog(null);', 'this.countModalDialog(null);')
m(dm, 'remove: the dialog\'s count is 0, not 1', 'dialog.m_iDialogListChangeCount = 0;\n    this.countModalDialog(null);', 'dialog.m_iDialogListChangeCount = 1;\n    this.countModalDialog(null);')
m(dm, 'remove: the modal dialogs are counted again', 'dialog.m_iDialogListChangeCount = 0;\n    this.countModalDialog(null);\n    return true;', 'dialog.m_iDialogListChangeCount = 0;\n    return true;')
m(dm, 'remove: the modal dialogs are counted again, not with the dialog', 'this.countModalDialog(null);\n    return true;', 'this.countModalDialog(dialog);\n    return true;')
m(dm, 'remove: a dialog that was in the list answers true', 'this.countModalDialog(null);\n    return true;', 'this.countModalDialog(null);\n    return false;')

# ---- ChangeFront / ChangeLayer ----------------------------------------------------------------------------------------------------------
CF = 'changeFront(dialog: CKTDGUIDialog | null, front: boolean): boolean {\n    if (!this.checkDlg(dialog)) return false;'
m(dm, 'ChangeFront: a dialog the manager does not know is changed', CF, CF.replace('    if (!this.checkDlg(dialog)) return false;', '    if (dialog === null) return false;'))
CF2 = '''    if (dialog.m_bFront !== front) {
      this.removeFromDialogList(dialog);
      dialog.m_bFront = front;
      this.insertIntoDialogListTop(dialog);
    }
    return true;'''
m(dm, 'ChangeFront: only a flag that changes moves the dialog', CF2, CF2.replace('dialog.m_bFront !== front', 'dialog.m_bFront === front'))
m(dm, 'ChangeFront: the dialog leaves the list', CF2, CF2.replace('      this.removeFromDialogList(dialog);\n', ''))
m(dm, 'ChangeFront: the dialog takes the flag', CF2, CF2.replace('      dialog.m_bFront = front;\n', ''))
m(dm, 'ChangeFront: the dialog comes back on top of its group', CF2, CF2.replace('      this.insertIntoDialogListTop(dialog);\n', ''))
m(dm, 'ChangeFront: true', CF2, CF2.replace('return true;', 'return false;'))
CL = 'changeLayer(dialog: CKTDGUIDialog | null, layer: number): boolean {\n    if (!this.checkDlg(dialog)) return false;'
m(dm, 'ChangeLayer: a dialog the manager does not know is changed', CL, CL.replace('    if (!this.checkDlg(dialog)) return false;', '    if (dialog === null) return false;'))
CL2 = '''    if (dialog.m_iLayer !== layer) {
      this.removeFromDialogList(dialog);
      dialog.m_iLayer = layer;
      this.insertIntoDialogListTop(dialog);
    }
    return true;'''
m(dm, 'ChangeLayer: only a layer that changes moves the dialog', CL2, CL2.replace('dialog.m_iLayer !== layer', 'dialog.m_iLayer === layer'))
m(dm, 'ChangeLayer: the dialog leaves the list', CL2, CL2.replace('      this.removeFromDialogList(dialog);\n', ''))
m(dm, 'ChangeLayer: the dialog takes the layer', CL2, CL2.replace('      dialog.m_iLayer = layer;\n', ''))
m(dm, 'ChangeLayer: the dialog comes back on top of its group', CL2, CL2.replace('      this.insertIntoDialogListTop(dialog);\n', ''))
m(dm, 'ChangeLayer: true', CL2, CL2.replace('return true;', 'return false;'))

# ---- ChangeSequence (top / bottom) ------------------------------------------------------------------------------------------------------
m(dm, 'ChangeSequence: the overload with a pivot is for a dialog as the second argument', 'if (typeof topOrPivot !== "boolean") return this.changeSequenceToPivot',
  'if (typeof topOrPivot === "boolean") return this.changeSequenceToPivot')
CS = 'const top = topOrPivot;\n    if (!this.checkDlg(dialog)) return false;'
m(dm, 'ChangeSequence: a dialog the manager does not know is moved', CS, 'const top = topOrPivot;\n    if (dialog === null) return false;')
STAY = 'if (Math.abs(dialog.m_iDialogListChangeCount) === this.m_iDialogListChangeCount) {'
m(dm, 'ChangeSequence: the dialog\'s count is read with its sign', STAY, 'if (dialog.m_iDialogListChangeCount === this.m_iDialogListChangeCount) {')
m(dm, 'ChangeSequence: a dialog that made the last change stays', STAY, 'if (Math.abs(dialog.m_iDialogListChangeCount) !== this.m_iDialogListChangeCount) {')
m(dm, 'ChangeSequence: the top: a positive count stays', 'if (top) {\n        if (dialog.m_iDialogListChangeCount > 0) return true;',
  'if (top) {\n        if (dialog.m_iDialogListChangeCount < 0) return true;')
m(dm, 'ChangeSequence: the top: a count of 0 does not stay', 'if (top) {\n        if (dialog.m_iDialogListChangeCount > 0) return true;',
  'if (top) {\n        if (dialog.m_iDialogListChangeCount >= 0) return true;',
  'equivalent: the count of a dialog in the list is never 0 (it is set to the count of changes, which is at least 1), and the manager\'s count is never 0 once a dialog joined')
m(dm, 'ChangeSequence: the bottom: a negative count stays', '} else if (dialog.m_iDialogListChangeCount < 0) {', '} else if (dialog.m_iDialogListChangeCount > 0) {')
m(dm, 'ChangeSequence: the bottom: a count of 0 does not stay', '} else if (dialog.m_iDialogListChangeCount < 0) {', '} else if (dialog.m_iDialogListChangeCount <= 0) {',
  'equivalent: the count of a dialog in the list is never 0 (it is set to the count of changes, which is at least 1), and the manager\'s count is never 0 once a dialog joined')
m(dm, 'ChangeSequence: a dialog that stays answers true', 'if (dialog.m_iDialogListChangeCount > 0) return true;', 'if (dialog.m_iDialogListChangeCount > 0) return false;')
m(dm, 'ChangeSequence: a dialog that stays answers true (the bottom)', '''} else if (dialog.m_iDialogListChangeCount < 0) {
        return true;''', '''} else if (dialog.m_iDialogListChangeCount < 0) {
        return false;''')
m(dm, 'ChangeSequence: the dialog leaves the list first', '    this.removeFromDialogList(dialog);\n    if (top) {', '    if (top) {')
m(dm, 'ChangeSequence: the top is the top', '    if (top) {\n      this.insertIntoDialogListTop(dialog);\n      return true;\n    }', '    if (!top) {\n      this.insertIntoDialogListTop(dialog);\n      return true;\n    }')
m(dm, 'ChangeSequence: the top answers true', '      this.insertIntoDialogListTop(dialog);\n      return true;\n    }', '      this.insertIntoDialogListTop(dialog);\n      return false;\n    }')
BOT = 'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer <= other.m_iLayer : other.m_bFront || dialog.m_iLayer <= other.m_iLayer;'
m(dm, 'bottom: a front dialog: before the front dialogs of a layer not below', BOT,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer < other.m_iLayer : other.m_bFront || dialog.m_iLayer <= other.m_iLayer;')
m(dm, 'bottom: a front dialog: a higher layer is not before it', BOT,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer >= other.m_iLayer : other.m_bFront || dialog.m_iLayer <= other.m_iLayer;')
m(dm, 'bottom: a front dialog: only the front dialogs count', BOT,
  'const before = dialog.m_bFront ? other.m_bFront || dialog.m_iLayer <= other.m_iLayer : other.m_bFront || dialog.m_iLayer <= other.m_iLayer;')
m(dm, 'bottom: a front dialog: the front flag decides', BOT,
  'const before = dialog.m_bFront ? dialog.m_iLayer <= other.m_iLayer : other.m_bFront || dialog.m_iLayer <= other.m_iLayer;')
m(dm, 'bottom: a dialog that is not front: before the front dialogs and the layers not below', BOT,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer <= other.m_iLayer : other.m_bFront && dialog.m_iLayer <= other.m_iLayer;')
m(dm, 'bottom: a dialog that is not front: a layer above is not before it', BOT,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer <= other.m_iLayer : other.m_bFront || dialog.m_iLayer < other.m_iLayer;')
m(dm, 'bottom: a dialog that is not front: a lower layer is not before it', BOT,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer <= other.m_iLayer : other.m_bFront || dialog.m_iLayer >= other.m_iLayer;')
m(dm, 'bottom: a dialog that is not front: the layer alone', BOT,
  'const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer <= other.m_iLayer : dialog.m_iLayer <= other.m_iLayer;')
m(dm, 'bottom: the flag decides', BOT,
  'const before = !dialog.m_bFront ? other.m_bFront && dialog.m_iLayer <= other.m_iLayer : other.m_bFront || dialog.m_iLayer <= other.m_iLayer;')
BOTTOM = '''    list.insert(at, dialog);
    this.m_setDialog.add(dialog);
    dialog.m_iDialogListChangeCount = -this.bumpChangeCount();
    this.countModalDialog(dialog);
    return true;'''
m(dm, 'bottom: the dialog goes in the list', BOTTOM, BOTTOM.replace('    list.insert(at, dialog);\n', ''))
m(dm, 'bottom: the dialog joins the set', BOTTOM, BOTTOM.replace('    this.m_setDialog.add(dialog);\n', ''))
m(dm, 'bottom: the count is negative', BOTTOM, BOTTOM.replace('-this.bumpChangeCount()', 'this.bumpChangeCount()'))
m(dm, 'bottom: the count of changes goes up', BOTTOM, BOTTOM.replace('-this.bumpChangeCount()', '-this.m_iDialogListChangeCount'))
m(dm, 'bottom: the modal dialogs are counted with the dialog', BOTTOM, BOTTOM.replace('countModalDialog(dialog)', 'countModalDialog(null)'))
m(dm, 'bottom: the modal dialogs are counted', BOTTOM, BOTTOM.replace('    this.countModalDialog(dialog);\n', ''))
m(dm, 'bottom: true', BOTTOM, BOTTOM.replace('return true;', 'return false;'))

# ---- ChangeSequence with a pivot --------------------------------------------------------------------------------------------------------
PV = 'changeLayer: boolean): boolean {\n    if (!this.checkDlg(dialog)) return false;\n    if (!this.checkDlg(pivot)) return false;\n    if (dialog === pivot) return false;'
m(dm, 'pivot: a dialog the manager does not know is moved', PV, PV.replace('    if (!this.checkDlg(dialog)) return false;\n', '    if (dialog === null) return false;\n'))
m(dm, 'pivot: a pivot the manager does not know is a pivot', PV, PV.replace('    if (!this.checkDlg(pivot)) return false;\n', '    if (pivot === null) return false;\n'))
m(dm, 'pivot: the dialog is not its own pivot', PV, PV.replace('    if (dialog === pivot) return false;', ''))
m(dm, 'pivot: the dialog is not its own pivot (inverted)', PV, PV.replace('dialog === pivot', 'dialog !== pivot'))
PL = '''    if (!changeLayer) {
      if (dialog.m_bFront !== pivot.m_bFront) return false;
      if (dialog.m_iLayer !== pivot.m_iLayer) return false;
    }'''
m(dm, 'pivot: without bChangeLayer the flags must be the pivot\'s', PL, PL.replace('!changeLayer', 'changeLayer'))
m(dm, 'pivot: the front flags must be the same', PL, PL.replace('      if (dialog.m_bFront !== pivot.m_bFront) return false;\n', ''))
m(dm, 'pivot: the front flags must be the same (inverted)', PL, PL.replace('dialog.m_bFront !== pivot.m_bFront', 'dialog.m_bFront === pivot.m_bFront'))
m(dm, 'pivot: the layers must be the same', PL, PL.replace('      if (dialog.m_iLayer !== pivot.m_iLayer) return false;\n', ''))
m(dm, 'pivot: the layers must be the same (inverted)', PL, PL.replace('dialog.m_iLayer !== pivot.m_iLayer', 'dialog.m_iLayer === pivot.m_iLayer'))
PR = '''    this.removeFromDialogList(dialog);
    dialog.m_bFront = pivot.m_bFront; // CKTDGUIDialogManagerAccess::SetFront / SetLayer (328E0AE0 / 328E0B20): the fields, no list work
    dialog.m_iLayer = pivot.m_iLayer;'''
m(dm, 'pivot: the dialog leaves the list', PR, PR.replace('    this.removeFromDialogList(dialog);\n', ''))
m(dm, 'pivot: the dialog takes the pivot\'s front flag', PR, PR.replace('dialog.m_bFront = pivot.m_bFront;', ''))
m(dm, 'pivot: the dialog takes the pivot\'s layer', PR, PR.replace('dialog.m_iLayer = pivot.m_iLayer;', ''))
PAT = '''    let at = list.find(pivot);
    if (at === null) return false; // the dialog is out of the list now (the exe leaves it so)
    if (over) at = at.next;
    list.insert(at, dialog);
    this.m_setDialog.add(dialog);
    dialog.m_iDialogListChangeCount = this.bumpChangeCount();
    return true;'''
m(dm, 'pivot: a pivot that is not in the list: false', PAT, PAT.replace('if (at === null) return false;', 'if (at === null) return true;'))
m(dm, 'pivot: over: after the pivot', PAT, PAT.replace('if (over) at = at.next;', 'if (!over) at = at.next;'))
m(dm, 'pivot: over: after the pivot (always before)', PAT, PAT.replace('    if (over) at = at.next;\n', ''))
m(dm, 'pivot: the dialog goes in the list', PAT, PAT.replace('    list.insert(at, dialog);\n', ''))
m(dm, 'pivot: the dialog joins the set', PAT, PAT.replace('    this.m_setDialog.add(dialog);\n', ''))
m(dm, 'pivot: the count of changes goes up', PAT, PAT.replace('this.bumpChangeCount()', 'this.m_iDialogListChangeCount'))
m(dm, 'pivot: the count is positive', PAT, PAT.replace('= this.bumpChangeCount()', '= -this.bumpChangeCount()'))
m(dm, 'pivot: the modal dialogs are not counted again (the exe leaves them)', PAT, PAT.replace('    return true;', '    this.countModalDialog(dialog);\n    return true;'))
m(dm, 'pivot: true', PAT, PAT.replace('    return true;', '    return false;'))

# ---- UnmanageDlg, DeleteDlg, ClearAllDlg, ClearAllOKAndCancelMsgDlg ---------------------------------------------------------------------
UN = 'unmanageDlg(dialog: CKTDGUIDialog | null): boolean {\n    if (!this.checkDlg(dialog)) return false;\n    this.removeFromDialogList(dialog);\n    dialog.m_pkUIDialogManager = null;\n    return true;'
m(dm, 'UnmanageDlg: a dialog the manager does not know is let go', UN, UN.replace('!this.checkDlg(dialog)', 'dialog === null'))
m(dm, 'UnmanageDlg: the dialog leaves the list', UN, UN.replace('    this.removeFromDialogList(dialog);\n', ''))
m(dm, 'UnmanageDlg: the dialog lets the manager go', UN, UN.replace('    dialog.m_pkUIDialogManager = null;\n', ''))
m(dm, 'UnmanageDlg: true', UN, UN.replace('return true;', 'return false;'))
m(dm, 'destroy: a destroyed dialog is not destroyed again', 'if (live(dialog)) dialog.Destroy();', 'dialog.Destroy();')
DEL = 'deleteDlg(dialog: CKTDGUIDialog | null): boolean {\n    if (!this.checkDlg(dialog)) return false;\n    this.unmanageDlg(dialog);\n    this.destroy(dialog);\n    return true;'
m(dm, 'DeleteDlg: a dialog the manager does not know is destroyed', DEL, DEL.replace('!this.checkDlg(dialog)', 'dialog === null'))
m(dm, 'DeleteDlg: the dialog leaves the manager', DEL, DEL.replace('    this.unmanageDlg(dialog);\n', ''))
m(dm, 'DeleteDlg: the dialog is destroyed', DEL, DEL.replace('    this.destroy(dialog);\n', ''))
m(dm, 'DeleteDlg: true', DEL, DEL.replace('return true;', 'return false;'))
CLR = '''    while (list.size !== 0) {
      const first = list.head.next.value!;
      if (this.checkDlg(first)) {
        this.removeFromDialogList(first);
        first.m_pkUIDialogManager = null;
      }
      this.destroy(first);
      if (list.head.next.value === first) throw new Error('''
m(dm, 'ClearAllDlg: until the list is empty', CLR, CLR.replace('list.size !== 0', 'list.size > 1'))
m(dm, 'ClearAllDlg: the first dialog of the list goes first', CLR, CLR.replace('list.head.next.value!', 'list.head.prev.value!'))
m(dm, 'ClearAllDlg: a dialog the manager does not know is taken out as well', CLR, CLR.replace('this.checkDlg(first)', 'first !== null'))
m(dm, 'ClearAllDlg: the dialog leaves the list', CLR, CLR.replace('        this.removeFromDialogList(first);\n', ''))
m(dm, 'ClearAllDlg: the dialog lets the manager go', CLR, CLR.replace('        first.m_pkUIDialogManager = null;\n', ''))
m(dm, 'ClearAllDlg: the dialog is destroyed', CLR, CLR.replace('      this.destroy(first);\n', ''))
m(dm, 'ClearAllDlg: the loop that never ends is reported', CLR, CLR.replace('list.head.next.value === first', 'list.head.next.value !== first'))
OK = '''    this.walkForward((dialog) => {
      if (!dialog.m_bOKAndCancelMsgBox) return;
      if (this.checkDlg(dialog)) {
        this.removeFromDialogList(dialog);
        dialog.m_pkUIDialogManager = null;
      }
      this.destroy(dialog);
    });
    return true;'''
m(dm, 'ClearAllOKAndCancelMsgDlg: only the message boxes', OK, OK.replace('if (!dialog.m_bOKAndCancelMsgBox) return;', 'if (dialog.m_bOKAndCancelMsgBox) return;'))
m(dm, 'ClearAllOKAndCancelMsgDlg: every message box', OK, OK.replace('      if (!dialog.m_bOKAndCancelMsgBox) return;\n', ''))
m(dm, 'ClearAllOKAndCancelMsgDlg: a box the manager does not know is taken out as well', OK, OK.replace('this.checkDlg(dialog)', 'dialog !== null'))
m(dm, 'ClearAllOKAndCancelMsgDlg: the box leaves the list', OK, OK.replace('        this.removeFromDialogList(dialog);\n', ''))
m(dm, 'ClearAllOKAndCancelMsgDlg: the box lets the manager go', OK, OK.replace('        dialog.m_pkUIDialogManager = null;\n', ''))
m(dm, 'ClearAllOKAndCancelMsgDlg: the box is destroyed', OK, OK.replace('      this.destroy(dialog);\n', ''))
m(dm, 'ClearAllOKAndCancelMsgDlg: true', OK, OK.replace('return true;', 'return false;'))

# ---- the walks --------------------------------------------------------------------------------------------------------------------------
WF = '''    walks.push(head.next);
    try {
      while (walks[walks.length - 1] !== head) {
        const node = walks[walks.length - 1]!;
        walks[walks.length - 1] = node.next;
        visit(node.value!);
      }
    } finally {
      walks.pop();
    }'''
m(dm, 'walk: forward: from the back of the list', WF, WF.replace('walks.push(head.next);', 'walks.push(head.prev);'))
m(dm, 'walk: forward: the position moves before the visit', WF, WF.replace('        walks[walks.length - 1] = node.next;\n        visit(node.value!);', '        visit(node.value!);\n        walks[walks.length - 1] = node.next;'))
m(dm, 'walk: forward: the position is given up', WF, WF.replace('      walks.pop();', ''))
WB = '''    walks.push(head.prev);
    try {
      while (walks[walks.length - 1] !== head) {
        const node = walks[walks.length - 1]!;
        walks[walks.length - 1] = node.prev; // (the exe tests for the first node: its `_Prev` is the sentinel, too)
        if (visit(node.value!)) break;
      }
    } finally {
      walks.pop();
    }'''
m(dm, 'walk: backward: from the front of the list', WB, WB.replace('walks.push(head.prev);', 'walks.push(head.next);'))
m(dm, 'walk: backward: the position moves before the visit', WB, WB.replace('        walks[walks.length - 1] = node.prev; // (the exe tests for the first node: its `_Prev` is the sentinel, too)\n        if (visit(node.value!)) break;',
                                                                         '        if (visit(node.value!)) break;\n        walks[walks.length - 1] = node.prev;'))
m(dm, 'walk: backward: a visit that answers true ends the walk', WB, WB.replace('if (visit(node.value!)) break;', 'visit(node.value!);'))
m(dm, 'walk: backward: the position is given up', WB, WB.replace('      walks.pop();', ''))
m(dm, 'walk: from the front, no position kept', 'for (let n = head.prev; n !== head; n = n.prev) if (visit(n.value!)) return;', 'for (let n = head.next; n !== head; n = n.next) if (visit(n.value!)) return;')
m(dm, 'walk: from the front, a visit that answers true ends the walk', 'for (let n = head.prev; n !== head; n = n.prev) if (visit(n.value!)) return;', 'for (let n = head.prev; n !== head; n = n.prev) visit(n.value!);')

# ---- GetDialog --------------------------------------------------------------------------------------------------------------------------
m(dm, 'GetDialog: no name, no dialog', 'if (name === null) return null;\n    let seen', 'let seen')
GD = '''    if (seen === undefined) {
      seen = 0; // `operator[]` makes the entry
      this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, 0);
    }
    if (seen === this.m_iDialogListChangeCount) return this.m_mapDialog.get(name) ?? null;'''
m(dm, 'GetDialog: operator[] makes the entry of a new name', GD, GD.replace('      this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, 0);\n', ''))
m(dm, 'GetDialog: a new name has the count 0', GD, GD.replace('seen = 0;', 'seen = -1;'))
m(dm, 'GetDialog: a name that was looked up since the last change is answered from the cache', GD, GD.replace('seen === this.m_iDialogListChangeCount', 'seen !== this.m_iDialogListChangeCount'))
m(dm, 'GetDialog: the cache answers with the dialog it holds', GD, GD.replace('return this.m_mapDialog.get(name) ?? null;', 'return null;'))
m(dm, 'GetDialog: a name the cache does not hold is null (no walk)', GD,
  GD.replace('return this.m_mapDialog.get(name) ?? null;', 'return this.m_mapDialog.get(name) ?? [...this.m_listDialog].find((x) => x.m_Name === name) ?? null;'))
GW = '''    for (const dialog of this.m_listDialog) {
      if (dialog.m_Name === name) {
        this.m_mapDialog.set(name, dialog);
        this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, this.m_iDialogListChangeCount);
        return dialog;
      }
    }
    this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, this.m_iDialogListChangeCount);
    return null;'''
m(dm, 'GetDialog: the list is walked from the back', GW, GW.replace('for (const dialog of this.m_listDialog) {', 'for (const dialog of [...this.m_listDialog].reverse()) {'))
m(dm, 'GetDialog: the name is compared exactly', GW, GW.replace('dialog.m_Name === name', 'dialog.m_Name.toLowerCase() === name.toLowerCase()'))
m(dm, 'GetDialog: the name is compared', GW, GW.replace('dialog.m_Name === name', 'dialog.m_Name !== name'))
m(dm, 'GetDialog: a dialog that is found goes in the cache', GW, GW.replace('        this.m_mapDialog.set(name, dialog);\n', ''))
m(dm, 'GetDialog: the count of a name that is found is noted', GW, GW.replace('        this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, this.m_iDialogListChangeCount);\n        return dialog;', '        return dialog;'))
m(dm, 'GetDialog: the count of a name that is lost is noted', GW, GW.replace('    }\n    this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, this.m_iDialogListChangeCount);\n    return null;', '    }\n    return null;'))
m(dm, 'GetDialog: a name that is found answers its dialog', GW, GW.replace('        return dialog;', '        return null;'))
LG = '''    if (name === undefined || name.length === 0) return undefined;
    const dialog = this.getDialog(name);
    return live(dialog) ? dialog : undefined;'''
m(dm, 'GetDialog (Lua): no name, nil', LG, LG.replace('name === undefined || ', ''))
m(dm, 'GetDialog (Lua): an empty name is not looked up', LG, LG.replace(' || name.length === 0', ''))
m(dm, 'GetDialog (Lua): a destroyed dialog is nil', LG, LG.replace('return live(dialog) ? dialog : undefined;', 'return dialog ?? undefined;'))

# ---- the getters ------------------------------------------------------------------------------------------------------------------------
FM = '''      if (!(dialog.m_bShow && !dialog.m_bModal)) return false;
      found = dialog;
      return true;'''
m(dm, 'GetFirstFrontModalDlg: a dialog must be shown', FM, FM.replace('dialog.m_bShow && !dialog.m_bModal', '!dialog.m_bModal'))
m(dm, 'GetFirstFrontModalDlg: a dialog must not be modal', FM, FM.replace('dialog.m_bShow && !dialog.m_bModal', 'dialog.m_bShow'))
m(dm, 'GetFirstFrontModalDlg: a dialog that is modal is the one', FM, FM.replace('dialog.m_bShow && !dialog.m_bModal', 'dialog.m_bShow && dialog.m_bModal'))
m(dm, 'GetFirstFrontModalDlg: the first one ends the search', FM, FM.replace('      return true;', '      return false;'))
ESC = '''      if (dialog.m_Name === "DLG_MsgBox") return false;
      if (dialog.m_bOKAndCancelMsgBox || dialog.m_Name === "DLG_OKMsgBox") {
        if (dialog.m_bShow) {
          dialog.ctx.diManager.m_bEnabled = true;
          found = dialog;
          return true;
        }
      }
      if (dialog.m_bShow && dialog.m_bEnable && dialog.m_CloseCustomUIEventID !== -1) {
        found = dialog;
        return true;
      }
      return dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal;'''
m(dm, 'GetCloseDialogByESC: DLG_MsgBox is passed', ESC, ESC.replace('      if (dialog.m_Name === "DLG_MsgBox") return false;\n', ''))
m(dm, 'GetCloseDialogByESC: only DLG_MsgBox is passed', ESC, ESC.replace('dialog.m_Name === "DLG_MsgBox"', 'dialog.m_Name.startsWith("DLG_")'))
m(dm, 'GetCloseDialogByESC: the OK / Cancel box', ESC, ESC.replace('dialog.m_bOKAndCancelMsgBox || dialog.m_Name === "DLG_OKMsgBox"', 'dialog.m_Name === "DLG_OKMsgBox"'))
m(dm, 'GetCloseDialogByESC: DLG_OKMsgBox', ESC, ESC.replace('dialog.m_bOKAndCancelMsgBox || dialog.m_Name === "DLG_OKMsgBox"', 'dialog.m_bOKAndCancelMsgBox'))
m(dm, 'GetCloseDialogByESC: both are message boxes', ESC, ESC.replace('dialog.m_bOKAndCancelMsgBox || dialog.m_Name === "DLG_OKMsgBox"', 'dialog.m_bOKAndCancelMsgBox && dialog.m_Name === "DLG_OKMsgBox"'))
m(dm, 'GetCloseDialogByESC: a message box must be shown', ESC, ESC.replace('        if (dialog.m_bShow) {\n          dialog.ctx', '        if (!dialog.m_bShow) {\n          dialog.ctx'))
m(dm, 'GetCloseDialogByESC: a message box turns the input on', ESC, ESC.replace('          dialog.ctx.diManager.m_bEnabled = true;\n', ''))
m(dm, 'GetCloseDialogByESC: a message box turns the input on, not off', ESC, ESC.replace('m_bEnabled = true;', 'm_bEnabled = false;'))
m(dm, 'GetCloseDialogByESC: a message box is the answer', ESC, ESC.replace('          found = dialog;\n          return true;\n        }\n      }', '          return true;\n        }\n      }'))
m(dm, 'GetCloseDialogByESC: a message box ends the search', ESC, ESC.replace('          return true;\n        }\n      }', '          return false;\n        }\n      }'))
m(dm, 'GetCloseDialogByESC: a close event: shown', ESC, ESC.replace('dialog.m_bShow && dialog.m_bEnable && dialog.m_CloseCustomUIEventID !== -1', 'dialog.m_bEnable && dialog.m_CloseCustomUIEventID !== -1'))
m(dm, 'GetCloseDialogByESC: a close event: enabled', ESC, ESC.replace('dialog.m_bShow && dialog.m_bEnable && dialog.m_CloseCustomUIEventID !== -1', 'dialog.m_bShow && dialog.m_CloseCustomUIEventID !== -1'))
m(dm, 'GetCloseDialogByESC: a close event: -1 is none', ESC, ESC.replace('dialog.m_CloseCustomUIEventID !== -1', 'dialog.m_CloseCustomUIEventID !== 0'))
m(dm, 'GetCloseDialogByESC: a close event: has one', ESC, ESC.replace('dialog.m_CloseCustomUIEventID !== -1', 'dialog.m_CloseCustomUIEventID === -1'))
m(dm, 'GetCloseDialogByESC: a close event is the answer', ESC, ESC.replace('      if (dialog.m_bShow && dialog.m_bEnable && dialog.m_CloseCustomUIEventID !== -1) {\n        found = dialog;', '      if (dialog.m_bShow && dialog.m_bEnable && dialog.m_CloseCustomUIEventID !== -1) {\n        found = null;'))
m(dm, 'GetCloseDialogByESC: a close event ends the search', ESC, ESC.replace('        found = dialog;\n        return true;\n      }\n      return', '        found = dialog;\n        return false;\n      }\n      return'))
m(dm, 'GetCloseDialogByESC: a dialog that is not modal ends the search: shown', ESC, ESC.replace('return dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal;', 'return dialog.m_bEnable && !dialog.m_bModal;'))
m(dm, 'GetCloseDialogByESC: a dialog that is not modal ends the search: enabled', ESC, ESC.replace('return dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal;', 'return dialog.m_bShow && !dialog.m_bModal;'))
m(dm, 'GetCloseDialogByESC: a dialog that is not modal ends the search: not modal', ESC, ESC.replace('return dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal;', 'return dialog.m_bShow && dialog.m_bEnable;'))
m(dm, 'GetCloseDialogByESC: a dialog that is not modal ends the search', ESC, ESC.replace('return dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal;', 'return false;'))
FE = '''    if (focus === null) return false;
    return focus.m_ControlType === UCT.IME_EDITBOX || focus.m_ControlType === UCT.EDITBOX;'''
m(dm, 'GetFocusInEditBox: no focus, no edit box', FE, FE.replace('    if (focus === null) return false;\n', ''))
m(dm, 'GetFocusInEditBox: an IME edit box', FE, FE.replace('focus.m_ControlType === UCT.IME_EDITBOX || ', ''))
m(dm, 'GetFocusInEditBox: an edit box', FE, FE.replace(' || focus.m_ControlType === UCT.EDITBOX', ''))
m(dm, 'GetFocusInEditBox: either', FE, FE.replace('||', '&&'))
DR = 'for (const d of this.m_listDialog) if (d.m_bShow && d.m_bEnable && d.m_bEnableMoveByDrag && d.m_bMouseDownForDrag) return true;\n    return false;'
m(dm, 'IsDraggingDialog: shown', DR, DR.replace('d.m_bShow && ', ''))
m(dm, 'IsDraggingDialog: enabled', DR, DR.replace('d.m_bEnable && ', ''))
m(dm, 'IsDraggingDialog: can be moved by dragging', DR, DR.replace('d.m_bEnableMoveByDrag && ', ''))
m(dm, 'IsDraggingDialog: the mouse is down', DR, DR.replace(' && d.m_bMouseDownForDrag', ''))
m(dm, 'IsDraggingDialog: any dialog', DR, DR.replace('return true;\n    return false;', 'return false;\n    return false;'))
m(dm, 'IsDraggingDialog: none by default', DR, DR.replace('\n    return false;', '\n    return true;'))
m(dm, 'SetStage: every dialog of the list', 'for (const d of this.m_listDialog) d.m_pStage = stage;', 'for (const d of [...this.m_listDialog].slice(1)) d.m_pStage = stage;')
m(dm, 'SetStage: the stage is set', 'for (const d of this.m_listDialog) d.m_pStage = stage;', 'for (const d of this.m_listDialog) d.m_pStage = null;')

# ---- OnFrameMove ------------------------------------------------------------------------------------------------------------------------
HID = 'const HIDDEN_LAYER_DIALOGS = ["DLG_ChatBox_EditBox", "DLG_MsgBox", "DLG_OKMsgBox", "OkAndCancelMsgBox"] as const;'
m(dm, 'hidden layer: the chat box edit', HID, HID.replace('"DLG_ChatBox_EditBox"', '"DLG_ChatBox"'))
m(dm, 'hidden layer: the message box', HID, HID.replace('"DLG_MsgBox"', '"DLG_MessageBox"'))
m(dm, 'hidden layer: the OK message box', HID, HID.replace('"DLG_OKMsgBox"', '"DLG_OkMsgBox"'))
m(dm, 'hidden layer: the OK and cancel message box', HID, HID.replace('"OkAndCancelMsgBox"', '"OKAndCancelMsgBox"'))
m(dm, 'hidden layer: the message boxes come after the chat box', HID, HID.replace('"DLG_ChatBox_EditBox", "DLG_MsgBox"', '"DLG_MsgBox", "DLG_ChatBox_EditBox"'))
m(dm, 'hidden layer: the OK box comes after the message box', HID, HID.replace('"DLG_MsgBox", "DLG_OKMsgBox"', '"DLG_OKMsgBox", "DLG_MsgBox"'))
m(dm, 'hidden layer: the OK and cancel box comes last', HID, HID.replace('"DLG_OKMsgBox", "OkAndCancelMsgBox"', '"OkAndCancelMsgBox", "DLG_OKMsgBox"'))
m(dm, 'hidden layer: three dialogs only', HID, HID.replace(', "OkAndCancelMsgBox"]', ']'))
FMV = '''    this.walkForward((dialog) => {
      if (!dialog.m_bCheckAutoDeleteEnd) return;
      if (this.checkDlg(dialog)) {
        this.removeFromDialogList(dialog);
        dialog.m_pkUIDialogManager = null;
      }
      this.destroy(dialog);
    });
    if (!this.m_bCanHide || this.m_bShow) {
      if (this.m_listDialog.size !== 0) {
        this.walkBackward((dialog) => {
          if (dialog.m_bEnable && dialog.m_bShow) {
            dialog.ctx.devices.massFiles.log.setLastErrorLog(dialog.m_Name);
            dialog.onFrameMove(fTime, fElapsedTime);
          }
          return false;
        });
      }
    } else {
      for (const name of HIDDEN_LAYER_DIALOGS) {
        const dialog = this.getDialog(name);
        if (live(dialog)) dialog.onFrameMove(fTime, fElapsedTime);
      }
    }
    return 0;'''
m(dm, 'OnFrameMove: only the dialogs marked for deletion', FMV, FMV.replace('if (!dialog.m_bCheckAutoDeleteEnd) return;', 'if (dialog.m_bCheckAutoDeleteEnd) return;'))
m(dm, 'OnFrameMove: the dialogs marked for deletion', FMV, FMV.replace('      if (!dialog.m_bCheckAutoDeleteEnd) return;\n', ''))
m(dm, 'OnFrameMove: a marked dialog the manager does not know is taken out as well', FMV, FMV.replace('this.checkDlg(dialog)', 'dialog !== null'))
m(dm, 'OnFrameMove: a marked dialog leaves the list', FMV, FMV.replace('        this.removeFromDialogList(dialog);\n        dialog.m_pkUIDialogManager = null;\n      }\n      this.destroy(dialog);', '        dialog.m_pkUIDialogManager = null;\n      }\n      this.destroy(dialog);'))
m(dm, 'OnFrameMove: a marked dialog lets the manager go', FMV, FMV.replace('        this.removeFromDialogList(dialog);\n        dialog.m_pkUIDialogManager = null;\n      }\n      this.destroy(dialog);', '        this.removeFromDialogList(dialog);\n      }\n      this.destroy(dialog);'))
m(dm, 'OnFrameMove: a marked dialog is destroyed', FMV, FMV.replace('      this.destroy(dialog);\n    });\n    if', '    });\n    if'))
m(dm, 'OnFrameMove: a layer that can hide and is hidden', FMV, FMV.replace('if (!this.m_bCanHide || this.m_bShow) {\n      if (this.m_listDialog', 'if (!this.m_bCanHide && this.m_bShow) {\n      if (this.m_listDialog'))
m(dm, 'OnFrameMove: a layer that cannot hide moves', FMV, FMV.replace('if (!this.m_bCanHide || this.m_bShow) {\n      if (this.m_listDialog', 'if (this.m_bShow) {\n      if (this.m_listDialog'))
m(dm, 'OnFrameMove: a layer that is shown moves', FMV, FMV.replace('if (!this.m_bCanHide || this.m_bShow) {\n      if (this.m_listDialog', 'if (!this.m_bCanHide) {\n      if (this.m_listDialog'))
m(dm, 'OnFrameMove: an empty list is not walked', FMV, FMV.replace('if (this.m_listDialog.size !== 0) {\n        this.walkBackward', 'if (true) {\n        this.walkBackward'),
  'equivalent: the walk of an empty list visits nothing (the exe tests for it to keep its iterator off an empty list)')
m(dm, 'OnFrameMove: a dialog must be enabled', FMV, FMV.replace('dialog.m_bEnable && dialog.m_bShow', 'dialog.m_bShow'))
m(dm, 'OnFrameMove: a dialog must be shown', FMV, FMV.replace('dialog.m_bEnable && dialog.m_bShow', 'dialog.m_bEnable'))
m(dm, 'OnFrameMove: the last error is the dialog\'s name', FMV, FMV.replace('            dialog.ctx.devices.massFiles.log.setLastErrorLog(dialog.m_Name);\n', ''))
m(dm, 'OnFrameMove: the last error is set before the dialog moves', FMV, FMV.replace('            dialog.ctx.devices.massFiles.log.setLastErrorLog(dialog.m_Name);\n            dialog.onFrameMove(fTime, fElapsedTime);',
                                                                                  '            dialog.onFrameMove(fTime, fElapsedTime);\n            dialog.ctx.devices.massFiles.log.setLastErrorLog(dialog.m_Name);'))
m(dm, 'OnFrameMove: the dialog moves', FMV, FMV.replace('            dialog.onFrameMove(fTime, fElapsedTime);\n          }\n          return false;', '          }\n          return false;'))
m(dm, 'OnFrameMove: the times are handed on', FMV, FMV.replace('            dialog.onFrameMove(fTime, fElapsedTime);\n          }\n          return false;', '            dialog.onFrameMove(fElapsedTime, fTime);\n          }\n          return false;'))
m(dm, 'OnFrameMove: every dialog moves', FMV, FMV.replace('          return false;\n        });', '          return true;\n        });'))
m(dm, 'OnFrameMove: a hidden layer: a dialog that is there moves', FMV, FMV.replace('if (live(dialog)) dialog.onFrameMove(fTime, fElapsedTime);', 'if (dialog !== null) dialog.onFrameMove(fTime, fElapsedTime);'))
m(dm, 'OnFrameMove: a hidden layer: the times are handed on', FMV, FMV.replace('if (live(dialog)) dialog.onFrameMove(fTime, fElapsedTime);', 'if (live(dialog)) dialog.onFrameMove(fElapsedTime, fTime);'))
m(dm, 'OnFrameMove: a hidden layer: the dialog moves', FMV, FMV.replace('        if (live(dialog)) dialog.onFrameMove(fTime, fElapsedTime);\n', ''))
m(dm, 'OnFrameMove: 0', FMV, FMV.replace('    return 0;', '    return 1;'))

# ---- OnFrameRender, OnFrameRenderTopModal -----------------------------------------------------------------------------------------------
FR = '''    if (!this.m_bCanHide) {
      if (!this.m_bShow) return 0;
    } else if (!this.m_bShow) {
      for (const name of HIDDEN_LAYER_DIALOGS) {
        const dialog = this.getDialog(name);
        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);
      }
      return 0;
    }
    this.walkForwardTwice(
      (dialog) => {
        if (dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(false);
      },
      (dialog) => {
        if (dialog.m_bFront === bFront && dialog.m_bShow && dialog.m_pStaticGuideDesc !== null) dialog.m_pStaticGuideDesc.onFrameRender();
      },
    );
    if (CKTDGUISlot.s_pDragSlot !== null && bFront) CKTDGUISlot.s_pDragSlot.renderDragSlot();
    return 0;'''
m(dm, 'OnFrameRender: a layer that cannot hide', FR, FR.replace('if (!this.m_bCanHide) {\n      if (!this.m_bShow) return 0;', 'if (this.m_bCanHide) {\n      if (!this.m_bShow) return 0;'))
m(dm, 'OnFrameRender: a layer that cannot hide and is shown draws', FR, FR.replace('      if (!this.m_bShow) return 0;\n    } else', '      if (this.m_bShow) return 0;\n    } else'))
m(dm, 'OnFrameRender: a layer that cannot hide and is not shown draws nothing', FR, FR.replace('      if (!this.m_bShow) return 0;\n    } else', '    } else'))
m(dm, 'OnFrameRender: a layer that can hide and is shown draws', FR, FR.replace('} else if (!this.m_bShow) {', '} else if (this.m_bShow) {'))
m(dm, 'OnFrameRender: a hidden layer: a dialog that is there', FR, FR.replace('if (live(dialog) && dialog.m_bShow)', 'if (dialog !== null && dialog.m_bShow)'))
m(dm, 'OnFrameRender: a hidden layer: a dialog that is shown', FR, FR.replace('if (live(dialog) && dialog.m_bShow)', 'if (live(dialog))'))
m(dm, 'OnFrameRender: a hidden layer: the dialog is drawn', FR, FR.replace('        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);\n', ''))
m(dm, 'OnFrameRender: a hidden layer: the dialog is drawn without force', FR, FR.replace('        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);', '        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(true);'))
m(dm, 'OnFrameRender: a hidden layer draws only those four', FR, FR.replace('      for (const name of HIDDEN_LAYER_DIALOGS) {\n        const dialog = this.getDialog(name);\n        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);\n      }\n      return 0;', '      return 0;'))
m(dm, 'OnFrameRender: a hidden layer answers 0', FR, FR.replace('      }\n      return 0;\n    }\n    this.walk', '      }\n      return 1;\n    }\n    this.walk'))
m(dm, 'OnFrameRender: the dialogs of the front flag are drawn', FR, FR.replace('if (dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(false);', 'if (dialog.m_bFront !== bFront && dialog.m_bShow) dialog.onFrameRender(false);'))
m(dm, 'OnFrameRender: the dialogs that are shown are drawn', FR, FR.replace('if (dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(false);', 'if (dialog.m_bFront === bFront) dialog.onFrameRender(false);'))
m(dm, 'OnFrameRender: all the dialogs of the front flag are drawn', FR, FR.replace('if (dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(false);', 'if (dialog.m_bShow) dialog.onFrameRender(false);'))
m(dm, 'OnFrameRender: the dialogs are drawn', FR, FR.replace('if (dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(false);', 'if (dialog.m_bFront === bFront && dialog.m_bShow) void 0;'))
m(dm, 'OnFrameRender: the dialogs are drawn without force', FR, FR.replace('if (dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(false);', 'if (dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(true);'))
m(dm, 'OnFrameRender: the guide static: the front flag', FR, FR.replace('if (dialog.m_bFront === bFront && dialog.m_bShow && dialog.m_pStaticGuideDesc', 'if (dialog.m_bShow && dialog.m_pStaticGuideDesc'))
m(dm, 'OnFrameRender: the guide static: shown', FR, FR.replace('if (dialog.m_bFront === bFront && dialog.m_bShow && dialog.m_pStaticGuideDesc', 'if (dialog.m_bFront === bFront && dialog.m_pStaticGuideDesc'))
m(dm, 'OnFrameRender: the guide static: one that is there', FR, FR.replace('dialog.m_bShow && dialog.m_pStaticGuideDesc !== null) dialog.m_pStaticGuideDesc.onFrameRender();', 'dialog.m_bShow) dialog.m_pStaticGuideDesc!.onFrameRender();'))
m(dm, 'OnFrameRender: the guide static is drawn', FR, FR.replace('dialog.m_pStaticGuideDesc !== null) dialog.m_pStaticGuideDesc.onFrameRender();', 'dialog.m_pStaticGuideDesc !== null) void 0;'))
m(dm, 'OnFrameRender: the dragged slot: one that is there', FR, FR.replace('if (CKTDGUISlot.s_pDragSlot !== null && bFront)', 'if (bFront)'))
m(dm, 'OnFrameRender: the dragged slot: for the front dialogs', FR, FR.replace('if (CKTDGUISlot.s_pDragSlot !== null && bFront)', 'if (CKTDGUISlot.s_pDragSlot !== null)'))
m(dm, 'OnFrameRender: the dragged slot: for the dialogs behind it', FR, FR.replace('if (CKTDGUISlot.s_pDragSlot !== null && bFront)', 'if (CKTDGUISlot.s_pDragSlot !== null && !bFront)'))
m(dm, 'OnFrameRender: the dragged slot is drawn', FR, FR.replace('CKTDGUISlot.s_pDragSlot.renderDragSlot();', 'void 0;'))
m(dm, 'OnFrameRender: 0', FR, FR.replace('renderDragSlot();\n    return 0;', 'renderDragSlot();\n    return 1;'))
WT = '''    walks.push(head.next);
    try {
      while (walks[walks.length - 1] !== head) {
        const node = walks[walks.length - 1]!;
        walks[walks.length - 1] = node.next;
        first(node.value!);
      }
      walks[walks.length - 1] = head.next;
      while (walks[walks.length - 1] !== head) {
        const node = walks[walks.length - 1]!;
        walks[walks.length - 1] = node.next;
        second(node.value!);
      }
    } finally {
      walks.pop();
    }'''
m(dm, 'OnFrameRender: the second pass starts again at the back', WT, WT.replace('      walks[walks.length - 1] = head.next;\n', ''))
m(dm, 'OnFrameRender: the second pass starts at the back', WT, WT.replace('      walks[walks.length - 1] = head.next;\n', '      walks[walks.length - 1] = head.prev;\n'))
m(dm, 'OnFrameRender: the first pass moves on before the visit', WT, WT.replace('        walks[walks.length - 1] = node.next;\n        first(node.value!);', '        first(node.value!);\n        walks[walks.length - 1] = node.next;'))
m(dm, 'OnFrameRender: the second pass moves on before the visit', WT, WT.replace('        walks[walks.length - 1] = node.next;\n        second(node.value!);', '        second(node.value!);\n        walks[walks.length - 1] = node.next;'))
m(dm, 'OnFrameRender: the position is given up', WT, WT.replace('      walks.pop();', ''))
TM = '''    if (!this.m_bCanHide || this.m_bShow) {
      this.walkBackwardPlain((dialog) => {
        if (!(dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal)) return false;
        dialog.onFrameRender(false);
        return true;
      });
    }
    return 0;'''
m(dm, 'OnFrameRenderTopModal: a layer that can hide and is hidden draws nothing', TM, TM.replace('!this.m_bCanHide || this.m_bShow', '!this.m_bCanHide && this.m_bShow'))
m(dm, 'OnFrameRenderTopModal: a layer that cannot hide draws', TM, TM.replace('!this.m_bCanHide || this.m_bShow', 'this.m_bShow'))
m(dm, 'OnFrameRenderTopModal: a layer that is shown draws', TM, TM.replace('!this.m_bCanHide || this.m_bShow', '!this.m_bCanHide'))
m(dm, 'OnFrameRenderTopModal: a dialog must be enabled', TM, TM.replace('dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal', 'dialog.m_bShow && !dialog.m_bModal'))
m(dm, 'OnFrameRenderTopModal: a dialog must be shown', TM, TM.replace('dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal', 'dialog.m_bEnable && !dialog.m_bModal'))
m(dm, 'OnFrameRenderTopModal: a dialog must not be modal', TM, TM.replace('dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal', 'dialog.m_bEnable && dialog.m_bShow'))
m(dm, 'OnFrameRenderTopModal: the dialog is drawn', TM, TM.replace('        dialog.onFrameRender(false);\n', ''))
m(dm, 'OnFrameRenderTopModal: the dialog is drawn without force', TM, TM.replace('dialog.onFrameRender(false);', 'dialog.onFrameRender(true);'))
m(dm, 'OnFrameRenderTopModal: only the first one is drawn', TM, TM.replace('        dialog.onFrameRender(false);\n        return true;', '        dialog.onFrameRender(false);\n        return false;'))
m(dm, 'OnFrameRenderTopModal: 0', TM, TM.replace('    return 0;', '    return 1;'))

# ---- MsgProc ----------------------------------------------------------------------------------------------------------------------------
MP = '''    if (this.m_listDialog.size === 0) return false;
    let taken = false;
    this.walkBackward((dialog) => {
      if (dialog.msgProc(hWnd, uMsg, wParam, lParam)) {
        taken = true;
        return true;
      }
      // the dialog may have destroyed itself: its handle then reaches the null object, which is modal
      return live(dialog) && dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal;
    });
    if (CKTDGUISlot.s_pDragSlot !== null && (uMsg === WM_LBUTTONUP || uMsg === WM_RBUTTONUP)) CKTDGUISlot.returnDraggingItem();
    return taken;'''
m(dm, 'MsgProc: no dialog, false before anything else', MP, MP.replace('    if (this.m_listDialog.size === 0) return false;\n', ''))
m(dm, 'MsgProc: no dialog: false', MP, MP.replace('if (this.m_listDialog.size === 0) return false;', 'if (this.m_listDialog.size === 0) return true;'))
m(dm, 'MsgProc: the message goes to the dialog', MP, MP.replace('dialog.msgProc(hWnd, uMsg, wParam, lParam)', 'dialog.msgProc(hWnd, wParam, uMsg, lParam)'))
m(dm, 'MsgProc: the message goes to the dialog with its window', MP, MP.replace('dialog.msgProc(hWnd, uMsg, wParam, lParam)', 'dialog.msgProc(hWnd, uMsg, lParam, wParam)'))
m(dm, 'MsgProc: a dialog that takes the message answers true', MP, MP.replace('        taken = true;\n        return true;', '        return true;'))
m(dm, 'MsgProc: a dialog that takes the message ends the walk', MP, MP.replace('        taken = true;\n        return true;', '        taken = true;\n        return false;'))
m(dm, 'MsgProc: a dialog that is enabled, shown and not modal stops the walk: there', MP, MP.replace('return live(dialog) && dialog.m_bEnable', 'return dialog.m_bEnable'))
m(dm, 'MsgProc: a dialog that is enabled, shown and not modal stops the walk: enabled', MP, MP.replace('dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal;', 'dialog.m_bShow && !dialog.m_bModal;'))
m(dm, 'MsgProc: a dialog that is enabled, shown and not modal stops the walk: shown', MP, MP.replace('dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal;', 'dialog.m_bEnable && !dialog.m_bModal;'))
m(dm, 'MsgProc: a dialog that is enabled, shown and not modal stops the walk: not modal', MP, MP.replace('dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal;', 'dialog.m_bEnable && dialog.m_bShow;'))
m(dm, 'MsgProc: the dialogs go on', MP, MP.replace('return live(dialog) && dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal;', 'return false;'))
m(dm, 'MsgProc: the dragged slot is given back: one that is there', MP, MP.replace('CKTDGUISlot.s_pDragSlot !== null && (', '('),
  'equivalent: `CKTDGUISlot.returnDraggingItem` does nothing without a dragged slot')
m(dm, 'MsgProc: the dragged slot is given back after the left button went up', MP, MP.replace('(uMsg === WM_LBUTTONUP || uMsg === WM_RBUTTONUP)', '(uMsg === WM_RBUTTONUP)'))
m(dm, 'MsgProc: the dragged slot is given back after the right button went up', MP, MP.replace('(uMsg === WM_LBUTTONUP || uMsg === WM_RBUTTONUP)', '(uMsg === WM_LBUTTONUP)'))
m(dm, 'MsgProc: the dragged slot is given back after a button went up', MP, MP.replace('(uMsg === WM_LBUTTONUP || uMsg === WM_RBUTTONUP)', '(uMsg === WM_LBUTTONUP && uMsg === WM_RBUTTONUP)'))
m(dm, 'MsgProc: the dragged slot is given back', MP, MP.replace('CKTDGUISlot.returnDraggingItem();', 'void 0;'))
m(dm, 'MsgProc: the answer', MP, MP.replace('return taken;', 'return !taken;'))
m(dm, 'MsgProc: WM_LBUTTONUP', 'const WM_LBUTTONUP = 514;', 'const WM_LBUTTONUP = 513;')
m(dm, 'MsgProc: WM_RBUTTONUP', 'const WM_RBUTTONUP = 516;', 'const WM_RBUTTONUP = 517;')

# ---- dialog.ts: SetFront, SetLayer, ~CKTDGUIDialog --------------------------------------------------------------------------------------
d = 'dialog.ts'
m(d, 'dialog: a new dialog is in no list', 'm_iDialogListChangeCount = 0;\n  /** `m_bOKAndCancelMsgBox`', 'm_iDialogListChangeCount = 1;\n  /** `m_bOKAndCancelMsgBox`')
m(d, 'dialog: a new dialog is no message box', 'm_bOKAndCancelMsgBox = false;', 'm_bOKAndCancelMsgBox = true;')
m(d, 'dialog: a new dialog is not destroyed', '  destroyed = false;', '  destroyed = true;')
m(d, 'dialog: SetFront: a flag that is there is left', 'if (this.m_bFront === front) return;', 'if (this.m_bFront !== front) return;')
m(d, 'dialog: SetFront: a flag that is there is left alone', 'if (this.m_bFront === front) return;', '',
  'equivalent: with a manager `ChangeFront` leaves a flag that is there alone (and a dialog it does not know), without one the flag is set to the value it has')
m(d, 'dialog: SetFront: a dialog of a manager asks it', 'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeFront(this, front);\n    else this.m_bFront = front;',
  'if (this.m_pkUIDialogManager === null) this.m_pkUIDialogManager.changeFront(this, front);\n    else this.m_bFront = front;')
m(d, 'dialog: SetFront: a dialog of a manager does not set the flag itself', 'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeFront(this, front);\n    else this.m_bFront = front;',
  'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeFront(this, front);\n    this.m_bFront = front;')
m(d, 'dialog: SetFront: a dialog without a manager sets the flag', 'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeFront(this, front);\n    else this.m_bFront = front;',
  'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeFront(this, front);')
m(d, 'dialog: SetLayer: a layer that is there is left', 'if (layer === this.m_iLayer) return;', 'if (layer !== this.m_iLayer) return;')
m(d, 'dialog: SetLayer: a layer that is there is left alone', 'if (layer === this.m_iLayer) return;', '',
  'equivalent: with a manager `ChangeLayer` leaves a layer that is there alone (and a dialog it does not know), without one the layer is set to the value it has')
m(d, 'dialog: SetLayer: a dialog of a manager asks it', 'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeLayer(this, layer);\n    else this.m_iLayer = layer;',
  'if (this.m_pkUIDialogManager === null) this.m_pkUIDialogManager.changeLayer(this, layer);\n    else this.m_iLayer = layer;')
m(d, 'dialog: SetLayer: a dialog of a manager does not set the layer itself', 'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeLayer(this, layer);\n    else this.m_iLayer = layer;',
  'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeLayer(this, layer);\n    this.m_iLayer = layer;')
m(d, 'dialog: SetLayer: a dialog without a manager sets the layer', 'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeLayer(this, layer);\n    else this.m_iLayer = layer;',
  'if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeLayer(this, layer);')
DS = '''    if (this.m_pDialogGuideDesc !== null) {
      this.ctx.dialogManager.deleteDlg(this.m_pDialogGuideDesc);
      this.m_pDialogGuideDesc = null;
    }
    if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.unmanageDlg(this);
    const focus = this.ctx.controlFocus;
    if (focus !== null && focus.m_pDialog === this) {
      focus.onFocusOut();
      this.ctx.controlFocus = null;
    }
    this.m_mapRadioButtonGroupInfo.clear();
    for (let i = 0; i < this.m_ControlsList.length; i++) {
      const control = this.m_ControlsList[i];
      if (control) control.Destroy();
      this.m_ControlsList[i] = null as never;
    }
    this.m_ControlsList.length = 0;
    this.m_ControlsMap.clear();
    this.destroyed = true;'''
m(d, '~dialog: a guide dialog is deleted', DS, DS.replace('      this.ctx.dialogManager.deleteDlg(this.m_pDialogGuideDesc);\n', ''))
m(d, '~dialog: the guide dialog is let go', DS, DS.replace('      this.m_pDialogGuideDesc = null;\n', ''))
m(d, '~dialog: only a guide dialog that is there is deleted', DS, DS.replace('if (this.m_pDialogGuideDesc !== null) {', 'if (this.m_pDialogGuideDesc === null) {'))
m(d, '~dialog: the dialog leaves its manager', DS, DS.replace('    if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.unmanageDlg(this);\n', ''))
m(d, '~dialog: a manager that is there', DS, DS.replace('if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.unmanageDlg(this);', 'if (this.m_pkUIDialogManager === null) this.m_pkUIDialogManager!.unmanageDlg(this);'))
m(d, '~dialog: a control that has the focus', DS, DS.replace('if (focus !== null && focus.m_pDialog === this) {', 'if (focus !== null) {'))
m(d, '~dialog: a control of this dialog', DS, DS.replace('if (focus !== null && focus.m_pDialog === this) {', 'if (focus !== null && focus.m_pDialog !== this) {'))
m(d, '~dialog: the control loses the focus', DS, DS.replace('      focus.onFocusOut();\n', ''))
m(d, '~dialog: no control has the focus after it', DS, DS.replace('      this.ctx.controlFocus = null;\n', ''))
m(d, '~dialog: the radio button groups are dropped', DS, DS.replace('    this.m_mapRadioButtonGroupInfo.clear();\n', ''))
m(d, '~dialog: every control is destroyed', DS, DS.replace('      if (control) control.Destroy();\n', ''))
m(d, '~dialog: the controls are destroyed from the first', DS, DS.replace('for (let i = 0; i < this.m_ControlsList.length; i++) {', 'for (let i = this.m_ControlsList.length - 1; i >= 0; i--) {'))
m(d, '~dialog: every control is destroyed, not only the first', DS, DS.replace('for (let i = 0; i < this.m_ControlsList.length; i++) {', 'for (let i = 0; i < this.m_ControlsList.length && i < 1; i++) {'))
m(d, '~dialog: the entry of a control is cleared', DS, DS.replace('      this.m_ControlsList[i] = null as never;\n', ''))
m(d, '~dialog: the control list is emptied', DS, DS.replace('    this.m_ControlsList.length = 0;\n', ''))
m(d, '~dialog: the control map is emptied', DS, DS.replace('    this.m_ControlsMap.clear();\n', ''))
m(d, '~dialog: the dialog is destroyed', DS, DS.replace('    this.destroyed = true;', ''))

# ---- the small pieces -------------------------------------------------------------------------------------------------------------------
m('stdmap.ts', 'WStringMap.clear: the keys go', '    this.sorted.length = 0;\n    this.values.clear();', '    this.values.clear();')
m('stdmap.ts', 'WStringMap.clear: the values go', '    this.sorted.length = 0;\n    this.values.clear();', '    this.sorted.length = 0;')
m('input.ts', 'input manager: the input is on at first', 'export class UIInputManager {\n  m_bEnabled = true;', 'export class UIInputManager {\n  m_bEnabled = false;')
m('massfile.ts', 'ErrorLog: no last error at first', '  lastErrorLog = "";', '  lastErrorLog = "?";')
m('massfile.ts', 'ErrorLog: SetLastErrorLog keeps the text', '    this.lastErrorLog = text;', '')


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
                r = subprocess.run([BUN, 'test', '--bail', *TESTS[f]], cwd=ROOT, capture_output=True, text=True, timeout=90, preexec_fn=limits)
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
