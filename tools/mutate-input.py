#!/usr/bin/env python3
"""Mutation check of the mouse input of the controls (E5b): the focus helpers of control.ts and dialog.ts, and the `handleMouse` /
`scrollBarMsgProc` of the check box, the radio button, the slider and the scroll bar (checkbox.ts, radiobutton.ts, slider.ts, scrollbar.ts).  One
small change at a time is applied to a source file, the tests that replay the exe's answers (toggles-input, bars-input, focus) are run and the
script reports whether a test notices (killed) or not (SURVIVED).

    python3 tools/mutate-input.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

A mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed (the reason is out of date).
The reason (the last argument) says why no input can tell the mutant from the original.  `--check` only verifies that every anchor text occurs
exactly once; `--survivors=LOG` runs only the mutants that survived in an earlier run's output.  The source is restored after every mutant (also
on Ctrl-C), but do not run this with edits you cannot afford to lose in the mutated files and edit nothing meanwhile.  Needs `bun` in
./node_modules/.bin.  Each run has a 90 s timeout and an 8 GB address-space limit: a mutant that loops or blows up is killed, too.

A mutant of a handler is written as a change inside the text of the method (`h(...)`): the method is read from the file when the script starts, the
change must occur in it exactly once, and the whole method is the anchor.
"""
import os, re, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
T = 'packages/ui/test/'
SRC = {f: 'packages/ui/src/' + f for f in ('control.ts', 'dialog.ts', 'world.ts', 'checkbox.ts', 'radiobutton.ts', 'slider.ts', 'scrollbar.ts')}
FOCUS = [T + 'focus.test.ts', T + 'toggles-input.test.ts', T + 'bars-input.test.ts', T + 'controls-input.test.ts', T + 'input.test.ts']
TESTS = {
    'control.ts': FOCUS,
    'dialog.ts': FOCUS,
    'world.ts': [T + 'focus.test.ts'],
    'checkbox.ts': [T + 'toggles-input.test.ts'],
    'radiobutton.ts': [T + 'toggles-input.test.ts'],
    'slider.ts': [T + 'bars-input.test.ts', T + 'widgets.test.ts'],
    'scrollbar.ts': [T + 'bars-input.test.ts', T + 'widgets.test.ts', T + 'combobox.test.ts', T + 'listbox.test.ts'],
}

M = []


def m(f, name, a, b, why=''):
    M.append((f, name, a, b, why))


def path_of(f):
    return os.path.join(ROOT, SRC[f])


def block(f, start):
    """the text of the method of file f that begins with `start` and ends with its closing brace (the first line `  }` after it)"""
    src = open(path_of(f)).read()
    assert src.count(start) == 1, (f, start, src.count(start))
    i = src.index(start)
    return src[i:src.index('\n  }\n', i) + len('\n  }\n')]


def h(f, text, name, old, new, why=''):
    """a change inside the method `text` of file f (it must occur there once)"""
    assert text.count(old) == 1, (f, name, old, text.count(old))
    m(f, name, text, text.replace(old, new, 1), why)


# ================================================================ the focus helpers (control.ts, dialog.ts, world.ts)
ct = 'control.ts'
m(ct, 'requestFocus: the control that has the focus asks again: nothing happens', 'if (ctx.controlFocus !== control && control.canHaveFocus()) {',
  'if (control.canHaveFocus()) {')
m(ct, 'requestFocus: a control that cannot have the focus does not take it', 'if (ctx.controlFocus !== control && control.canHaveFocus()) {',
  'if (ctx.controlFocus !== control) {')
m(ct, 'requestFocus: the old control loses the focus first', '    ctx.controlFocus?.onFocusOut();\n    control.onFocusIn();\n    ctx.controlFocus = control;',
  '    control.onFocusIn();\n    ctx.controlFocus?.onFocusOut();\n    ctx.controlFocus = control;')
m(ct, 'requestFocus: the old control loses it', '    ctx.controlFocus?.onFocusOut();\n    control.onFocusIn();', '    control.onFocusIn();')
m(ct, 'requestFocus: the new control gets it', '    control.onFocusIn();\n    ctx.controlFocus = control;', '    ctx.controlFocus = control;')
m(ct, 'requestFocus: the global names the new control', '    control.onFocusIn();\n    ctx.controlFocus = control;', '    control.onFocusIn();')
m(ct, 'RequestFocus: a control whose dialog is gone asks nobody', 'if (this.liveDialog() !== null) requestFocus(this.ctx, this);', 'requestFocus(this.ctx, this);')
m(ct, 'RequestFocus: a control with no dialog asks nobody', 'if (this.liveDialog() !== null) requestFocus(this.ctx, this);', 'if (this.m_pDialog === null || this.m_pDialog.destroyed) requestFocus(this.ctx, this);')
m(ct, 'liveDialog: a destroyed dialog is not live', 'return dialog !== null && !dialog.destroyed ? dialog : null;', 'return dialog !== null ? dialog : null;')
m(ct, 'liveDialog: no dialog is none', 'return dialog !== null && !dialog.destroyed ? dialog : null;', 'return !dialog!.destroyed ? dialog : null;')
wd = 'world.ts'
m(wd, 'world: SetCapture holds the mouse', '  setCapture(): void {\n    this.mouseCaptured = true;', '  setCapture(): void {\n    this.mouseCaptured = false;')
m(wd, 'world: ReleaseCapture gives the mouse back', '  releaseCapture(): void {\n    this.mouseCaptured = false;', '  releaseCapture(): void {\n    this.mouseCaptured = true;')
m(wd, 'world: the mouse is free at first', 'mouseCaptured = false;\n\n  setCapture', 'mouseCaptured = true;\n\n  setCapture')
dg = 'dialog.ts'
m(dg, 'getControl: an index below 0 is none', 'if (typeof key === "number") return this.m_ControlsList[key] ?? null;',
  'if (typeof key === "number") return this.m_ControlsList.at(key) ?? null;')
m(dg, 'getRadioButtonGroupInfo: the record of the group', 'return this.m_mapRadioButtonGroupInfo.get(groupID) ?? null;',
  'return this.m_mapRadioButtonGroupInfo.get(groupID | 0) ?? null;', 'equivalent: a group id is an int already, so `| 0` changes nothing')

# ================================================================ CKTDGUICheckBox::HandleMouse (32931830)
cb = 'checkbox.ts'
CB = block(cb, '  override handleMouse(')
h(cb, CB, 'CheckBox: a disabled box takes nothing', 'if (!this.m_bEnable || !this.m_bShow) return false;', 'if (!this.m_bShow) return false;')
h(cb, CB, 'CheckBox: a hidden box takes nothing', 'if (!this.m_bEnable || !this.m_bShow) return false;', 'if (!this.m_bEnable) return false;')
h(cb, CB, 'CheckBox: a box that is disabled or hidden takes nothing, not only one that is both', '!this.m_bEnable || !this.m_bShow', '!this.m_bEnable && !this.m_bShow')
h(cb, CB, 'CheckBox: the double click presses like the button down', '      case 0x201:\n      case 0x203:\n', '      case 0x201:\n')
h(cb, CB, 'CheckBox: the button down needs the point in the box', 'if (!this.containsPoint(x, y)) return false;\n        this.m_bPressed = true;', 'this.m_bPressed = true;')
h(cb, CB, 'CheckBox: the button down presses the box', 'this.m_bPressed = true;\n        this.ctx.setCapture();', 'this.ctx.setCapture();')
h(cb, CB, 'CheckBox: the button down captures the mouse', 'this.ctx.setCapture();\n        if (!this.m_bHasFocus)', 'if (!this.m_bHasFocus)')
h(cb, CB, 'CheckBox: the button down asks for the focus only when m_bHasFocus is off', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);', 'requestFocus(this.ctx, this);')
h(cb, CB, 'CheckBox: the button down asks for the focus', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);', '')
h(cb, CB, 'CheckBox: the button down is taken', 'requestFocus(this.ctx, this);\n        return true;', 'requestFocus(this.ctx, this);\n        return false;')
h(cb, CB, 'CheckBox: the button up needs the box to be pressed', 'if (!this.m_bPressed) return false;', '')
h(cb, CB, 'CheckBox: the button up lets the box go', 'this.m_bPressed = false;\n        this.ctx.releaseCapture();', 'this.ctx.releaseCapture();')
h(cb, CB, 'CheckBox: the button up gives the mouse back', 'this.ctx.releaseCapture();\n        if (!this.containsPoint', 'if (!this.containsPoint')
h(cb, CB, 'CheckBox: a button up outside does not toggle', 'if (!this.containsPoint(x, y)) return true;\n        this.setCheckedInternal', 'this.setCheckedInternal')
h(cb, CB, 'CheckBox: a button up outside is taken', 'if (!this.containsPoint(x, y)) return true;', 'if (!this.containsPoint(x, y)) return false;')
h(cb, CB, 'CheckBox: the button up toggles', 'this.setCheckedInternal(!this.m_bChecked, true);', 'this.setCheckedInternal(this.m_bChecked, true);')
h(cb, CB, 'CheckBox: the button up toggles by input', 'this.setCheckedInternal(!this.m_bChecked, true);', 'this.setCheckedInternal(!this.m_bChecked, false);')
h(cb, CB, 'CheckBox: the button up is taken', 'this.setCheckedInternal(!this.m_bChecked, true);\n        return true;', 'this.setCheckedInternal(!this.m_bChecked, true);\n        return false;')
h(cb, CB, 'CheckBox: other messages are not taken', '      default:\n        return false;', '      default:\n        return true;')

# ================================================================ CKTDGUIRadioButton::HandleMouse (3294A680)
rb = 'radiobutton.ts'
RB = block(rb, '  override handleMouse(')
BD = block(rb, '  private buttonDown(')
CG = block(rb, '  private clearGroup(')
h(rb, RB, 'Radio: a disabled button takes nothing', 'if (!this.m_bEnable || !this.m_bShow) return false;', 'if (!this.m_bShow) return false;')
h(rb, RB, 'Radio: a hidden button takes nothing', 'if (!this.m_bEnable || !this.m_bShow) return false;', 'if (!this.m_bEnable) return false;')
h(rb, RB, 'Radio: a button that is disabled or hidden takes nothing, not only one that is both', '!this.m_bEnable || !this.m_bShow', '!this.m_bEnable && !this.m_bShow')
h(rb, RB, 'Radio: a checked button without the toggle does not press', '(!this.m_bEnableCheckToggle && this.m_bChecked) || !this.containsPoint(x, y)', '!this.containsPoint(x, y)')
h(rb, RB, 'Radio: the toggle does not stop a checked button from pressing', '(!this.m_bEnableCheckToggle && this.m_bChecked) || !this.containsPoint(x, y)', '(this.m_bEnableCheckToggle && this.m_bChecked) || !this.containsPoint(x, y)')
h(rb, RB, 'Radio: an unchecked button without the toggle presses', '(!this.m_bEnableCheckToggle && this.m_bChecked) || !this.containsPoint(x, y)', '(!this.m_bEnableCheckToggle || this.m_bChecked) || !this.containsPoint(x, y)')
h(rb, RB, 'Radio: the left button down needs the point in the button', '(!this.m_bEnableCheckToggle && this.m_bChecked) || !this.containsPoint(x, y)', '(!this.m_bEnableCheckToggle && this.m_bChecked)')
h(rb, RB, 'Radio: the left button down presses', 'this.m_bPressed = true;\n        return this.buttonDown();', 'return this.buttonDown();')
h(rb, RB, 'Radio: the left button up needs the button to be pressed', 'if (!this.m_bPressed) return false;', '')
h(rb, RB, 'Radio: the left button up lets the button go', 'this.m_bPressed = false;\n        this.ctx.releaseCapture();', 'this.ctx.releaseCapture();')
h(rb, RB, 'Radio: the left button up gives the mouse back', 'this.m_bPressed = false;\n        this.ctx.releaseCapture();', 'this.m_bPressed = false;')
h(rb, RB, 'Radio: a left button up outside is taken and does nothing', 'if (!this.containsPoint(x, y)) return true;\n        this.playSound', 'this.playSound')
h(rb, RB, 'Radio: a left button up outside is taken', 'if (!this.containsPoint(x, y)) return true;\n        this.playSound', 'if (!this.containsPoint(x, y)) return false;\n        this.playSound')
h(rb, RB, 'Radio: the left button up plays the sound', 'this.playSound(this.m_pSndCheck);\n        this.clearGroup(true);', 'this.clearGroup(true);')
h(rb, RB, 'Radio: the left button up clears the group', 'this.clearGroup(true);', '')
h(rb, RB, 'Radio: the left button up clears the group with the button itself', 'this.clearGroup(true);', 'this.clearGroup(false);')
h(rb, RB, 'Radio: the left button up checks the button', 'this.setCheckedInternal(this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, true);',
  'this.setCheckedInternal(this.m_bEnableCheckToggle ? this.m_bChecked : true, false, true);')
h(rb, RB, 'Radio: without the toggle the left button up checks the button', 'this.setCheckedInternal(this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, true);',
  'this.setCheckedInternal(!this.m_bChecked, false, true);')
h(rb, RB, 'Radio: with the toggle the left button up toggles the button', 'this.setCheckedInternal(this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, true);',
  'this.setCheckedInternal(true, false, true);')
h(rb, RB, 'Radio: the left button up is not a double click', 'this.setCheckedInternal(this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, true);',
  'this.setCheckedInternal(this.m_bEnableCheckToggle ? !this.m_bChecked : true, true, true);')
h(rb, RB, 'Radio: the left button up checks by input', 'this.setCheckedInternal(this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, true);',
  'this.setCheckedInternal(this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, false);')
h(rb, RB, 'Radio: the left button up is taken', 'this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, true);\n        return true;', 'this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, true);\n        return false;')
h(rb, RB, 'Radio: without double clicks a double click is taken', 'if (!this.m_bEnableDoubleClick) return true;', 'if (!this.m_bEnableDoubleClick) return false;')
h(rb, RB, 'Radio: a double click needs the point in the button', 'if (!this.containsPoint(x, y)) return false;\n        if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n        this.playSound',
  'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n        this.playSound')
h(rb, RB, 'Radio: a double click asks for the focus only when m_bHasFocus is off', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n        this.playSound', 'requestFocus(this.ctx, this);\n        this.playSound')
h(rb, RB, 'Radio: a double click asks for the focus', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n        this.playSound', 'this.playSound')
h(rb, RB, 'Radio: a double click plays the sound', 'this.playSound(this.m_pSndCheck);\n        this.clearGroup(false);', 'this.clearGroup(false);')
h(rb, RB, 'Radio: a double click clears the group', 'this.clearGroup(false);', '')
h(rb, RB, 'Radio: a double click clears the group without the button itself', 'this.clearGroup(false);', 'this.clearGroup(true);')
h(rb, RB, 'Radio: a double click checks the button', 'this.setCheckedInternal(true, true, true);', 'this.setCheckedInternal(false, true, true);')
h(rb, RB, 'Radio: a double click is a double click', 'this.setCheckedInternal(true, true, true);', 'this.setCheckedInternal(true, false, true);')
h(rb, RB, 'Radio: a double click checks by input', 'this.setCheckedInternal(true, true, true);', 'this.setCheckedInternal(true, true, false);')
h(rb, RB, 'Radio: a double click is taken', 'this.setCheckedInternal(true, true, true);\n        return true;', 'this.setCheckedInternal(true, true, true);\n        return false;')
h(rb, RB, 'Radio: the right button down needs the point in the button', 'if (!this.containsPoint(x, y)) return false;\n        this.m_bRButtonDown = true;', 'this.m_bRButtonDown = true;')
h(rb, RB, 'Radio: the right button down presses the right button', 'this.m_bRButtonDown = true;', '')
h(rb, RB, 'Radio: the right button up needs the right button to be down', 'if (!this.m_bRButtonDown) return false;', '')
h(rb, RB, 'Radio: the right button up lets the right button go', 'this.m_bRButtonDown = false;\n        this.ctx.releaseCapture();', 'this.ctx.releaseCapture();')
h(rb, RB, 'Radio: the right button up gives the mouse back', 'this.m_bRButtonDown = false;\n        this.ctx.releaseCapture();', 'this.m_bRButtonDown = false;')
h(rb, RB, 'Radio: a right button up outside sends nothing', 'if (!this.containsPoint(x, y) || !this.m_bHasFocus || this.m_CustomMsgRButtonUp === -1) return true;',
  'if (!this.m_bHasFocus || this.m_CustomMsgRButtonUp === -1) return true;')
h(rb, RB, 'Radio: a right button up without the focus sends nothing', 'if (!this.containsPoint(x, y) || !this.m_bHasFocus || this.m_CustomMsgRButtonUp === -1) return true;',
  'if (!this.containsPoint(x, y) || this.m_CustomMsgRButtonUp === -1) return true;')
h(rb, RB, 'Radio: a right button up without a message sends nothing', 'if (!this.containsPoint(x, y) || !this.m_bHasFocus || this.m_CustomMsgRButtonUp === -1) return true;',
  'if (!this.containsPoint(x, y) || !this.m_bHasFocus) return true;')
h(rb, RB, 'Radio: a right button up is taken whatever it sends', 'if (!this.containsPoint(x, y) || !this.m_bHasFocus || this.m_CustomMsgRButtonUp === -1) return true;',
  'if (!this.containsPoint(x, y) || !this.m_bHasFocus || this.m_CustomMsgRButtonUp === -1) return false;')
h(rb, RB, 'Radio: the right button up sends the custom message', 'this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgRButtonUp);', 'this.sendInternelEvent(UIM.CONTROL_EVENT, this.m_CustomMsgRButtonUp);')
h(rb, RB, 'Radio: the right button up is taken after the message', 'this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgRButtonUp);\n        return true;',
  'this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgRButtonUp);\n        return false;')
h(rb, RB, 'Radio: other messages are not taken', '      default:\n        return false;', '      default:\n        return true;')
h(rb, BD, 'Radio: a button down captures the mouse', 'this.ctx.setCapture();', '')
h(rb, BD, 'Radio: a button down asks for the focus only when m_bHasFocus is off', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);', 'requestFocus(this.ctx, this);')
h(rb, BD, 'Radio: a button down asks for the focus', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);', '')
h(rb, BD, 'Radio: a button down is taken', 'return true;', 'return false;')
h(rb, CG, 'Radio: the group scan reads the live dialog', 'const dialog = this.liveDialog();', 'const dialog = this.m_pDialog;')
h(rb, CG, 'Radio: a group that takes more than one is not scanned', 'if (info !== null && info.m_iMaxCheckCount !== 1) return;', 'if (info !== null && info.m_iMaxCheckCount > 1) return;')
h(rb, CG, 'Radio: a group that takes one is scanned', 'if (info !== null && info.m_iMaxCheckCount !== 1) return;', 'if (info !== null) return;')
h(rb, CG, 'Radio: a group with a record is scanned only when it takes one', 'if (info !== null && info.m_iMaxCheckCount !== 1) return;', '')
h(rb, CG, 'Radio: no dialog, no scan', 'if (dialog === null) return;', '')
h(rb, CG, 'Radio: the scan goes over the controls of the dialog', 'for (let i = 0; i < dialog.m_ControlsList.length; i++) {', 'for (let i = 1; i < dialog.m_ControlsList.length; i++) {')
h(rb, CG, 'Radio: the scan goes to the last control', 'for (let i = 0; i < dialog.m_ControlsList.length; i++) {', 'for (let i = 0; i < dialog.m_ControlsList.length - 1; i++) {')
h(rb, CG, 'Radio: the scan skips what is not a radio button', 'control.m_ControlType !== UCT.RADIOBUTTON', 'control.m_ControlType === UCT.STATIC')
h(rb, CG, 'Radio: the scan skips a control with no type check', 'if (control === null || control.m_ControlType !== UCT.RADIOBUTTON) continue;', 'if (control === null) continue;')
h(rb, CG, 'Radio: the scan unchecks the buttons of the group', 'radio.m_GroupID === this.m_GroupID &&', 'radio.m_GroupID !== this.m_GroupID &&')
h(rb, CG, 'Radio: the scan unchecks only the buttons of the group', 'radio.m_GroupID === this.m_GroupID &&', 'true &&')
h(rb, CG, 'Radio: the scan unchecks the button itself only when asked', '(includeThis || radio !== this)', '(radio !== this)')
h(rb, CG, 'Radio: the scan leaves the button itself alone only when asked', '(includeThis || radio !== this)', 'true')
h(rb, CG, 'Radio: the scan unchecks, not checks', 'radio.setCheckedInternal(false, false, false);', 'radio.setCheckedInternal(true, false, false);')
h(rb, CG, 'Radio: the scan does not tell the input', 'radio.setCheckedInternal(false, false, false);', 'radio.setCheckedInternal(false, false, true);')
h(rb, CG, 'Radio: the scan is no double click', 'radio.setCheckedInternal(false, false, false);', 'radio.setCheckedInternal(false, true, false);')

# ================================================================ CKTDGUISlider::HandleMouse (3294C9F0)
sl = 'slider.ts'
SL = block(sl, '  override handleMouse(')
h(sl, SL, 'Slider: a hidden slider takes nothing', 'if (!this.m_bShow || !this.m_bEnable) return false;', 'if (!this.m_bEnable) return false;')
h(sl, SL, 'Slider: a disabled slider takes nothing', 'if (!this.m_bShow || !this.m_bEnable) return false;', 'if (!this.m_bShow) return false;')
h(sl, SL, 'Slider: a slider that is hidden or disabled takes nothing, not only one that is both', '!this.m_bShow || !this.m_bEnable', '!this.m_bShow && !this.m_bEnable')
h(sl, SL, 'Slider: a move takes the slider only while the button is held', 'if (!this.m_bPressed) return false;\n        const box', 'const box')
h(sl, SL, 'Slider: a move is taken', 'this.setValueInternal(ftoi(value), true);\n        return true;', 'this.setValueInternal(ftoi(value), true);\n        return false;')
h(sl, SL, 'Slider: a move uses the slider\'s x', '(x + this.m_x + this.m_nDragOffset - box.left)', '(x + this.m_nDragOffset - box.left)')
h(sl, SL, 'Slider: a move uses the drag offset', '(x + this.m_x + this.m_nDragOffset - box.left)', '(x + this.m_x - box.left)')
h(sl, SL, 'Slider: a move is counted from the box\'s left edge', '(x + this.m_x + this.m_nDragOffset - box.left)', '(x + this.m_x + this.m_nDragOffset)')
h(sl, SL, 'Slider: a move subtracts the box\'s left edge', '(x + this.m_x + this.m_nDragOffset - box.left)', '(x + this.m_x + this.m_nDragOffset + box.left)')
h(sl, SL, 'Slider: a move adds the drag offset', '(x + this.m_x + this.m_nDragOffset - box.left)', '(x + this.m_x - this.m_nDragOffset - box.left)')
h(sl, SL, 'Slider: the range is in single precision', 'const range = f(((this.m_nMax - this.m_nMin) | 0));', 'const range = ((this.m_nMax - this.m_nMin) | 0);')
h(sl, SL, 'Slider: the range is max - min', 'const range = f(((this.m_nMax - this.m_nMin) | 0));', 'const range = f(((this.m_nMax + this.m_nMin) | 0));')
h(sl, SL, 'Slider: the minimum is in single precision', 'f(f(f(this.m_nMin) + 0.5)', 'f(f(this.m_nMin + 0.5)')
h(sl, SL, 'Slider: the minimum plus a half is in single precision', 'f(f(f(this.m_nMin) + 0.5)', 'f((f(this.m_nMin) + 0.5)')
h(sl, SL, 'Slider: the value starts a half above the minimum', 'f(f(f(this.m_nMin) + 0.5)', 'f(f(f(this.m_nMin) + 0)')
h(sl, SL, 'Slider: the value starts at the minimum', 'f(f(f(this.m_nMin) + 0.5)', 'f(f(f(0) + 0.5)')
h(sl, SL, 'Slider: the step per pixel is in single precision', 'f(f(range / f((box.right - box.left) | 0)) * f(along))', 'f((range / f((box.right - box.left) | 0)) * f(along))')
h(sl, SL, 'Slider: the width of the box is in single precision', 'f(f(range / f((box.right - box.left) | 0)) * f(along))', 'f(f(range / ((box.right - box.left) | 0)) * f(along))')
h(sl, SL, 'Slider: the distance is in single precision', 'f(f(range / f((box.right - box.left) | 0)) * f(along))', 'f(f(range / f((box.right - box.left) | 0)) * along)')
h(sl, SL, 'Slider: the step is the range over the box\'s width', 'f(f(range / f((box.right - box.left) | 0)) * f(along))', 'f(f(range / f((box.left - box.right) | 0)) * f(along))')
h(sl, SL, 'Slider: the box\'s width is read from the box, not the slider', 'f((box.right - box.left) | 0)', 'f(this.m_width)')
h(sl, SL, 'Slider: the value is cut towards zero and an overflow is the integer indefinite', 'this.setValueInternal(ftoi(value), true);', 'this.setValueInternal(Math.floor(value), true);')
h(sl, SL, 'Slider: an overflow of the value is the integer indefinite, not a wrap', 'this.setValueInternal(ftoi(value), true);', 'this.setValueInternal(Math.trunc(value) | 0, true);')
h(sl, SL, 'Slider: the value is rounded towards zero, not to the nearest', 'this.setValueInternal(ftoi(value), true);', 'this.setValueInternal(ftoi(Math.round(value)), true);')
h(sl, SL, 'Slider: a move tells the input', 'this.setValueInternal(ftoi(value), true);', 'this.setValueInternal(ftoi(value), false);',
  'equivalent: SetValueInternal does not read its second argument (the exe pushes it and never uses it)')
h(sl, SL, 'Slider: a double click takes the button like a left button down', '      case 0x201:\n      case 0x203:\n', '      case 0x201:\n')
h(sl, SL, 'Slider: the button holds the slider', 'this.m_bPressed = true;\n          this.ctx.setCapture();', 'this.ctx.setCapture();')
h(sl, SL, 'Slider: the button captures the mouse', 'this.ctx.setCapture();\n          this.m_nDragX = x;', 'this.m_nDragX = x;')
h(sl, SL, 'Slider: the button notes the drag point', 'this.m_nDragX = x;\n          this.m_nDragOffset = (this.m_nButtonX - x) | 0;', 'this.m_nDragOffset = (this.m_nButtonX - x) | 0;')
h(sl, SL, 'Slider: the button notes the offset of the button from the point', 'this.m_nDragOffset = (this.m_nButtonX - x) | 0;', 'this.m_nDragOffset = (x - this.m_nButtonX) | 0;')
h(sl, SL, 'Slider: the button notes an offset', 'this.m_nDragOffset = (this.m_nButtonX - x) | 0;', 'this.m_nDragOffset = 0;')
h(sl, SL, 'Slider: the button asks for the focus only when m_bHasFocus is off', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n          return true;', 'requestFocus(this.ctx, this);\n          return true;')
h(sl, SL, 'Slider: the button asks for the focus', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n          return true;', 'return true;')
h(sl, SL, 'Slider: the button down is taken', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n          return true;', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n          return false;')
h(sl, SL, 'Slider: the button is the button\'s rectangle', 'if (ptInRect(this.m_rcButton, pt)) {', 'if (ptInRect(this.m_rcBoundingBox, pt)) {')
h(sl, SL, 'Slider: off the bar the button down is not taken', 'if (!ptInRect(this.m_rcBoundingBox, pt)) return false;', '')
h(sl, SL, 'Slider: the bar is the bounding box', 'if (!ptInRect(this.m_rcBoundingBox, pt)) return false;', 'if (!ptInRect(this.m_rcButton, pt)) return false;')
h(sl, SL, 'Slider: the bar notes the drag point', 'this.m_nDragX = x;\n        this.m_nDragOffset = 0;', 'this.m_nDragOffset = 0;')
h(sl, SL, 'Slider: the bar notes an offset of 0', 'this.m_nDragX = x;\n        this.m_nDragOffset = 0;', 'this.m_nDragX = x;')
h(sl, SL, 'Slider: the bar asks for the focus only when m_bHasFocus is off', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n        {', 'requestFocus(this.ctx, this);\n        {')
h(sl, SL, 'Slider: the bar asks for the focus', 'if (!this.m_bHasFocus) requestFocus(this.ctx, this);\n        {', '{')
h(sl, SL, 'Slider: the button\'s place includes the slider\'s x', 'const place = (this.m_nButtonX + this.m_x) | 0;', 'const place = (this.m_nButtonX) | 0;')
h(sl, SL, 'Slider: the button\'s place is its distance from the left edge', 'const place = (this.m_nButtonX + this.m_x) | 0;', 'const place = (this.m_x) | 0;')
h(sl, SL, 'Slider: right of the button\'s place the value goes up', 'if (x > place) {', 'if (x >= place) {')
h(sl, SL, 'Slider: right of the button\'s place the value goes up by one', 'this.setValueInternal((this.m_nValue + 1) | 0, true);', 'this.setValueInternal((this.m_nValue + 2) | 0, true);')
h(sl, SL, 'Slider: right of the button\'s place the step is up', 'this.setValueInternal((this.m_nValue + 1) | 0, true);', 'this.setValueInternal((this.m_nValue - 1) | 0, true);')
h(sl, SL, 'Slider: left of the button\'s place the value goes down', 'if (x < place) {', 'if (x <= place) {')
h(sl, SL, 'Slider: left of the button\'s place the value goes down by one', 'this.setValueInternal((this.m_nValue - 1) | 0, true);', 'this.setValueInternal((this.m_nValue - 2) | 0, true);')
h(sl, SL, 'Slider: left of the button\'s place the step is down', 'this.setValueInternal((this.m_nValue - 1) | 0, true);', 'this.setValueInternal((this.m_nValue + 1) | 0, true);')
h(sl, SL, 'Slider: right of the button\'s place the button down is taken', 'this.setValueInternal((this.m_nValue + 1) | 0, true);\n            return true;', 'this.setValueInternal((this.m_nValue + 1) | 0, true);\n            return false;')
h(sl, SL, 'Slider: left of the button\'s place the button down is taken', 'this.setValueInternal((this.m_nValue - 1) | 0, true);\n            return true;', 'this.setValueInternal((this.m_nValue - 1) | 0, true);\n            return false;')
h(sl, SL, 'Slider: at the button\'s place the button down is not taken', '        }\n        return false;\n      case 0x202:', '        }\n        return true;\n      case 0x202:')
h(sl, SL, 'Slider: the button up needs the button to be held', 'if (!this.m_bPressed) return false;\n        this.m_bPressed = false;', 'this.m_bPressed = false;')
h(sl, SL, 'Slider: the button up lets the button go', 'this.m_bPressed = false;\n        this.ctx.releaseCapture();', 'this.ctx.releaseCapture();')
h(sl, SL, 'Slider: the button up gives the mouse back', 'this.ctx.releaseCapture();\n        if (this.m_CustomMsgValueChanged === -1)', 'if (this.m_CustomMsgValueChanged === -1)')
h(sl, SL, 'Slider: without a custom message the button up sends the control event', 'if (this.m_CustomMsgValueChanged === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 0);', 'if (this.m_CustomMsgValueChanged !== -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 0);')
h(sl, SL, 'Slider: the control event of the button up carries 0', 'this.sendInternelEvent(UIM.CONTROL_EVENT, 0);\n        else', 'this.sendInternelEvent(UIM.CONTROL_EVENT, 1);\n        else')
h(sl, SL, 'Slider: with a custom message the button up sends it', 'else this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgValueChanged);', 'else this.sendInternelEvent(UIM.CUSTOM_MSG, 0);')
h(sl, SL, 'Slider: the button up is taken', 'this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgValueChanged);\n        return true;', 'this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgValueChanged);\n        return false;')
h(sl, SL, 'Slider: the wheel moves the value by the notches', 'idiv(((wParam >>> 16) << 16) >> 16, 120)', 'idiv(((wParam >>> 16) << 16) >> 16, 60)')
h(sl, SL, 'Slider: the wheel delta is signed', 'idiv(((wParam >>> 16) << 16) >> 16, 120)', 'idiv(wParam >>> 16, 120)')
h(sl, SL, 'Slider: the wheel delta is cut towards zero', 'idiv(((wParam >>> 16) << 16) >> 16, 120)', 'Math.floor((((wParam >>> 16) << 16) >> 16) / 120)')
h(sl, SL, 'Slider: the wheel delta is the high word', 'idiv(((wParam >>> 16) << 16) >> 16, 120)', 'idiv(((wParam << 16) >> 16), 120)')
h(sl, SL, 'Slider: the wheel up lowers the value', 'this.setValueInternal((this.m_nValue - notches) | 0, true);', 'this.setValueInternal((this.m_nValue + notches) | 0, true);')
h(sl, SL, 'Slider: the wheel is taken', 'this.setValueInternal((this.m_nValue - notches) | 0, true);\n        return true;', 'this.setValueInternal((this.m_nValue - notches) | 0, true);\n        return false;')
h(sl, SL, 'Slider: the wheel is taken wherever the mouse is', '      case 0x20a: {', '      case 0x20a: if (!ptInRect(this.m_rcBoundingBox, pt)) return false; {')
h(sl, SL, 'Slider: other messages are not taken', '      default:\n        return false;', '      default:\n        return true;')

# ================================================================ CKTDGUIScrollBar::HandleMouse (32985B00) and MsgProc (32985E10)
sb = 'scrollbar.ts'
SB = block(sb, '  override handleMouse(')
MP = block(sb, '  scrollBarMsgProc(')
h(sb, SB, 'ScrollBar: a hidden bar takes nothing', 'if (!this.m_bShow || !this.m_bEnable) return false;', 'if (!this.m_bEnable) return false;')
h(sb, SB, 'ScrollBar: a disabled bar takes nothing', 'if (!this.m_bShow || !this.m_bEnable) return false;', 'if (!this.m_bShow) return false;')
h(sb, SB, 'ScrollBar: a bar that is hidden or disabled takes nothing, not only one that is both', '!this.m_bShow || !this.m_bEnable', '!this.m_bShow && !this.m_bEnable')
h(sb, SB, 'ScrollBar: the bar remembers the x of the mouse', '    this.m_LastMouse.x = x;\n', '')
h(sb, SB, 'ScrollBar: the bar remembers the y of the mouse', '    this.m_LastMouse.y = y;\n', '')
h(sb, SB, 'ScrollBar: the bar remembers the x of the mouse as x', '    this.m_LastMouse.x = x;\n', '    this.m_LastMouse.x = y;\n')
h(sb, SB, 'ScrollBar: the bar remembers the y of the mouse as y', '    this.m_LastMouse.y = y;\n', '    this.m_LastMouse.y = x;\n')
h(sb, SB, 'ScrollBar: a move takes the bar only while it is dragged', 'if (!this.m_bDrag) return false;', '')
h(sb, SB, 'ScrollBar: a move puts the thumb\'s bottom where the mouse holds it', 'const bottom = (y + thumb.bottom - thumb.top - statics.thumbOffsetY) | 0;', 'const bottom = (y + thumb.bottom - thumb.top) | 0;')
h(sb, SB, 'ScrollBar: a move puts the thumb\'s bottom its height below the top', 'const bottom = (y + thumb.bottom - thumb.top - statics.thumbOffsetY) | 0;', 'const bottom = (y - statics.thumbOffsetY) | 0;')
h(sb, SB, 'ScrollBar: a move puts the thumb\'s top where the mouse holds it', 'const top = (y - statics.thumbOffsetY) | 0;', 'const top = (y) | 0;')
h(sb, SB, 'ScrollBar: a move holds the thumb by the offset of the press', 'const top = (y - statics.thumbOffsetY) | 0;', 'const top = (y + statics.thumbOffsetY) | 0;')
h(sb, SB, 'ScrollBar: a move writes the thumb\'s bottom', '        thumb.bottom = bottom;\n', '')
h(sb, SB, 'ScrollBar: a move writes the thumb\'s top', '        thumb.top = top;\n', '')
h(sb, SB, 'ScrollBar: a thumb above the track is pushed down', 'if (top < track.top) offsetRect(thumb, 0, (track.top - top) | 0);', 'if (top <= track.top) offsetRect(thumb, 0, (track.top - top) | 0);',
  'equivalent: at the top of the track the push is 0')
h(sb, SB, 'ScrollBar: a thumb above the track is pushed to the track', 'if (top < track.top) offsetRect(thumb, 0, (track.top - top) | 0);', 'if (top < track.top) offsetRect(thumb, 0, (top - track.top) | 0);')
h(sb, SB, 'ScrollBar: a thumb above the track is pushed back', 'if (top < track.top) offsetRect(thumb, 0, (track.top - top) | 0);\n        else if', 'if (false) offsetRect(thumb, 0, (track.top - top) | 0);\n        else if')
h(sb, SB, 'ScrollBar: a thumb below the track is pushed up', 'else if (bottom > track.bottom) offsetRect(thumb, 0, (track.bottom - bottom) | 0);', 'else if (bottom >= track.bottom) offsetRect(thumb, 0, (track.bottom - bottom) | 0);',
  'equivalent: at the bottom of the track the push is 0')
h(sb, SB, 'ScrollBar: a thumb below the track is pushed to the track', 'else if (bottom > track.bottom) offsetRect(thumb, 0, (track.bottom - bottom) | 0);', 'else if (bottom > track.bottom) offsetRect(thumb, 0, (bottom - track.bottom) | 0);')
h(sb, SB, 'ScrollBar: a thumb below the track is pushed back', 'else if (bottom > track.bottom) offsetRect(thumb, 0, (track.bottom - bottom) | 0);', '')
h(sb, SB, 'ScrollBar: the gap is the track less the thumb', 'const gap = (thumb.top - thumb.bottom - track.top + track.bottom) | 0;', 'const gap = (thumb.top - thumb.bottom + track.top + track.bottom) | 0;')
h(sb, SB, 'ScrollBar: the gap is read after the thumb was pushed', 'const gap = (thumb.top - thumb.bottom - track.top + track.bottom) | 0;', 'const gap = (track.bottom - track.top - (bottom - top)) | 0;')
h(sb, SB, 'ScrollBar: the range is the track less a page', 'const range = (this.m_nEnd - this.m_nStart - this.m_nPageSize) | 0;', 'const range = (this.m_nEnd - this.m_nStart) | 0;')
h(sb, SB, 'ScrollBar: the range starts at the start', 'const range = (this.m_nEnd - this.m_nStart - this.m_nPageSize) | 0;', 'const range = (this.m_nEnd - this.m_nPageSize) | 0;')
h(sb, SB, 'ScrollBar: with no range the position stays', 'if (range === 0 || gap === 0) return true;', 'if (gap === 0) return true;')
h(sb, SB, 'ScrollBar: with no gap the position stays', 'if (range === 0 || gap === 0) return true;', 'if (range === 0) return true;')
h(sb, SB, 'ScrollBar: with no range or no gap the move is taken', 'if (range === 0 || gap === 0) return true;', 'if (range === 0 || gap === 0) return false;')
h(sb, SB, 'ScrollBar: the half step is twice the range', 'idiv(gap, (2 * range) | 0)', 'idiv(gap, range)')
h(sb, SB, 'ScrollBar: the half step divides, cutting towards zero', 'idiv(gap, (2 * range) | 0)', 'Math.floor(gap / ((2 * range) | 0))')
h(sb, SB, 'ScrollBar: the share is counted from the track\'s top', '- track.top + thumb.top)', '+ thumb.top)')
h(sb, SB, 'ScrollBar: the share is counted to the thumb\'s top', '- track.top + thumb.top)', '- track.top)')
h(sb, SB, 'ScrollBar: the share is the range over the gap', 'idiv(imul(range, (idiv(gap, (2 * range) | 0) - track.top + thumb.top) | 0), gap)', 'idiv(imul(range, (idiv(gap, (2 * range) | 0) - track.top + thumb.top) | 0), range)')
h(sb, SB, 'ScrollBar: the share divides, cutting towards zero', 'idiv(imul(range, (idiv(gap, (2 * range) | 0) - track.top + thumb.top) | 0), gap)', 'Math.floor(imul(range, (idiv(gap, (2 * range) | 0) - track.top + thumb.top) | 0) / gap)')
h(sb, SB, 'ScrollBar: the share is a product in 32 bits', 'idiv(imul(range, (idiv(gap, (2 * range) | 0) - track.top + thumb.top) | 0), gap)', 'idiv(((range * (idiv(gap, (2 * range) | 0) - track.top + thumb.top)) | 0) + 0, gap)',
  'equivalent: a product of two ints below 2^53 wraps to the same 32 bits with `| 0`, so imul gives the same result')
h(sb, SB, 'ScrollBar: the position starts at the start', 'this.m_nPosition = (share + this.m_nStart) | 0;', 'this.m_nPosition = (share) | 0;')
h(sb, SB, 'ScrollBar: a move is taken', 'this.m_nPosition = (share + this.m_nStart) | 0;\n        return true;', 'this.m_nPosition = (share + this.m_nStart) | 0;\n        return false;')
h(sb, SB, 'ScrollBar: a double click is a left button down', '      case 0x201:\n      case 0x203: {', '      case 0x201: {')
h(sb, SB, 'ScrollBar: the up button captures the mouse', 'if (ptInRect(this.m_rcUpButton, pt)) {\n          this.ctx.setCapture();', 'if (ptInRect(this.m_rcUpButton, pt)) {')
h(sb, SB, 'ScrollBar: the up button is the up button\'s rectangle', 'ptInRect(this.m_rcUpButton, pt)', 'ptInRect(this.m_rcDownButton, pt)')
h(sb, SB, 'ScrollBar: the up button steps back above the start', 'if (this.m_nPosition > this.m_nStart) this.m_nPosition = (this.m_nPosition - 1) | 0;', 'if (this.m_nPosition >= this.m_nStart) this.m_nPosition = (this.m_nPosition - 1) | 0;')
h(sb, SB, 'ScrollBar: the up button steps back', 'if (this.m_nPosition > this.m_nStart) this.m_nPosition = (this.m_nPosition - 1) | 0;', 'if (this.m_nPosition > this.m_nStart) this.m_nPosition = (this.m_nPosition + 1) | 0;')
h(sb, SB, 'ScrollBar: the up button steps back above the start, not above 0', 'if (this.m_nPosition > this.m_nStart) this.m_nPosition = (this.m_nPosition - 1) | 0;', 'if (this.m_nPosition > 0) this.m_nPosition = (this.m_nPosition - 1) | 0;')
h(sb, SB, 'ScrollBar: the up button updates the thumb', '          this.updateThumbRect();\n          this.m_Arrow = ARROWSTATE.CLICKED_UP;', '          this.m_Arrow = ARROWSTATE.CLICKED_UP;')
h(sb, SB, 'ScrollBar: the up button sets the arrow', 'this.m_Arrow = ARROWSTATE.CLICKED_UP;', 'this.m_Arrow = ARROWSTATE.CLICKED_DOWN;')
h(sb, SB, 'ScrollBar: the up button sets the arrow state', 'this.m_Arrow = ARROWSTATE.CLICKED_UP;', '')
h(sb, SB, 'ScrollBar: the up button notes the time', 'const now = this.ctx.devices.absoluteTime();\n          this.m_bIsUpButtonClicked = true;\n          this.m_dArrowTS = now;', 'const now = this.ctx.devices.absoluteTime();\n          this.m_bIsUpButtonClicked = true;')
h(sb, SB, 'ScrollBar: the up button notes the time it was pressed', 'const now = this.ctx.devices.absoluteTime();\n          this.m_bIsUpButtonClicked = true;\n          this.m_dArrowTS = now;', 'const now = 0;\n          this.m_bIsUpButtonClicked = true;\n          this.m_dArrowTS = now;')
h(sb, SB, 'ScrollBar: the up button is clicked', 'this.m_bIsUpButtonClicked = true;', 'this.m_bIsDownButtonClicked = true;')
h(sb, SB, 'ScrollBar: the up button is marked clicked', 'this.m_bIsUpButtonClicked = true;', '')
h(sb, SB, 'ScrollBar: the up button plays the sound', 'this.m_dArrowTS = now;\n          this.playSound(this.m_pSndMouseDown);\n          return true;\n        }\n        if (ptInRect(this.m_rcDownButton, pt)) {', 'this.m_dArrowTS = now;\n          return true;\n        }\n        if (ptInRect(this.m_rcDownButton, pt)) {')
h(sb, SB, 'ScrollBar: the up button is taken', 'this.m_dArrowTS = now;\n          this.playSound(this.m_pSndMouseDown);\n          return true;\n        }\n        if (ptInRect(this.m_rcDownButton, pt)) {', 'this.m_dArrowTS = now;\n          this.playSound(this.m_pSndMouseDown);\n          return false;\n        }\n        if (ptInRect(this.m_rcDownButton, pt)) {')
h(sb, SB, 'ScrollBar: the down button captures the mouse', 'if (ptInRect(this.m_rcDownButton, pt)) {\n          this.ctx.setCapture();', 'if (ptInRect(this.m_rcDownButton, pt)) {')
h(sb, SB, 'ScrollBar: the down button steps forward below the end', 'if (((this.m_nPageSize + this.m_nPosition) | 0) < this.m_nEnd)', 'if (((this.m_nPageSize + this.m_nPosition) | 0) <= this.m_nEnd)')
h(sb, SB, 'ScrollBar: the down button steps forward while the page ends before the end', 'if (((this.m_nPageSize + this.m_nPosition) | 0) < this.m_nEnd)', 'if (((this.m_nPageSize + this.m_nPosition) | 0) < this.m_nEnd + 1)')
h(sb, SB, 'ScrollBar: the down button counts the page', 'if (((this.m_nPageSize + this.m_nPosition) | 0) < this.m_nEnd)', 'if (this.m_nPosition < this.m_nEnd)')
h(sb, SB, 'ScrollBar: the down button steps forward', 'this.m_nPosition = (this.m_nPosition + 1) | 0;\n          this.updateThumbRect();\n          this.m_Arrow = ARROWSTATE.CLICKED_DOWN;', 'this.m_nPosition = (this.m_nPosition - 1) | 0;\n          this.updateThumbRect();\n          this.m_Arrow = ARROWSTATE.CLICKED_DOWN;')
h(sb, SB, 'ScrollBar: the down button updates the thumb', '          this.updateThumbRect();\n          this.m_Arrow = ARROWSTATE.CLICKED_DOWN;', '          this.m_Arrow = ARROWSTATE.CLICKED_DOWN;')
h(sb, SB, 'ScrollBar: the down button sets the arrow', 'this.m_Arrow = ARROWSTATE.CLICKED_DOWN;', 'this.m_Arrow = ARROWSTATE.CLICKED_UP;')
h(sb, SB, 'ScrollBar: the down button sets the arrow state', 'this.m_Arrow = ARROWSTATE.CLICKED_DOWN;', '')
h(sb, SB, 'ScrollBar: the down button notes the time', 'this.m_bIsDownButtonClicked = true;\n          this.m_dArrowTS = now;', 'this.m_bIsDownButtonClicked = true;')
h(sb, SB, 'ScrollBar: the down button is clicked', 'this.m_bIsDownButtonClicked = true;', 'this.m_bIsUpButtonClicked = true;')
h(sb, SB, 'ScrollBar: the down button is marked clicked', 'this.m_bIsDownButtonClicked = true;', '')
h(sb, SB, 'ScrollBar: the down button plays the sound', 'this.m_dArrowTS = now;\n          this.playSound(this.m_pSndMouseDown);\n          return true;\n        }\n        const thumb', 'this.m_dArrowTS = now;\n          return true;\n        }\n        const thumb')
h(sb, SB, 'ScrollBar: the down button is taken', 'this.m_dArrowTS = now;\n          this.playSound(this.m_pSndMouseDown);\n          return true;\n        }\n        const thumb', 'this.m_dArrowTS = now;\n          this.playSound(this.m_pSndMouseDown);\n          return false;\n        }\n        const thumb')
h(sb, SB, 'ScrollBar: the thumb needs the thumb to be enabled', 'if (this.m_bEnableThumb && ptInRect(thumb, pt)) {', 'if (ptInRect(thumb, pt)) {')
h(sb, SB, 'ScrollBar: the thumb is the thumb\'s rectangle', 'if (this.m_bEnableThumb && ptInRect(thumb, pt)) {', 'if (this.m_bEnableThumb && ptInRect(track, pt)) {')
h(sb, SB, 'ScrollBar: the thumb captures the mouse', 'if (this.m_bEnableThumb && ptInRect(thumb, pt)) {\n          this.ctx.setCapture();', 'if (this.m_bEnableThumb && ptInRect(thumb, pt)) {')
h(sb, SB, 'ScrollBar: the thumb notes where it was taken', 'statics.thumbOffsetY = (y - thumb.top) | 0;', 'statics.thumbOffsetY = (y - thumb.bottom) | 0;')
h(sb, SB, 'ScrollBar: the thumb notes the offset', 'statics.thumbOffsetY = (y - thumb.top) | 0;', '')
h(sb, SB, 'ScrollBar: the thumb starts a drag', 'this.m_bDrag = true;', '')
h(sb, SB, 'ScrollBar: the thumb is taken', 'this.m_bDrag = true;\n          return true;', 'this.m_bDrag = true;\n          return false;')
h(sb, SB, 'ScrollBar: the track needs the track to be enabled', 'if (this.m_bEnableTrack && thumb.left <= x', 'if (thumb.left <= x')
h(sb, SB, 'ScrollBar: the track is right of the thumb\'s left edge', 'thumb.left <= x && thumb.right > x', 'thumb.left < x && thumb.right > x')
h(sb, SB, 'ScrollBar: the track is left of the thumb\'s right edge', 'thumb.left <= x && thumb.right > x', 'thumb.left <= x && thumb.right >= x')
h(sb, SB, 'ScrollBar: the track needs the thumb to be shown', 'thumb.right > x && this.m_bShowThumb) {', 'thumb.right > x) {')
h(sb, SB, 'ScrollBar: the track captures the mouse', 'this.m_bShowThumb) {\n          this.ctx.setCapture();', 'this.m_bShowThumb) {')
h(sb, SB, 'ScrollBar: above the thumb is a page up', 'if (thumb.top > y && track.top <= y) {', 'if (thumb.top >= y && track.top <= y) {')
h(sb, SB, 'ScrollBar: above the thumb is below the track\'s top', 'if (thumb.top > y && track.top <= y) {', 'if (thumb.top > y && track.top < y) {')
h(sb, SB, 'ScrollBar: above the thumb is not above the track', 'if (thumb.top > y && track.top <= y) {', 'if (thumb.top > y) {')
h(sb, SB, 'ScrollBar: a page up goes back a page less one', 'this.scroll((1 - this.m_nPageSize) | 0);', 'this.scroll((-this.m_nPageSize) | 0);')
h(sb, SB, 'ScrollBar: a page up goes back', 'this.scroll((1 - this.m_nPageSize) | 0);', 'this.scroll((this.m_nPageSize - 1) | 0);')
h(sb, SB, 'ScrollBar: a page up is taken', 'this.scroll((1 - this.m_nPageSize) | 0);\n            return true;', 'this.scroll((1 - this.m_nPageSize) | 0);\n            return false;')
h(sb, SB, 'ScrollBar: below the thumb is a page down', 'if (thumb.bottom <= y && track.bottom > y) {', 'if (thumb.bottom < y && track.bottom > y) {')
h(sb, SB, 'ScrollBar: below the thumb is above the track\'s bottom', 'if (thumb.bottom <= y && track.bottom > y) {', 'if (thumb.bottom <= y && track.bottom >= y) {')
h(sb, SB, 'ScrollBar: below the thumb is not below the track', 'if (thumb.bottom <= y && track.bottom > y) {', 'if (thumb.bottom <= y) {')
h(sb, SB, 'ScrollBar: a page down goes on a page less one', 'this.scroll((this.m_nPageSize - 1) | 0);', 'this.scroll((this.m_nPageSize) | 0);')
h(sb, SB, 'ScrollBar: a page down goes on', 'this.scroll((this.m_nPageSize - 1) | 0);', 'this.scroll((1 - this.m_nPageSize) | 0);')
h(sb, SB, 'ScrollBar: a page down is taken', 'this.scroll((this.m_nPageSize - 1) | 0);\n            return true;', 'this.scroll((this.m_nPageSize - 1) | 0);\n            return false;')
h(sb, SB, 'ScrollBar: a press beside the thumb that is no page is not taken', '        }\n        return false;\n      }\n      case 0x202:', '        }\n        return true;\n      }\n      case 0x202:')
h(sb, SB, 'ScrollBar: the button up lets the up button go', '        this.m_bIsUpButtonClicked = false;\n', '')
h(sb, SB, 'ScrollBar: the button up lets the down button go', '        this.m_bIsDownButtonClicked = false;\n', '')
h(sb, SB, 'ScrollBar: the button up ends a drag', '        this.m_bDrag = false;\n', '')
h(sb, SB, 'ScrollBar: the button up gives the mouse back', '        this.ctx.releaseCapture();\n', '')
h(sb, SB, 'ScrollBar: the button up updates the thumb', '        this.ctx.releaseCapture();\n        this.updateThumbRect();', '        this.ctx.releaseCapture();')
h(sb, SB, 'ScrollBar: the button up clears the arrow', '        this.m_Arrow = ARROWSTATE.CLEAR;\n', '')
h(sb, SB, 'ScrollBar: the button up is not taken', '        this.m_Arrow = ARROWSTATE.CLEAR;\n        return false;', '        this.m_Arrow = ARROWSTATE.CLEAR;\n        return true;')
h(sb, SB, 'ScrollBar: other messages are not taken', '      default:\n        return false;', '      default:\n        return true;')
h(sb, MP, 'ScrollBar MsgProc: the capture changing ends a drag', 'if (uMsg === 0x215) this.m_bDrag = false;', '')
h(sb, MP, 'ScrollBar MsgProc: only the capture changing ends a drag', 'if (uMsg === 0x215) this.m_bDrag = false;', 'this.m_bDrag = false;')
h(sb, MP, 'ScrollBar MsgProc: the drag ends', 'if (uMsg === 0x215) this.m_bDrag = false;', 'if (uMsg === 0x215) this.m_bDrag = true;')
h(sb, MP, 'ScrollBar MsgProc: it is never taken', 'return false;', 'return true;')
h(sb, MP, 'ScrollBar MsgProc: the message is 0x215', 'if (uMsg === 0x215)', 'if (uMsg === 0x214)')


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (8 * 2**30, 8 * 2**30))


def main():
    args = sys.argv[1:]
    mutants = M
    if '--list' in args:
        for f, name, a, b, why in mutants:
            print(f'{f:16s} {name}' + (f'   [survives: {why}]' if why else ''))
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
