#!/usr/bin/env python3
"""Mutation check of the frame update (`OnFrameMove`) of the UI: apply one small change at a time to the code the frame runs (the control's
`OnFrameMove`, `Animate`, `ChangePoint`, `UpdateTexChangeData`, the picture's animations, the `OnFrameMove` of Static, Button, CheckBox, RadioButton,
Slot, Slider, ScrollBar, Navigation, ControlList, ComboBox, ListBox, EditBox, IMEEditBox and of the dialog, the manager's `CheckDlg` /
`CheckFrontModalDlg` / `CountModalDialog`, the keyboard), run packages/ui/test/framemove.test.ts and report whether a test notices (killed) or not
(SURVIVED).

    python3 tools/mutate-framemove.py [--list] [--check] [substring of a mutant name ...]

A mutant that must be killed and survives makes the exit code 1; a mutant with a reason is expected to survive (it is equivalent to the
original).  `--check` only looks that every anchor is in its file exactly once.  The source is restored after every mutant (also on Ctrl-C), but do not
run this with uncommitted edits in the mutated files you cannot afford to lose.  Needs `bun` in ./node_modules/.bin; a run takes ~2 s per mutant.
Each run has a 90 s timeout and an 8 GB address-space limit: a mutant that loops or blows up is killed, too.
"""
import os, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
TEST = os.path.join(ROOT, 'packages/ui/test/framemove.test.ts')
SRC = 'packages/ui/src/'

# (file, name, original text, mutated text, why it may survive ('' = must be killed))
M = []


def m(file, name, a, b, why=''):
    M.append((file, name, a, b, why))


# ---- control.ts: CKTDGUIControl::OnFrameMove / Animate ---------------------------------------------------------------------------------
c = 'control.ts'
m(c, 'control: the frame time is kept as a float', 'this.m_fElapsedTime = f(fElapsedTime);\n      this.animate();', 'this.m_fElapsedTime = fElapsedTime;\n      this.animate();')
m(c, 'control: a shown control animates', 'this.m_fElapsedTime = f(fElapsedTime);\n      this.animate();', 'this.m_fElapsedTime = f(fElapsedTime);')
m(c, 'control: a hidden control does nothing', 'if (this.m_bShow) {\n      this.m_fElapsedTime = f(fElapsedTime);', 'if (true) {\n      this.m_fElapsedTime = f(fElapsedTime);')
m(c, 'animate: a move needs a change time', 'if (this.m_fChangeTime > 0) {\n      const at = this.m_fAnimateTime;\n      if (at < this.m_fChangeTime) {\n        const o =', 'if (this.m_fChangeTime >= 0) {\n      const at = this.m_fAnimateTime;\n      if (at < this.m_fChangeTime) {\n        const o =')
m(c, 'animate: the move goes on while the animate time is below the change time', 'if (at < this.m_fChangeTime) {\n        const o =', 'if (at <= this.m_fChangeTime) {\n        const o =')
m(c, 'animate: the share is 1 / (change time - animate time)', 'const k = f(1 / f(this.m_fChangeTime - at));\n        const dt = this.m_fElapsedTime;', 'const k = f(1 / this.m_fChangeTime);\n        const dt = this.m_fElapsedTime;')
m(c, 'animate: x goes to the goal x', 'o.x = approach(o.x, g.x, k, dt);', 'o.x = approach(o.x, g.y, k, dt);')
m(c, 'animate: y goes to the goal y', 'o.y = approach(o.y, g.y, k, dt);', 'o.y = approach(o.y, g.x, k, dt);')
m(c, 'animate: red goes to the goal red', 'c.r = approach(c.r, gc.r, k, dt);', 'c.r = approach(c.r, gc.g, k, dt);')
m(c, 'animate: green goes to the goal green', 'c.g = approach(c.g, gc.g, k, dt);', 'c.g = approach(c.g, gc.b, k, dt);')
m(c, 'animate: blue goes to the goal blue', 'c.b = approach(c.b, gc.b, k, dt);', 'c.b = approach(c.b, gc.a, k, dt);')
m(c, 'animate: alpha goes to the goal alpha', 'c.a = approach(c.a, gc.a, k, dt);', 'c.a = approach(c.a, gc.r, k, dt);')
m(c, 'animate: the animate time counts the frame', 'this.m_fAnimateTime = f(dt + at);\n      } else {', 'this.m_fAnimateTime = dt;\n      } else {')
m(c, 'animate: the end clears the animate time', 'this.m_fAnimateTime = 0;\n        this.m_fChangeTime = 0;\n        this.m_OffsetPos.set(', 'this.m_fChangeTime = 0;\n        this.m_OffsetPos.set(')
m(c, 'animate: the end clears the change time', 'this.m_fChangeTime = 0;\n        this.m_OffsetPos.set(this.m_GoalPos.x', 'this.m_OffsetPos.set(this.m_GoalPos.x')
m(c, 'animate: the end puts the offset on the goal', 'this.m_OffsetPos.set(this.m_GoalPos.x, this.m_GoalPos.y);\n        if (this.m_bAutoDelete)', 'this.m_OffsetPos.set(this.m_GoalPos.y, this.m_GoalPos.x);\n        if (this.m_bAutoDelete)')
m(c, 'animate: the end of an auto-delete move marks the control', 'if (this.m_bAutoDelete) this.m_bCheckAutoDeleteEnd = true;', 'if (!this.m_bAutoDelete) this.m_bCheckAutoDeleteEnd = true;')
m(c, 'animate: the queue waits for the end of the move', 'if (this.m_fChangeTime === 0 && this.m_queMoveItems.length !== 0) {', 'if (this.m_queMoveItems.length !== 0) {')
m(c, 'animate: the queue gives the goal position', 'this.m_GoalPos.set(item.pos.x, item.pos.y);\n      this.m_GoalColor', 'this.m_GoalPos.set(item.pos.y, item.pos.x);\n      this.m_GoalColor')
m(c, 'animate: the queue gives the goal colour', 'this.m_GoalColor.set(item.color.r, item.color.g, item.color.b, item.color.a);', 'this.m_GoalColor.set(item.color.r, item.color.b, item.color.g, item.color.a);')
m(c, 'animate: the queue gives the change time', 'this.m_fChangeTime = item.fChangeTime;', 'this.m_fChangeTime = 0;')
m(c, 'animate: the queue gives auto-delete', 'this.m_bAutoDelete = item.bIsAutoDelete;', '')

# ---- control.ts: ChangePoint ------------------------------------------------------------------------------------------------------------
m(c, 'changepoint: equal change times do nothing', 'if (end.fChangeTime === ct) return;', 'if (false) return;')
m(c, 'changepoint: the time left is end - now', 'const span = f(end.fChangeTime - ct);', 'const span = f(ct - end.fChangeTime);')
m(c, 'changepoint: a frame shorter than what is left moves', 'if (dt < span) {', 'if (dt <= span) {')
m(c, 'changepoint: the share is 1 / left', 'const k = f(1 / span);', 'const k = f(1 / dt);')
m(c, 'changepoint: red moves', 'for (const ch of ["r", "g", "b", "a"] as const)', 'for (const ch of ["g", "b", "a"] as const)')
m(c, 'changepoint: alpha moves', 'for (const ch of ["r", "g", "b", "a"] as const)', 'for (const ch of ["r", "g", "b"] as const)')
m(c, 'changepoint: the left-top corner moves', 'for (const corner of ["leftTopPoint", "rightTopPoint", "leftBottomPoint", "rightBottomPoint"] as const) {', 'for (const corner of ["rightTopPoint", "leftBottomPoint", "rightBottomPoint"] as const) {')
m(c, 'changepoint: the right-bottom corner moves', 'for (const corner of ["leftTopPoint", "rightTopPoint", "leftBottomPoint", "rightBottomPoint"] as const) {', 'for (const corner of ["leftTopPoint", "rightTopPoint", "leftBottomPoint"] as const) {')
m(c, 'changepoint: y goes to the end y', 'n.y = approach(n.y, e.y, k, dt);', 'n.y = approach(n.y, e.x, k, dt);')
m(c, 'changepoint: the change time counts the frame', 'now.fChangeTime = f(dt + ct);', 'now.fChangeTime = dt;')
m(c, 'changepoint: the end becomes the current point', '} else {\n      now.assign(end);', '} else {')

# ---- control.ts: UpdateTexChangeData ----------------------------------------------------------------------------------------------------
m(c, 'texchange: no step: the sequence goes back to 0', 'now.m_SequenceID = 0;\n      return;', 'return;')
m(c, 'texchange: the rotate axis of a step that has one', 'if (step.m_RotateAxis !== TA.NONE) now.m_RotateAxis = step.m_RotateAxis;', 'if (step.m_RotateAxis === TA.NONE) now.m_RotateAxis = step.m_RotateAxis;')
m(c, 'texchange: the scale axis of a step that has one', 'if (step.m_ScaleAxis !== TA.NONE) now.m_ScaleAxis = step.m_ScaleAxis;', 'if (step.m_ScaleAxis === TA.NONE) now.m_ScaleAxis = step.m_ScaleAxis;')
m(c, 'texchange: the show time counts the frame', 'now.m_fShowTime = f(dt + now.m_fShowTime);\n    const left', 'now.m_fShowTime = dt;\n    const left')
m(c, 'texchange: the time left is the step\'s show time - shown', 'const left = f(step.m_fShowTime - now.m_fShowTime);', 'const left = f(now.m_fShowTime - step.m_fShowTime);')
m(c, 'texchange: rotation divides by the time left', 'now.m_fRotateDegree = f(f(f(f(step.m_fRotateDegree - rotate0) / left) * dt) + rotate0);', 'now.m_fRotateDegree = f(f(f(f(step.m_fRotateDegree - rotate0) * left) * dt) + rotate0);')
m(c, 'texchange: the share is 1 / left', 'const inv = f(1 / left);', 'const inv = f(1 / dt);')
m(c, 'texchange: y moves to the step\'s y', 'const dy = f(step.m_Pos.y - now.m_Pos.y);', 'const dy = f(now.m_Pos.y - step.m_Pos.y);')
m(c, 'texchange: x moves to the step\'s x', 'now.m_Pos.x = f(f(f(f(step.m_Pos.x - now.m_Pos.x) * inv) * dt) + now.m_Pos.x);', 'now.m_Pos.x = f(f(f(f(step.m_Pos.y - now.m_Pos.x) * inv) * dt) + now.m_Pos.x);')
m(c, 'texchange: y adds to y', 'now.m_Pos.y = f(f(f(inv * dy) * dt) + now.m_Pos.y);', 'now.m_Pos.y = f(f(f(inv * dy) * dt) + now.m_Pos.x);')
m(c, 'texchange: scale y moves to the step\'s scale y', 'const scaleY = f(f(f(inv * f(step.m_Scale.y - now.m_Scale.y)) * dt) + now.m_Scale.y);', 'const scaleY = f(f(f(inv * f(step.m_Scale.x - now.m_Scale.y)) * dt) + now.m_Scale.y);')
m(c, 'texchange: scale x adds to x', 'now.m_Scale.x = f(f(f(f(step.m_Scale.x - now.m_Scale.x) * inv) * dt) + now.m_Scale.x);', 'now.m_Scale.x = f(f(f(f(step.m_Scale.x - now.m_Scale.x) * inv) * dt) + now.m_Scale.y);')
m(c, 'texchange: scale y is stored', 'now.m_Scale.y = scaleY;', 'now.m_Scale.y = now.m_Scale.y;')
m(c, 'texchange: scale rotation divides by the time left', 'now.m_fScaleRotationDegree = f(f(f(f(step.m_fScaleRotationDegree - now.m_fScaleRotationDegree) / left) * dt) + now.m_fScaleRotationDegree);', 'now.m_fScaleRotationDegree = f(f(f(f(step.m_fScaleRotationDegree - now.m_fScaleRotationDegree) * left) * dt) + now.m_fScaleRotationDegree);')
m(c, 'texchange: a step shown for its time ends', 'if (now.m_fShowTime >= step.m_fShowTime) {', 'if (now.m_fShowTime > step.m_fShowTime) {')
m(c, 'texchange: the end clears the show time', 'now.m_fShowTime = 0;\n      now.m_fRotateDegree = step.m_fRotateDegree;', 'now.m_fRotateDegree = step.m_fRotateDegree;')
m(c, 'texchange: the end sets the rotation', 'now.m_fRotateDegree = step.m_fRotateDegree;\n', '')
m(c, 'texchange: the end sets the scale rotation', 'now.m_fScaleRotationDegree = step.m_fScaleRotationDegree;\n      now.m_Pos', 'now.m_Pos')
m(c, 'texchange: the end sets the position', 'now.m_Pos.set(step.m_Pos.x, step.m_Pos.y);', 'now.m_Pos.set(step.m_Pos.y, step.m_Pos.x);')
m(c, 'texchange: the end sets the scale', 'now.m_Scale.set(step.m_Scale.x, step.m_Scale.y);', 'now.m_Scale.set(step.m_Scale.y, step.m_Scale.x);')
m(c, 'texchange: the last step ends the animation', 'if (step.m_bEndTexChange) now.m_bEndTexChange = true;', 'if (!step.m_bEndTexChange) now.m_bEndTexChange = true;')
m(c, 'texchange: the sequence goes to the next id', 'now.m_SequenceID = (now.m_SequenceID + 1) | 0;', 'now.m_SequenceID = (now.m_SequenceID + 2) | 0;')
m(c, 'texchange: the sequence goes to the id the running data names', 'else if (now.m_SequenceIDToGo === -1)', 'else if (now.m_SequenceIDToGo !== -1)')
m(c, 'texchange: ... not the one the step names', 'else now.m_SequenceID = now.m_SequenceIDToGo;', 'else now.m_SequenceID = step.m_SequenceIDToGo;')

# ---- control.ts: CPictureData::OnFrameMove ----------------------------------------------------------------------------------------------
m(c, 'picture: twinkle counts while time is left', 'if (this.m_fRemainTwinkleTime > 0) {', 'if (this.m_fRemainTwinkleTime >= 0) {')
m(c, 'picture: twinkle time counts down', 'const t = f(this.m_fRemainTwinkleTime - dt);', 'const t = f(this.m_fRemainTwinkleTime + dt);')
m(c, 'picture: twinkle subtracts the whole number of periods', 'const phase = f(t - f(cvttss2si(f(t / TWINKLE_PERIOD))));', 'const phase = f(t % TWINKLE_PERIOD);')
m(c, 'picture: twinkle cuts the number of periods', 'const phase = f(t - f(cvttss2si(f(t / TWINKLE_PERIOD))));', 'const phase = f(t - f(Math.round(f(t / TWINKLE_PERIOD))));')
m(c, 'picture: twinkle is off below 0.2', 'if (phase < TWINKLE_OFF) point.color.a = 0;', 'if (phase <= TWINKLE_OFF) point.color.a = 0;')
m(c, 'picture: twinkle is off below 0.2 (not above)', 'if (phase < TWINKLE_OFF) point.color.a = 0;', 'if (phase > TWINKLE_OFF) point.color.a = 0;')
m(c, 'picture: a twinkle that is over loops or ends', '} else if (this.m_bLoop) this.m_fRemainTwinkleTime = this.m_fTwinkleTime;', '} else if (!this.m_bLoop) this.m_fRemainTwinkleTime = this.m_fTwinkleTime;')
m(c, 'picture: a twinkle loops with its time', 'this.m_fRemainTwinkleTime = this.m_fTwinkleTime;', 'this.m_fRemainTwinkleTime = 0;')
m(c, 'picture: a twinkle that is over without a loop ends', 'else this.m_bTwinkle = false;', '')
m(c, 'picture: the original alpha is only put back when twinkle is not off', 'if (original && point) point.color.a = this.m_fOriginalAlpha;', 'if (point) point.color.a = this.m_fOriginalAlpha;')
m(c, 'picture: flicker gains', 't = f(this.m_fRemainFlickerTime + dt);', 't = f(this.m_fRemainFlickerTime - dt);')
m(c, 'picture: flicker turns round past its time', 'if (!(t <= this.m_fFlickerTime)) this.m_bFlickerGainAlpha = false;', 'if (!(t < this.m_fFlickerTime)) this.m_bFlickerGainAlpha = false;')
m(c, 'picture: flicker loses', 't = f(this.m_fRemainFlickerTime - dt);', 't = f(this.m_fRemainFlickerTime + dt);')
m(c, 'picture: flicker ends below 0', 'if (t < 0) {\n          if (this.m_bFlickerLoop)', 'if (t <= 0) {\n          if (this.m_bFlickerLoop)')
m(c, 'picture: flicker loops or ends', 'if (this.m_bFlickerLoop) this.m_bFlickerGainAlpha = true;', 'if (!this.m_bFlickerLoop) this.m_bFlickerGainAlpha = true;')
m(c, 'picture: flicker ends', 'else this.m_bFlicker = false;', '')
m(c, 'picture: flicker alpha: max - min', 'f(f(f(f(this.m_fFlickerMaxAlpha - this.m_fFlickerMinAlpha) * t)', 'f(f(f(f(this.m_fFlickerMaxAlpha + this.m_fFlickerMinAlpha) * t)')
m(c, 'picture: flicker alpha: times t', 'this.m_fFlickerMinAlpha) * t) / this.m_fFlickerTime)', 'this.m_fFlickerMinAlpha) * dt) / this.m_fFlickerTime)')
m(c, 'picture: flicker alpha: over the flicker time', '* t) / this.m_fFlickerTime) + this.m_fFlickerMinAlpha)', '* t) * this.m_fFlickerTime) + this.m_fFlickerMinAlpha)')
m(c, 'picture: flicker alpha: plus min', '/ this.m_fFlickerTime) + this.m_fFlickerMinAlpha)', '/ this.m_fFlickerTime) - this.m_fFlickerMinAlpha)')
m(c, 'picture: vibrate puts the position back when the time is up', 'if (v.m_fMaxTime <= v.m_fElapsedTime) {', 'if (v.m_fMaxTime < v.m_fElapsedTime) {')
m(c, 'picture: vibrate with a maximum time of 0 puts nothing back', 'if (v.m_fMaxTime !== 0) {\n        v.m_fMaxTime = 0;', 'if (v.m_fMaxTime === 0) {\n        v.m_fMaxTime = 0;')
m(c, 'picture: vibrate clears the maximum time', 'v.m_fMaxTime = 0;\n        this.pos.set(v.m_vOriginalPos.x, v.m_vOriginalPos.y);', 'this.pos.set(v.m_vOriginalPos.x, v.m_vOriginalPos.y);')
m(c, 'picture: vibrate puts back the original position', 'this.pos.set(v.m_vOriginalPos.x, v.m_vOriginalPos.y);', 'this.pos.set(v.m_vOriginalPos.y, v.m_vOriginalPos.x);')
m(c, 'picture: vibrate counts the frame', 'v.m_fElapsedTime = f(v.m_fElapsedTime + dt);', 'v.m_fElapsedTime = f(v.m_fElapsedTime - dt);')
m(c, 'picture: vibrate step y is dirSpeed y * dt', 'sy = f(v.m_vDirSpeed.y * dt);', 'sy = f(v.m_vDirSpeed.x * dt);')
m(c, 'picture: vibrate step x is dirSpeed x * dt', 'const sx = f(v.m_vDirSpeed.x * dt)', 'const sx = f(v.m_vDirSpeed.y * dt)')
m(c, 'picture: vibrate goes away or comes back', 'if (goingAway) {', 'if (!goingAway) {')
m(c, 'picture: vibrate away: x', 'this.pos.set(f(px + sx), f(py + sy));', 'this.pos.set(f(px - sx), f(py + sy));')
m(c, 'picture: vibrate away: y', 'this.pos.set(f(px + sx), f(py + sy));', 'this.pos.set(f(px + sx), f(py - sy));')
m(c, 'picture: vibrate away moves the point', 'this.SetPos(this.pos);\n        const dx', 'const dx')
m(c, 'picture: vibrate away: dy', 'dy = f(this.pos.y - v.m_vOriginalPos.y);\n        const length', 'dy = f(this.pos.y - v.m_vOriginalPos.x);\n        const length')
m(c, 'picture: vibrate away: the length', 'const length = f(Math.sqrt(f(f(dy * dy) + f(dx * dx))));', 'const length = f(Math.sqrt(f(f(dx * dx) + f(dx * dx))));')
m(c, 'picture: vibrate turns round past the distance', 'if (length > v.m_fDistance) v.m_bGoingAway = false;', 'if (length >= v.m_fDistance) v.m_bGoingAway = false;')
m(c, 'picture: vibrate back: x', 'this.pos.set(f(px - sx), f(py - sy));', 'this.pos.set(f(px + sx), f(py - sy));')
m(c, 'picture: vibrate back: y', 'this.pos.set(f(px - sx), f(py - sy));', 'this.pos.set(f(px - sx), f(py + sy));')
m(c, 'picture: vibrate back moves the point', 'this.SetPos(this.pos);\n        const along', 'const along')
m(c, 'picture: vibrate back: the product uses the speed of its axis', 'f(f(f(this.pos.y - v.m_vOriginalPos.y) * v.m_vDirSpeed.y) + f(f(this.pos.x - v.m_vOriginalPos.x) * v.m_vDirSpeed.x))', 'f(f(f(this.pos.y - v.m_vOriginalPos.y) * v.m_vDirSpeed.x) + f(f(this.pos.x - v.m_vOriginalPos.x) * v.m_vDirSpeed.y))')
m(c, 'picture: vibrate turns away at a product of 0 or less', 'if (along <= 0) v.m_bGoingAway = true;', 'if (along < 0) v.m_bGoingAway = true;')
m(c, 'picture: fade in past the fade time', 'if (this.m_bFadeIn) {\n      if (this.m_fFadeTime < this.m_fRemainFadeTime) {', 'if (this.m_bFadeIn) {\n      if (this.m_fFadeTime <= this.m_fRemainFadeTime) {')
m(c, 'picture: fade in ends', 'if (point) point.color.a = 1;\n        this.m_bFadeIn = false;', 'if (point) point.color.a = 1;')
m(c, 'picture: fade in ends with alpha 1', 'if (point) point.color.a = 1;\n        this.m_bFadeIn = false;', 'if (point) point.color.a = 0;\n        this.m_bFadeIn = false;')
m(c, 'picture: fade in stores the time', 'this.m_fRemainFadeTime = t;\n        if (point) point.color.a = f(t / this.m_fFadeTime);', 'if (point) point.color.a = f(t / this.m_fFadeTime);')
m(c, 'picture: fade in alpha is t / fadeTime', 'if (point) point.color.a = f(t / this.m_fFadeTime);', 'if (point) point.color.a = f(t * this.m_fFadeTime);')
m(c, 'picture: fade out past the fade time', 'if (this.m_bFadeOut) {\n      if (this.m_fFadeTime < this.m_fRemainFadeTime) {', 'if (this.m_bFadeOut) {\n      if (this.m_fFadeTime <= this.m_fRemainFadeTime) {')
m(c, 'picture: fade out ends', 'if (point) point.color.a = 0;\n        this.m_bFadeOut = false;', 'if (point) point.color.a = 0;')
m(c, 'picture: fade out ends with alpha 0', 'if (point) point.color.a = 0;\n        this.m_bFadeOut = false;', 'if (point) point.color.a = 1;\n        this.m_bFadeOut = false;')
m(c, 'picture: fade out stores the time', 'this.m_fRemainFadeTime = t;\n        if (point) point.color.a = f(1 - f(t / this.m_fFadeTime));', 'if (point) point.color.a = f(1 - f(t / this.m_fFadeTime));')
m(c, 'picture: fade out alpha is 1 - t / fadeTime', 'if (point) point.color.a = f(1 - f(t / this.m_fFadeTime));', 'if (point) point.color.a = f(t / this.m_fFadeTime);')

# ---- static.ts --------------------------------------------------------------------------------------------------------------------------
s = 'static.ts'
m(s, 'static: wstring find: past the end', 'if (n > size || o > size - n) return -1;', 'if (n > size || o >= size - n) return -1;')
m(s, 'static: wstring find: a pattern longer than the string', 'if (n > size || o > size - n) return -1;', 'if (o > size - n) return -1;', 'o is never below 0, so o > size - n already holds for a pattern longer than the string (the exe needs the check: its size - n is unsigned)')
m(s, 'static: wstring find: an empty pattern is found at the offset', 'if (n === 0) return o;', '', 'String.indexOf("", o) is o for every o that reached it (o <= size), as the exe\'s branch for an empty pattern is')
m(s, 'static: wstring find: the offset is unsigned', 'const o = off >>> 0;', 'const o = off | 0;')
m(s, 'static: a hidden static does nothing', 'if (!this.m_bShow) return 0;\n    super.onFrameMove(fTime, fElapsedTime);\n    const dt = f(fElapsedTime);', 'super.onFrameMove(fTime, fElapsedTime);\n    const dt = f(fElapsedTime);')
m(s, 'static: a string that is all shown stops spreading', 'if (count >= text.msg.length) {', 'if (count > text.msg.length) {')
m(s, 'static: ... and says so', 'text.bSpread = false;\n        continue;', 'continue;')
m(s, 'static: the spread time counts the frame', 'const t = f(dt + text.fNowSpreadTime);', 'const t = dt;')
m(s, 'static: a character each time the gap is passed', 'if (!(t > text.fSpreadTimeGap)) continue;', 'if (!(t >= text.fSpreadTimeGap)) continue;')
m(s, 'static: the spread time starts again', 'text.fNowSpreadTime = 0;\n      text.iSpreadCount', 'text.iSpreadCount')
m(s, 'static: one more character', 'text.iSpreadCount = (count + 1) | 0;\n      if (count + 1 > 0) {', 'text.iSpreadCount = (count + 2) | 0;\n      if (count + 1 > 0) {')
m(s, 'static: the colour codes are looked at from the first character', 'if (count + 1 > 0) {', 'if (count + 1 > 1) {')
m(s, 'static: #CX is looked for at the count', 'if (wstringFind(text.msg, "#CX", count) !== 0) {', 'if (wstringFind(text.msg, "#CX", count) === 0) {')
m(s, 'static: #CX is looked for in the message', 'wstringFind(text.msg, "#CX", count)', 'wstringFind(text.msg, "#C", count)')
m(s, 'static: #C is looked for', 'if (wstringFind(text.msg, "#C", (text.iSpreadCount - 1) | 0) === 0) text.iSpreadCount', 'if (wstringFind(text.msg, "#C", (text.iSpreadCount - 1) | 0) !== 0) text.iSpreadCount')
m(s, 'static: #C is looked for at the new count - 1', '"#C", (text.iSpreadCount - 1) | 0)', '"#C", text.iSpreadCount)')
m(s, 'static: #C skips 7 more', 'text.iSpreadCount = (text.iSpreadCount + 7) | 0;', 'text.iSpreadCount = (text.iSpreadCount + 6) | 0;')
m(s, 'static: #CX skips 2 more', 'text.iSpreadCount = (text.iSpreadCount + 2) | 0;', 'text.iSpreadCount = (text.iSpreadCount + 1) | 0;')
m(s, 'static: a picture with twinkle is moved', 'if (picture && (picture.m_bTwinkle || picture.m_bFlicker', 'if (picture && (false || picture.m_bFlicker')
m(s, 'static: a picture with flicker is moved', 'picture.m_bTwinkle || picture.m_bFlicker || picture.m_bFadeIn', 'picture.m_bTwinkle || false || picture.m_bFadeIn')
m(s, 'static: a picture with fade in is moved', 'picture.m_bFlicker || picture.m_bFadeIn || picture.m_bFadeOut', 'picture.m_bFlicker || false || picture.m_bFadeOut')
m(s, 'static: a picture with fade out is moved', 'picture.m_bFadeIn || picture.m_bFadeOut || picture.m_VibrateData', 'picture.m_bFadeIn || false || picture.m_VibrateData')
m(s, 'static: a picture with a vibration is moved', 'picture.m_VibrateData.m_fMaxTime !== 0)) {', 'false)) {')
m(s, 'static: a picture is moved', 'picture.onFrameMove(fTime, fElapsedTime);', '')
m(s, 'static: a picture without animation is not moved', 'if (picture && (picture.m_bTwinkle', 'if (picture && (true || picture.m_bTwinkle', 'every part of CPictureData::OnFrameMove is guarded by its own flag, so the call for a picture without an animation does nothing (the exe\'s test only saves the call)')
m(s, 'static: a movie counts', 'for (let i = 0; i < this.m_MovieDataList.length; i++) this.ctx.render?.noteUndrawn("CMovieData::OnFrameMove");', '')
m(s, 'static: the frame time is the static\'s', 'this.m_fElapsedTime = dt;\n    return 0;', 'return 0;', 'the control\'s OnFrameMove has just stored the same float (the static is shown: it got that far)')

# ---- button.ts --------------------------------------------------------------------------------------------------------------------------
b = 'button.ts'
m(b, 'button: the Enter key is 0x1c', 'const KEY_ENTER = 0x1c;', 'const KEY_ENTER = 0x1d;')
m(b, 'button: a hidden button does nothing', 'if (!this.m_bShow) return 0;\n    super.onFrameMove(fTime, fElapsedTime);\n    const manager', 'super.onFrameMove(fTime, fElapsedTime);\n    const manager')
m(b, 'button: Enter needs the focus', 'if (this.m_bHasFocus && this.m_EdgeWidth > 0 && !manager', 'if (this.m_EdgeWidth > 0 && !manager')
m(b, 'button: Enter needs an edge', 'this.m_EdgeWidth > 0 && !manager', 'this.m_EdgeWidth >= 0 && !manager')
m(b, 'button: Enter needs no dialog in front', '&& !manager.checkFrontModalDlg(this.m_pDialog) && this.ctx.keyboard', '&& this.ctx.keyboard')
m(b, 'button: Enter needs the key down', 'getKeyState(KEY_ENTER) === 1', 'getKeyState(KEY_ENTER) === 0')
m(b, 'button: the point moves when the change times differ', 'if (this.m_EndPoint.fChangeTime !== this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);', 'if (this.m_EndPoint.fChangeTime === this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);')
m(b, 'button: the point moves', 'this.changePoint(this.m_NowPoint, this.m_EndPoint);', 'this.changePoint(this.m_EndPoint, this.m_NowPoint);')
m(b, 'button: a dialog in front takes the mouse over', 'this.m_bMouseOver && manager.checkFrontModalDlg(this.m_pDialog)) this.m_bMouseOver = false;', 'this.m_bMouseOver && manager.checkFrontModalDlg(this.m_pDialog)) this.m_bMouseOver = true;')
m(b, 'button: a dialog in front takes the mouse over (only of a control in a dialog)', 'if (this.m_pDialog !== null && this.m_bMouseOver && manager.checkFrontModalDlg', 'if (this.m_bMouseOver && manager.checkFrontModalDlg', 'CheckFrontModalDlg(null) is false (CheckDlg), as the exe\'s test of the dialog handle against null is')
m(b, 'button: normal: the normal point is the point', 'case BCS.NORMAL: point = this.m_pNormalPoint; steps = this.m_mapMouseNormalTex; break;', 'case BCS.NORMAL: point = this.m_pMouseOverPoint; steps = this.m_mapMouseNormalTex; break;')
m(b, 'button: normal: the normal steps are the steps', 'case BCS.NORMAL: point = this.m_pNormalPoint; steps = this.m_mapMouseNormalTex; break;', 'case BCS.NORMAL: point = this.m_pNormalPoint; steps = this.m_mapMouseOverTex; break;')
m(b, 'button: over: the over point is the point', 'case BCS.MOUSEOVER: point = this.m_pMouseOverPoint; steps = this.m_mapMouseOverTex; break;', 'case BCS.MOUSEOVER: point = this.m_pNormalPoint; steps = this.m_mapMouseOverTex; break;')
m(b, 'button: over: the over steps are the steps', 'case BCS.MOUSEOVER: point = this.m_pMouseOverPoint; steps = this.m_mapMouseOverTex; break;', 'case BCS.MOUSEOVER: point = this.m_pMouseOverPoint; steps = this.m_mapMouseDownTex; break;')
m(b, 'button: down: the down point is the point', 'case BCS.MOUSEDOWN: point = this.m_pMouseDownPoint; steps = this.m_mapMouseDownTex; break;', 'case BCS.MOUSEDOWN: point = this.m_pNormalPoint; steps = this.m_mapMouseDownTex; break;')
m(b, 'button: down: the down steps are the steps', 'case BCS.MOUSEDOWN: point = this.m_pMouseDownPoint; steps = this.m_mapMouseDownTex; break;', 'case BCS.MOUSEDOWN: point = this.m_pMouseDownPoint; steps = this.m_mapMouseNormalTex; break;')
m(b, 'button: disabled has no steps', 'default: break;\n    }\n    if (steps &&', 'case BCS.DISABLE: steps = this.m_mapMouseNormalTex; break;\n      default: break;\n    }\n    if (steps &&')
m(b, 'button: a state with steps animates', 'if (steps && steps.size !== 0 && !this.m_NowTexChangeData.m_bEndTexChange) {', 'if (steps && steps.size === 0 && !this.m_NowTexChangeData.m_bEndTexChange) {')
m(b, 'button: an animation that ended stops', 'steps.size !== 0 && !this.m_NowTexChangeData.m_bEndTexChange) {', 'steps.size !== 0) {')
m(b, 'button: the step is the one of the sequence id', 'const step = steps.get(this.m_NowTexChangeData.m_SequenceID) ?? null;', 'const step = steps.get(0) ?? null;')
m(b, 'button: the step is updated', 'this.updateTexChangeData(step);', '')
m(b, 'button: a step with another texture changes the point\'s', 'if (texture && point && point.pUITextureData !== texture) {', 'if (texture && point && point.pUITextureData === texture) {')
m(b, 'button: the point shows the step\'s texture', 'point.pUITextureData = texture;\n        point.applyTextureSize();', 'point.applyTextureSize();')
m(b, 'button: the point is sized from the step\'s texture', 'point.applyTextureSize();\n        this.ChangeState(this.m_ButtonState, true);', 'this.ChangeState(this.m_ButtonState, true);')
m(b, 'button: the state is entered again', 'point.applyTextureSize();\n        this.ChangeState(this.m_ButtonState, true);', 'point.applyTextureSize();')
m(b, 'button: normal: over at normal goes to mouse over', 'if (this.m_bOverStateAtNormal) {\n          this.ChangeState(BCS.MOUSEOVER, false);', 'if (this.m_bOverStateAtNormal) {\n          this.ChangeState(BCS.MOUSEDOWN, false);')
m(b, 'button: normal: over at normal plays the sound', 'if (this.m_bOverStateAtNormal) {\n          this.ChangeState(BCS.MOUSEOVER, false);\n          this.playSound(this.m_pSndMouseOver);', 'if (this.m_bOverStateAtNormal) {\n          this.ChangeState(BCS.MOUSEOVER, false);')
m(b, 'button: normal: down at normal goes to mouse down', '} else if (this.m_bDownStateAtNormal) {\n          this.ChangeState(BCS.MOUSEDOWN, false);', '} else if (this.m_bDownStateAtNormal) {\n          this.ChangeState(BCS.MOUSEOVER, false);')
m(b, 'button: normal: down at normal plays the sound', 'this.ChangeState(BCS.MOUSEDOWN, false);\n          this.playSound(this.m_pSndMouseOver);', 'this.ChangeState(BCS.MOUSEDOWN, false);')
m(b, 'button: normal: the mouse over goes to mouse over', '} else if (this.m_bMouseOver) {\n          this.ChangeState(BCS.MOUSEOVER, false);\n          this.playSound(this.m_pSndMouseOver);\n        } else if (!this.m_bEnable)', '} else if (this.m_bMouseOver) {\n          this.ChangeState(BCS.MOUSEDOWN, false);\n          this.playSound(this.m_pSndMouseOver);\n        } else if (!this.m_bEnable)')
m(b, 'button: normal: the mouse over plays the sound', 'this.ChangeState(BCS.MOUSEOVER, false);\n          this.playSound(this.m_pSndMouseOver);\n        } else if (!this.m_bEnable)', 'this.ChangeState(BCS.MOUSEOVER, false);\n        } else if (!this.m_bEnable)')
m(b, 'button: normal: a button that is not enabled is disabled', '} else if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);\n        return 0;\n      case BCS.MOUSEOVER:', '} else if (this.m_bEnable) this.ChangeState(BCS.DISABLE, false);\n        return 0;\n      case BCS.MOUSEOVER:')
m(b, 'button: over: over at normal stays', 'case BCS.MOUSEOVER:\n        if (this.m_bOverStateAtNormal) {\n          if (!this.m_bEnable)', 'case BCS.MOUSEOVER:\n        if (false) {\n          if (!this.m_bEnable)')
m(b, 'button: over: over at normal and not enabled is disabled', 'if (this.m_bOverStateAtNormal) {\n          if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);\n        } else if (this.m_bDownStateAtNormal) {', 'if (this.m_bOverStateAtNormal) {\n          if (this.m_bEnable) this.ChangeState(BCS.DISABLE, false);\n        } else if (this.m_bDownStateAtNormal) {')
m(b, 'button: over: down at normal goes to normal (or disabled)', 'this.ChangeState(this.m_bEnable ? BCS.NORMAL : BCS.DISABLE, false);', 'this.ChangeState(this.m_bEnable ? BCS.DISABLE : BCS.NORMAL, false);')
m(b, 'button: over: the mouse over stays', '} else if (this.m_bMouseOver) {\n          if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);\n        } else {\n          this.m_bMouseOut = true;', '} else if (!this.m_bMouseOver) {\n          if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);\n        } else {\n          this.m_bMouseOut = true;')
m(b, 'button: over: the mouse over and not enabled is disabled', '} else if (this.m_bMouseOver) {\n          if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);\n        } else {', '} else if (this.m_bMouseOver) {\n          if (this.m_bEnable) this.ChangeState(BCS.DISABLE, false);\n        } else {')
m(b, 'button: over: the mouse out is noted', 'this.m_bMouseOut = true;\n          this.ChangeState(BCS.NORMAL, false);', 'this.ChangeState(BCS.NORMAL, false);')
m(b, 'button: over: the mouse out goes to normal', 'this.m_bMouseOut = true;\n          this.ChangeState(BCS.NORMAL, false);', 'this.m_bMouseOut = true;\n          this.ChangeState(BCS.DISABLE, false);')
m(b, 'button: over: the guide text is asked for', 'this.showGuideDesc();\n        return 0;\n      case BCS.MOUSEDOWN:', 'return 0;\n      case BCS.MOUSEDOWN:')
m(b, 'button: down: stays while down at normal or the mouse over', 'if (this.m_bDownStateAtNormal || this.m_bMouseOver) {\n          if (!this.m_bEnable)', 'if (this.m_bDownStateAtNormal && this.m_bMouseOver) {\n          if (!this.m_bEnable)')
m(b, 'button: down: not enabled is disabled', 'if (this.m_bDownStateAtNormal || this.m_bMouseOver) {\n          if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);', 'if (this.m_bDownStateAtNormal || this.m_bMouseOver) {\n          if (this.m_bEnable) this.ChangeState(BCS.DISABLE, false);')
m(b, 'button: down: goes back to normal', '} else this.ChangeState(BCS.NORMAL, false);\n        return 0;\n      case BCS.DISABLE:', '} else this.ChangeState(BCS.DISABLE, false);\n        return 0;\n      case BCS.DISABLE:')
m(b, 'button: disabled: the guide text with the mouse over', 'if (this.m_bShowDescriptionWhenDisable && this.m_bMouseOver) this.showGuideDesc();\n        if (this.m_bEnable) this.ChangeState(BCS.NORMAL, false);', 'if (this.m_bShowDescriptionWhenDisable || this.m_bMouseOver) this.showGuideDesc();\n        if (this.m_bEnable) this.ChangeState(BCS.NORMAL, false);')
m(b, 'button: disabled: enabled again goes to normal', 'if (this.m_bShowDescriptionWhenDisable && this.m_bMouseOver) this.showGuideDesc();\n        if (this.m_bEnable) this.ChangeState(BCS.NORMAL, false);', 'if (this.m_bShowDescriptionWhenDisable && this.m_bMouseOver) this.showGuideDesc();\n        if (!this.m_bEnable) this.ChangeState(BCS.NORMAL, false);')

# ---- checkbox.ts ------------------------------------------------------------------------------------------------------------------------
k = 'checkbox.ts'
m(k, 'checkbox: a hidden box does nothing', 'if (!this.m_bShow) return 0;\n    super.onFrameMove', 'super.onFrameMove')
m(k, 'checkbox: the point moves when the change times differ', 'if (this.m_EndPoint.fChangeTime !== this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);', 'if (this.m_EndPoint.fChangeTime === this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);')
m(k, 'checkbox: normal: the mouse over goes to mouse over', 'case CBCS.NORMAL:\n        if (this.m_bMouseOver) {\n          this.ChangeState(CBCS.MOUSEOVER);', 'case CBCS.NORMAL:\n        if (!this.m_bMouseOver) {\n          this.ChangeState(CBCS.MOUSEOVER);')
m(k, 'checkbox: normal: the target is mouse over', 'this.ChangeState(CBCS.MOUSEOVER);\n          return 0;', 'this.ChangeState(CBCS.DISABLE);\n          return 0;')
m(k, 'checkbox: over: the mouse gone goes to normal', 'case CBCS.MOUSEOVER:\n        if (!this.m_bMouseOver) {\n          this.ChangeState(CBCS.NORMAL);', 'case CBCS.MOUSEOVER:\n        if (this.m_bMouseOver) {\n          this.ChangeState(CBCS.NORMAL);')
m(k, 'checkbox: over: the target is normal', 'this.ChangeState(CBCS.NORMAL);\n          return 0;\n        }\n        break;\n      case CBCS.DISABLE:', 'this.ChangeState(CBCS.DISABLE);\n          return 0;\n        }\n        break;\n      case CBCS.DISABLE:')
m(k, 'checkbox: disabled: enabled goes to normal', 'if (this.m_bEnable) this.ChangeState(CBCS.NORMAL);\n        return 0;', 'if (!this.m_bEnable) this.ChangeState(CBCS.NORMAL);\n        return 0;')
m(k, 'checkbox: not enabled is disabled', 'if (!this.m_bEnable) this.ChangeState(CBCS.DISABLE);\n    return 0;\n  }', 'if (this.m_bEnable) this.ChangeState(CBCS.DISABLE);\n    return 0;\n  }')
m(k, 'checkbox: not enabled goes to disabled', 'if (!this.m_bEnable) this.ChangeState(CBCS.DISABLE);\n    return 0;\n  }', 'if (!this.m_bEnable) this.ChangeState(CBCS.NORMAL);\n    return 0;\n  }')

# ---- radiobutton.ts ---------------------------------------------------------------------------------------------------------------------
r = 'radiobutton.ts'
m(r, 'radio: a hidden button does nothing', 'if (!this.m_bShow) return 0;\n    super.onFrameMove', 'super.onFrameMove')
m(r, 'radio: the point moves when the change times differ', 'if (this.m_EndPoint.fChangeTime !== this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);', 'if (this.m_EndPoint.fChangeTime === this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);')
m(r, 'radio: its own point moves when the change times differ', 'if (this.m_MyEndPoint.fChangeTime !== this.m_MyNowPoint.fChangeTime) this.changePoint(this.m_MyNowPoint, this.m_MyEndPoint);', 'if (this.m_MyEndPoint.fChangeTime === this.m_MyNowPoint.fChangeTime) this.changePoint(this.m_MyNowPoint, this.m_MyEndPoint);')
m(r, 'radio: its own point moves', 'this.changePoint(this.m_MyNowPoint, this.m_MyEndPoint);', 'this.changePoint(this.m_MyEndPoint, this.m_MyNowPoint);')
m(r, 'radio: normal: the mouse over', 'case RBCS.NORMAL:\n        if (this.m_bMouseOver) {', 'case RBCS.NORMAL:\n        if (!this.m_bMouseOver) {')
m(r, 'radio: normal: the sound is for an unchecked button', 'if (!this.m_bChecked) this.playSound(this.m_pSndMouseOver);', 'if (this.m_bChecked) this.playSound(this.m_pSndMouseOver);')
m(r, 'radio: normal: the over message', 'if (this.m_CustomMsgMouseOver !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOver);', 'if (this.m_CustomMsgMouseOver !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOut);')
m(r, 'radio: normal: the over message needs an id', 'if (this.m_CustomMsgMouseOver !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOver);', 'if (this.m_CustomMsgMouseOver === -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOver);')
m(r, 'radio: normal: the target is mouse over', 'this.ChangeState(RBCS.MOUSEOVER);\n          return 0;', 'this.ChangeState(RBCS.DISABLE);\n          return 0;')
m(r, 'radio: normal: not enabled is disabled', 'if (!this.m_bEnable) this.ChangeState(RBCS.DISABLE);\n        return 0;\n      case RBCS.MOUSEOVER:', 'if (this.m_bEnable) this.ChangeState(RBCS.DISABLE);\n        return 0;\n      case RBCS.MOUSEOVER:')
m(r, 'radio: over: the mouse over stays', 'case RBCS.MOUSEOVER:\n        if (this.m_bMouseOver) {', 'case RBCS.MOUSEOVER:\n        if (!this.m_bMouseOver) {')
m(r, 'radio: over: not enabled is disabled', 'if (this.m_bMouseOver) {\n          if (!this.m_bEnable) this.ChangeState(RBCS.DISABLE);\n        } else {', 'if (this.m_bMouseOver) {\n          if (this.m_bEnable) this.ChangeState(RBCS.DISABLE);\n        } else {')
m(r, 'radio: over: the out message is sent when the over message is set', 'if (this.m_CustomMsgMouseOver !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOut);', 'if (this.m_CustomMsgMouseOut !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOut);')
m(r, 'radio: over: the out message is the out message', 'this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOut);', 'this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOver);')
m(r, 'radio: over: the mouse gone goes to normal', 'this.ChangeState(RBCS.NORMAL);\n        }\n        this.showGuideDesc();', 'this.ChangeState(RBCS.DISABLE);\n        }\n        this.showGuideDesc();')
m(r, 'radio: over: the guide text is asked for', 'this.showGuideDesc();\n        return 0;\n      case RBCS.DISABLE:', 'return 0;\n      case RBCS.DISABLE:')
m(r, 'radio: disabled: the guide text with the mouse over', 'if (this.m_bShowDescriptionWhenDisable && this.m_bMouseOver) this.showGuideDesc();', 'if (this.m_bShowDescriptionWhenDisable || this.m_bMouseOver) this.showGuideDesc();')
m(r, 'radio: disabled: enabled goes to normal', 'if (this.m_bEnable) this.ChangeState(RBCS.NORMAL);\n        return 0;', 'if (!this.m_bEnable) this.ChangeState(RBCS.NORMAL);\n        return 0;')

# ---- slider.ts, scrollbar.ts, navigation.ts, controllist.ts -----------------------------------------------------------------------------
m('slider.ts', 'slider: a hidden slider is not moved', 'if (this.m_bShow) {\n      super.onFrameMove(fTime, fElapsedTime);\n      const b = this.m_rcBoundingBox', 'if (true) {\n      super.onFrameMove(fTime, fElapsedTime);\n      const b = this.m_rcBoundingBox')
m('slider.ts', 'slider: the control moves', 'super.onFrameMove(fTime, fElapsedTime);\n      const b = this.m_rcBoundingBox', 'const b = this.m_rcBoundingBox')
m('slider.ts', 'slider: left-top', 'p.leftTopPoint.set(b.left, b.top);', 'p.leftTopPoint.set(b.top, b.left);')
m('slider.ts', 'slider: right-top', 'p.rightTopPoint.set(b.right, b.top);', 'p.rightTopPoint.set(b.right, b.bottom);')
m('slider.ts', 'slider: left-bottom', 'p.leftBottomPoint.set(b.left, b.bottom);', 'p.leftBottomPoint.set(b.right, b.bottom);')
m('slider.ts', 'slider: right-bottom', 'p.rightBottomPoint.set(b.right, b.bottom);', 'p.rightBottomPoint.set(b.bottom, b.right);')
m('scrollbar.ts', 'scrollbar: a hidden bar is not moved', 'if (this.m_bShow) {\n      super.onFrameMove(fTime, fElapsedTime);\n      const t = this.m_rcTrack', 'if (true) {\n      super.onFrameMove(fTime, fElapsedTime);\n      const t = this.m_rcTrack')
m('scrollbar.ts', 'scrollbar: the control moves', 'super.onFrameMove(fTime, fElapsedTime);\n      const t = this.m_rcTrack', 'const t = this.m_rcTrack')
m('scrollbar.ts', 'scrollbar: left-top', 'p.leftTopPoint.set(t.left, t.top);', 'p.leftTopPoint.set(t.top, t.left);')
m('scrollbar.ts', 'scrollbar: right-top', 'p.rightTopPoint.set(t.right, t.top);', 'p.rightTopPoint.set(t.right, t.bottom);')
m('scrollbar.ts', 'scrollbar: left-bottom', 'p.leftBottomPoint.set(t.left, t.bottom);', 'p.leftBottomPoint.set(t.right, t.bottom);')
m('scrollbar.ts', 'scrollbar: right-bottom', 'p.rightBottomPoint.set(t.right, t.bottom);', 'p.rightBottomPoint.set(t.bottom, t.right);')
m('navigation.ts', 'navigation: only an enabled one moves', 'if (this.m_bEnable) super.onFrameMove(fTime, fElapsedTime);', 'super.onFrameMove(fTime, fElapsedTime);')
m('navigation.ts', 'navigation: it moves', 'if (this.m_bEnable) super.onFrameMove(fTime, fElapsedTime);', 'if (this.m_bEnable) { }')
l = 'controllist.ts'
m(l, 'list: a hidden list does nothing', 'if (!(this.m_bShow && this.m_bEnable)) return 0;\n    super.onFrameMove', 'if (!this.m_bEnable) return 0;\n    super.onFrameMove')
m(l, 'list: a disabled list does nothing', 'if (!(this.m_bShow && this.m_bEnable)) return 0;\n    super.onFrameMove', 'if (!this.m_bShow) return 0;\n    super.onFrameMove')
m(l, 'list: the control moves', 'super.onFrameMove(fTime, fElapsedTime);\n    const barX', 'const barX')
m(l, 'list: the X bar moves', 'barX.onFrameMove(fTime, fElapsedTime);\n      x = barX.m_nPosition;', 'x = barX.m_nPosition;')
m(l, 'list: the X index is the X bar\'s position', 'x = barX.m_nPosition;', 'x = barX.m_nEnd;')
m(l, 'list: the Y bar moves', 'barY.onFrameMove(fTime, fElapsedTime);\n      y = barY.m_nPosition;', 'y = barY.m_nPosition;')
m(l, 'list: the Y index is the Y bar\'s position', 'y = barY.m_nPosition;', 'y = barY.m_nEnd;')
m(l, 'list: a new X position is taken', 'if (this.m_iTopIndexX !== x || this.m_iTopIndexY !== y) {', 'if (this.m_iTopIndexY !== y) {')
m(l, 'list: a new Y position is taken', 'if (this.m_iTopIndexX !== x || this.m_iTopIndexY !== y) {', 'if (this.m_iTopIndexX !== x) {')
m(l, 'list: the top index Y', 'this.m_iTopIndexY = y;\n      this.m_iTopIndexX = x;', 'this.m_iTopIndexX = x;')
m(l, 'list: the top index X', 'this.m_iTopIndexY = y;\n      this.m_iTopIndexX = x;', 'this.m_iTopIndexY = y;')
m(l, 'list: the bars are updated', 'this.updateScrollBar();\n      this.updateRenderControlList();', 'this.updateRenderControlList();')
m(l, 'list: the controls are placed', 'this.updateScrollBar();\n      this.updateRenderControlList();', 'this.updateScrollBar();')
m(l, 'list: the scroll message', 'if (this.m_CustomMsgScroll !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgScroll);\n    }\n    const b = this.m_rcBoundingBox;', 'this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgScroll);\n    }\n    const b = this.m_rcBoundingBox;')
m(l, 'list: the Y bar shifts the box right', 'left = (left + barY.m_width) | 0;\n      right = (right + barY.m_width) | 0;', 'right = (right + barY.m_width) | 0;')
m(l, 'list: the Y bar shifts the right edge', 'right = (right + barY.m_width) | 0;', '')
m(l, 'list: the X bar shifts the box down', 'top = (top + barX.m_width) | 0;\n      bottom = (bottom + barX.m_width) | 0;', 'bottom = (bottom + barX.m_width) | 0;')
m(l, 'list: the X bar shifts the bottom edge', 'bottom = (bottom + barX.m_width) | 0;', '')
m(l, 'list: left-top', 'p.leftTopPoint.set(left, top);', 'p.leftTopPoint.set(top, left);')
m(l, 'list: right-top', 'p.rightTopPoint.set(right, top);', 'p.rightTopPoint.set(right, bottom);')
m(l, 'list: left-bottom', 'p.leftBottomPoint.set(left, bottom);', 'p.leftBottomPoint.set(right, bottom);')
m(l, 'list: right-bottom', 'p.rightBottomPoint.set(right, bottom);', 'p.rightBottomPoint.set(bottom, right);')

# ---- combobox.ts ------------------------------------------------------------------------------------------------------------------------
cb = 'combobox.ts'
m(cb, 'combo: a hidden box does nothing', 'if (!(this.m_bShow && this.m_bEnable)) return 0;\n    super.onFrameMove(fTime, fElapsedTime);\n    this.m_pScrollBar', 'if (!this.m_bEnable) return 0;\n    super.onFrameMove(fTime, fElapsedTime);\n    this.m_pScrollBar')
m(cb, 'combo: a disabled box does nothing', 'if (!(this.m_bShow && this.m_bEnable)) return 0;\n    super.onFrameMove(fTime, fElapsedTime);\n    this.m_pScrollBar', 'if (!this.m_bShow) return 0;\n    super.onFrameMove(fTime, fElapsedTime);\n    this.m_pScrollBar')
m(cb, 'combo: the control moves', 'super.onFrameMove(fTime, fElapsedTime);\n    this.m_pScrollBar?.onFrameMove(fTime, fElapsedTime);', 'this.m_pScrollBar?.onFrameMove(fTime, fElapsedTime);')
m(cb, 'combo: the scroll bar moves', 'this.m_pScrollBar?.onFrameMove(fTime, fElapsedTime);\n    copyRect', 'copyRect')
m(cb, 'combo: the button is the second bounding box', 'copyRect(this.m_rcBoundingBox2, this.m_rcButton);', '')
m(cb, 'combo: left-top', 'p.leftTopPoint.set(b.left, b.top);', 'p.leftTopPoint.set(b.top, b.left);')
m(cb, 'combo: right-top', 'p.rightTopPoint.set(b.right, b.top);', 'p.rightTopPoint.set(b.right, b.bottom);')
m(cb, 'combo: left-bottom', 'p.leftBottomPoint.set(b.left, b.bottom);', 'p.leftBottomPoint.set(b.right, b.bottom);')
m(cb, 'combo: right-bottom', 'p.rightBottomPoint.set(b.right, b.bottom);', 'p.rightBottomPoint.set(b.bottom, b.right);')
m(cb, 'combo: the rows\' controls move', 'this.m_Items[i]!.pControl?.onFrameMove(fTime, fElapsedTime);', '')
m(cb, 'combo: the mouse over', 'if (this.m_bMouseOver) {\n      if (!this.m_bMouseOverCheck) {', 'if (!this.m_bMouseOver) {\n      if (!this.m_bMouseOverCheck) {')
m(cb, 'combo: the sound is played once', 'if (!this.m_bMouseOverCheck) {\n        this.m_bMouseOverCheck = true;', 'if (true) {\n        this.m_bMouseOverCheck = true;')
m(cb, 'combo: the sound is played', 'this.m_bMouseOverCheck = true;\n        this.playSound(this.m_pSndButtonMouseOver);', 'this.m_bMouseOverCheck = true;')
m(cb, 'combo: the check is noted', 'this.m_bMouseOverCheck = true;\n        this.playSound', 'this.playSound')
m(cb, 'combo: the check is cleared', '} else {\n      this.m_bMouseOverCheck = false;\n    }', '} else {\n    }')

# ---- listbox.ts -------------------------------------------------------------------------------------------------------------------------
lb = 'listbox.ts'
m(lb, 'listbox: a hidden box does nothing', 'if (!this.m_bShow || !this.m_bEnable) return 0;\n    this.m_pGroupMark', 'if (!this.m_bEnable) return 0;\n    this.m_pGroupMark')
m(lb, 'listbox: a disabled box does nothing', 'if (!this.m_bShow || !this.m_bEnable) return 0;\n    this.m_pGroupMark', 'if (!this.m_bShow) return 0;\n    this.m_pGroupMark')
m(lb, 'listbox: the group mark moves', 'this.m_pGroupMark.onFrameMove(fTime, fElapsedTime);\n    super.onFrameMove', 'super.onFrameMove')
m(lb, 'listbox: the control moves', 'super.onFrameMove(fTime, fElapsedTime);\n    const bar = this.m_pScrollBar;', 'const bar = this.m_pScrollBar;')
m(lb, 'listbox: the bar moves', 'bar?.onFrameMove(fTime, fElapsedTime);', '')
m(lb, 'listbox: the bar shifts the box right', 'left = (left + bar.m_width) | 0;\n      right = (right + bar.m_width) | 0;', 'right = (right + bar.m_width) | 0;')
m(lb, 'listbox: the bar shifts the right edge', 'right = (right + bar.m_width) | 0;', '')
m(lb, 'listbox: left-top y', 'p.leftTopPoint.y = b.top;', 'p.leftTopPoint.y = b.bottom;')
m(lb, 'listbox: right-top y', 'p.rightTopPoint.y = b.top;', 'p.rightTopPoint.y = b.bottom;')
m(lb, 'listbox: left-top x', 'p.leftTopPoint.x = left;', 'p.leftTopPoint.x = right;')
m(lb, 'listbox: right-top x', 'p.rightTopPoint.x = right;', 'p.rightTopPoint.x = left;')
m(lb, 'listbox: left-bottom x', 'p.leftBottomPoint.x = left;', 'p.leftBottomPoint.x = right;')
m(lb, 'listbox: left-bottom y', 'p.leftBottomPoint.y = b.bottom;', 'p.leftBottomPoint.y = b.top;')
m(lb, 'listbox: right-bottom x', 'p.rightBottomPoint.x = right;\n    p.rightBottomPoint.y', 'p.rightBottomPoint.x = left;\n    p.rightBottomPoint.y')
m(lb, 'listbox: right-bottom y', 'p.rightBottomPoint.y = b.bottom;', 'p.rightBottomPoint.y = b.top;')
m(lb, 'listbox: a row with a show time counts down', 'if (item.m_fTimeLeftShow > 0) {', 'if (item.m_fTimeLeftShow >= 0) {')
m(lb, 'listbox: the show time counts down', 'const t = Math.fround(item.m_fTimeLeftShow - dt);', 'const t = Math.fround(item.m_fTimeLeftShow + dt);')
m(lb, 'listbox: a row is hidden below 0', 'if (t < 0) {\n          item.m_fTimeLeftShow = 0;', 'if (t <= 0) {\n          item.m_fTimeLeftShow = 0;')
m(lb, 'listbox: the time left stops at 0', 'item.m_fTimeLeftShow = 0;\n          item.m_bShow = false;', 'item.m_bShow = false;')
m(lb, 'listbox: the row is hidden', 'item.m_fTimeLeftShow = 0;\n          item.m_bShow = false;', 'item.m_fTimeLeftShow = 0;')
m(lb, 'listbox: a spreading row is moved', 'if (item.bSpread) {\n        if (item.iSpreadCount >= item.strText.length) {', 'if (!item.bSpread) {\n        if (item.iSpreadCount >= item.strText.length) {')
m(lb, 'listbox: a row that is all shown stops spreading', 'if (item.iSpreadCount >= item.strText.length) {', 'if (item.iSpreadCount > item.strText.length) {')
m(lb, 'listbox: ... and says so', 'item.bSpread = false;\n        } else {', '} else {')
m(lb, 'listbox: the spread time counts the frame', 'const t = Math.fround(dt + item.fNowSpreadTime);', 'const t = dt;')
m(lb, 'listbox: a character each time the gap is passed', 'if (t > item.fSpreadTimeGap) {', 'if (t >= item.fSpreadTimeGap) {')
m(lb, 'listbox: the spread time starts again', 'item.fNowSpreadTime = 0;\n            item.iSpreadCount', 'item.iSpreadCount')
m(lb, 'listbox: one more character', 'item.iSpreadCount = (item.iSpreadCount + 1) | 0;', 'item.iSpreadCount = (item.iSpreadCount + 2) | 0;')
m(lb, 'listbox: the rows\' controls move', 'item.pControl?.onFrameMove(fTime, fElapsedTime);', '')

# ---- editbox.ts, imeeditbox.ts ----------------------------------------------------------------------------------------------------------
e = 'editbox.ts'
m(e, 'edit: a disabled box does nothing', 'if (!this.m_bEnable) return 0;\n    super.onFrameMove', 'super.onFrameMove')
m(e, 'edit: the control moves', 'super.onFrameMove(fTime, fElapsedTime);\n    this.m_fElapsedTime = Math.fround(fElapsedTime);\n    let point', 'this.m_fElapsedTime = Math.fround(fElapsedTime);\n    let point')
m(e, 'edit: the frame time is a float', 'this.m_fElapsedTime = Math.fround(fElapsedTime);\n    let point', 'this.m_fElapsedTime = fElapsedTime;\n    let point')
m(e, 'edit: a background is the normal point', 'if (this.m_bBGCheck) {\n      point = this.m_pNormalPoint;', 'if (!this.m_bBGCheck) {\n      point = this.m_pNormalPoint;')
m(e, 'edit: a background is the end point', 'this.m_EndPoint.assign(point);\n    } else {', '    } else {')
m(e, 'edit: without a background the text point is the point', 'point = this.m_pTextPoint;\n    }\n    const text', 'point = this.m_pNormalPoint;\n    }\n    const text')
m(e, 'edit: the point is the current point', 'this.m_NowPoint.assign(point);', '')
m(e, 'edit: left', 'rc.left = ftoi(text.leftTopPoint.x);', 'rc.left = Math.round(text.leftTopPoint.x);')
m(e, 'edit: top', 'rc.top = ftoi(text.leftTopPoint.y);', 'rc.top = ftoi(text.leftTopPoint.x);')
m(e, 'edit: right', 'rc.right = ftoi(text.rightBottomPoint.x);', 'rc.right = ftoi(text.rightTopPoint.x);')
m(e, 'edit: bottom', 'rc.bottom = ftoi(text.rightBottomPoint.y);', 'rc.bottom = ftoi(text.rightTopPoint.y);')
i = 'imeeditbox.ts'
m(i, 'ime: a hidden box does nothing', 'if (!this.m_bShow) return 0;\n    super.onFrameMove(fTime, fElapsedTime);\n    this.m_fElapsedTime = Math.fround(fElapsedTime);\n    let point', 'super.onFrameMove(fTime, fElapsedTime);\n    this.m_fElapsedTime = Math.fround(fElapsedTime);\n    let point')
m(i, 'ime: the control moves', 'super.onFrameMove(fTime, fElapsedTime);\n    this.m_fElapsedTime = Math.fround(fElapsedTime);\n    let point', 'this.m_fElapsedTime = Math.fround(fElapsedTime);\n    let point')
m(i, 'ime: the frame time is a float', 'this.m_fElapsedTime = Math.fround(fElapsedTime);\n    let point', 'this.m_fElapsedTime = fElapsedTime;\n    let point')
m(i, 'ime: a background is the normal or the disabled point', 'point = this.m_bEnable ? this.m_pNormalPoint : this.m_pDisablePoint;', 'point = this.m_bEnable ? this.m_pDisablePoint : this.m_pNormalPoint;')
m(i, 'ime: a background is the end point', 'this.m_EndPoint.assign(point);\n    } else {', '    } else {')
m(i, 'ime: without a background the text point is the point', 'point = this.m_pTextPoint;\n    }\n    const text', 'point = this.m_pNormalPoint;\n    }\n    const text')
m(i, 'ime: the point is the current point', 'this.m_NowPoint.assign(point);', '')
m(i, 'ime: the offset x is cut', 'const x = ftoi(this.m_OffsetPos.x), y = ftoi(this.m_OffsetPos.y);', 'const x = Math.round(this.m_OffsetPos.x), y = ftoi(this.m_OffsetPos.y);')
m(i, 'ime: the offset y is cut', 'const x = ftoi(this.m_OffsetPos.x), y = ftoi(this.m_OffsetPos.y);', 'const x = ftoi(this.m_OffsetPos.x), y = Math.round(this.m_OffsetPos.y);')
m(i, 'ime: left', 'rc.left = (x + ftoi(text.leftTopPoint.x)) | 0;', 'rc.left = ftoi(text.leftTopPoint.x);')
m(i, 'ime: top', 'rc.top = (y + ftoi(text.leftTopPoint.y)) | 0;', 'rc.top = (x + ftoi(text.leftTopPoint.y)) | 0;')
m(i, 'ime: right', 'rc.right = (x + ftoi(text.rightBottomPoint.x)) | 0;', 'rc.right = ftoi(text.rightBottomPoint.x);')
m(i, 'ime: bottom', 'rc.bottom = (y + ftoi(text.rightBottomPoint.y)) | 0;', 'rc.bottom = ftoi(text.rightBottomPoint.y);')
m(i, 'ime: a default alignment of -1 does not centre', 'if (align !== 0xffffffff && (align & 1) !== 0) {', 'if ((align & 1) !== 0) {')
m(i, 'ime: bit 0 of the alignment centres', 'if (align !== 0xffffffff && (align & 1) !== 0) {', 'if (align !== 0xffffffff && (align & 1) === 0) {')
m(i, 'ime: a text wider than the rectangle is not centred', 'if (!(whole > ((rc.right - rc.left) | 0))) {', 'if (!(whole >= ((rc.right - rc.left) | 0))) {')
m(i, 'ime: the width of the rectangle', '((rc.right - rc.left) | 0)', '((rc.left - rc.right) | 0)')
m(i, 'ime: the offset is half the point\'s width', 'Math.fround(Math.fround(Math.fround(n.rightTopPoint.x - n.leftTopPoint.x) * 0.5)', 'Math.fround(Math.fround(Math.fround(n.rightTopPoint.x + n.leftTopPoint.x) * 0.5)')
m(i, 'ime: ... minus half the text\'s', '- Math.fround(Math.fround((end - first) | 0) * 0.5)))', '+ Math.fround(Math.fround((end - first) | 0) * 0.5)))')
m(i, 'ime: the offset is cut', 'offset = ftoi(Math.fround(', 'offset = Math.round(Math.fround(')
m(i, 'ime: the offset y is 0', 'this.m_ptTextAlignOffset.y = 0;\n    return 0;', 'this.m_ptTextAlignOffset.y = 1;\n    return 0;')
m(i, 'ime: the offset x is stored', 'this.m_ptTextAlignOffset.x = offset;', '')

# ---- slot.ts ----------------------------------------------------------------------------------------------------------------------------
sl = 'slot.ts'
m(sl, 'slot: a hidden slot does nothing', 'if (!this.m_bShow) return 0;\n    super.onFrameMove(fTime, fElapsedTime);\n    this.m_fElapsedTime = Math.fround(fElapsedTime);\n    if (this.m_EndPoint', 'super.onFrameMove(fTime, fElapsedTime);\n    this.m_fElapsedTime = Math.fround(fElapsedTime);\n    if (this.m_EndPoint')
m(sl, 'slot: the control moves', 'super.onFrameMove(fTime, fElapsedTime);\n    this.m_fElapsedTime = Math.fround(fElapsedTime);\n    if (this.m_EndPoint', 'this.m_fElapsedTime = Math.fround(fElapsedTime);\n    if (this.m_EndPoint')
m(sl, 'slot: the point moves when the change times differ', 'if (this.m_EndPoint.fChangeTime !== this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);', 'if (this.m_EndPoint.fChangeTime === this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);')
m(sl, 'slot: a dialog in front takes the mouse over', 'checkFrontModalDlg(this.m_pDialog)) this.m_bMouseOver = false;', 'checkFrontModalDlg(this.m_pDialog)) this.m_bMouseOver = true;')
m(sl, 'slot: new data is shown', 'if (data !== null && data.m_bDataUpdated) {', 'if (data !== null && !data.m_bDataUpdated) {')
m(sl, 'slot: the UI is updated', 'data.UpdateUI(this);\n      data.m_bDataUpdated = false;', 'data.m_bDataUpdated = false;')
m(sl, 'slot: the data is no longer new', 'data.UpdateUI(this);\n      data.m_bDataUpdated = false;', 'data.UpdateUI(this);')
m(sl, 'slot: disabled if not enabled', 'if (!this.m_bEnable) this.ChangeState(SCS.DISABLE, false);\n    };', 'if (this.m_bEnable) this.ChangeState(SCS.DISABLE, false);\n    };')
m(sl, 'slot: disabled state', 'if (!this.m_bEnable) this.ChangeState(SCS.DISABLE, false);\n    };', 'if (!this.m_bEnable) this.ChangeState(SCS.NORMAL, false);\n    };')
m(sl, 'slot: normal state', 'const normal = (): void => this.ChangeState(SCS.NORMAL, false);', 'const normal = (): void => this.ChangeState(SCS.DISABLE, false);')
m(sl, 'slot: normal: the mouse over', 'case SCS.NORMAL:\n        if (!this.m_bMouseOver) disableIfNotEnabled();', 'case SCS.NORMAL:\n        if (this.m_bMouseOver) disableIfNotEnabled();')
m(sl, 'slot: normal: the target is mouse over', 'this.ChangeState(SCS.MOUSEOVER, false);\n          this.playSound(this.m_pSndMouseOver);', 'this.ChangeState(SCS.DOWN, false);\n          this.playSound(this.m_pSndMouseOver);')
m(sl, 'slot: normal: the sound', 'this.ChangeState(SCS.MOUSEOVER, false);\n          this.playSound(this.m_pSndMouseOver);', 'this.ChangeState(SCS.MOUSEOVER, false);')
m(sl, 'slot: down: the mouse gone goes to normal', 'case SCS.DOWN:\n        if (!this.m_bMouseOver) normal();', 'case SCS.DOWN:\n        if (this.m_bMouseOver) normal();')
m(sl, 'slot: down: the mouse over and not enabled is disabled', 'if (!this.m_bMouseOver) normal();\n        else disableIfNotEnabled();', 'if (!this.m_bMouseOver) normal();')
m(sl, 'slot: over: the guide text is asked for', 'case SCS.MOUSEOVER:\n        this.showGuideDesc();', 'case SCS.MOUSEOVER:')
m(sl, 'slot: over: the mouse over stays', 'if (this.m_bMouseOver) disableIfNotEnabled();\n        else {\n          this.m_bMouseOut = true;', 'if (!this.m_bMouseOver) disableIfNotEnabled();\n        else {\n          this.m_bMouseOut = true;')
m(sl, 'slot: over: the mouse out is noted', 'this.m_bMouseOut = true;\n          normal();', 'normal();')
m(sl, 'slot: over: the mouse gone goes to normal', 'this.m_bMouseOut = true;\n          normal();', 'this.m_bMouseOut = true;')
m(sl, 'slot: drag: not enabled is disabled', 'case SCS.ONDRAG:\n        disableIfNotEnabled();', 'case SCS.ONDRAG:')
m(sl, 'slot: drag: a slot without the focus', 'if (!this.m_bHasFocus) {\n          CKTDGUISlot.returnDraggingItem();', 'if (this.m_bHasFocus) {\n          CKTDGUISlot.returnDraggingItem();')
m(sl, 'slot: drag: the dragged item is returned', 'CKTDGUISlot.returnDraggingItem();\n          normal();', 'normal();')
m(sl, 'slot: drag: the slot is normal', 'CKTDGUISlot.returnDraggingItem();\n          normal();', 'CKTDGUISlot.returnDraggingItem();')
m(sl, 'slot: disabled: the guide text', 'if (this.m_bShowDescriptionWhenDisable && this.m_bMouseOver) this.showGuideDesc();', 'if (this.m_bShowDescriptionWhenDisable || this.m_bMouseOver) this.showGuideDesc();')
m(sl, 'slot: disabled: enabled goes to normal', 'if (this.m_bEnable) normal();', 'if (!this.m_bEnable) normal();')
m(sl, 'slot: the additional pictures are in the order of their keys', '[...this.m_mapAdditionalPictureDataList.keys()].sort((a, b) => a - b)', '[...this.m_mapAdditionalPictureDataList.keys()]')
m(sl, 'slot: the additional pictures that are shown move', 'if (picture.bShow) picture.onFrameMove(fTime, fElapsedTime);', 'if (!picture.bShow) picture.onFrameMove(fTime, fElapsedTime);')
m(sl, 'slot: the additional pictures move', 'if (picture.bShow) picture.onFrameMove(fTime, fElapsedTime);', 'if (picture.bShow) { }')
m(sl, 'slot: ReturnDraggingItem forces normal', 'dragged.ChangeState(SCS.NORMAL, true);\n      CKTDGUISlot.s_pDragSlot = null;', 'dragged.ChangeState(SCS.NORMAL, false);\n      CKTDGUISlot.s_pDragSlot = null;')
m(sl, 'slot: ReturnDraggingItem forgets the slot', 'dragged.ChangeState(SCS.NORMAL, true);\n      CKTDGUISlot.s_pDragSlot = null;', 'dragged.ChangeState(SCS.NORMAL, true);')

# ---- dialog.ts --------------------------------------------------------------------------------------------------------------------------
d = 'dialog.ts'
m(d, 'dialog: the guide text\'s static is hidden', 'this.m_pStaticGuideDesc?.SetShow(false);', '')
m(d, 'dialog: a shown guide dialog is hidden', 'if (guide.m_bShow) {\n        const inner', 'if (!guide.m_bShow) {\n        const inner')
m(d, 'dialog: the guide dialog is hidden', 'guide.m_bShow = false;\n        if (inner !== null)', 'if (inner !== null)')
m(d, 'dialog: the guide\'s guide dialog is hidden', 'if (inner !== null) inner.setShow(false);', '')
m(d, 'dialog: the modal count is made again for a dialog that is not modal', 'if (!guide.m_bModal && guide.m_pkUIDialogManager !== null) guide.m_pkUIDialogManager.countModalDialog(null);', 'if (guide.m_bModal && guide.m_pkUIDialogManager !== null) guide.m_pkUIDialogManager.countModalDialog(null);')
m(d, 'dialog: ... that has a manager', 'if (!guide.m_bModal && guide.m_pkUIDialogManager !== null) guide.m_pkUIDialogManager.countModalDialog(null);', 'if (!guide.m_bModal) guide.m_pkUIDialogManager!.countModalDialog(null);')
m(d, 'dialog: the dragged slot of the guide dialog is returned', 's_pDragSlot.m_pDialog === guide) CKTDGUISlot.returnDraggingItem();', 's_pDragSlot.m_pDialog !== guide) CKTDGUISlot.returnDraggingItem();')
m(d, 'dialog: a slot that is dragged is looked at', 'if (CKTDGUISlot.s_pDragSlot !== null && CKTDGUISlot.s_pDragSlot.m_pDialog === guide)', 'if (CKTDGUISlot.s_pDragSlot === null && CKTDGUISlot.s_pDragSlot.m_pDialog === guide)')
m(d, 'dialog: a dialog that is not enabled does nothing', 'if (!(this.m_bEnable && this.m_bShow)) return 0;\n    if (this.m_fChangeTime > 0) {', 'if (!this.m_bShow) return 0;\n    if (this.m_fChangeTime > 0) {')
m(d, 'dialog: a dialog that is hidden does nothing', 'if (!(this.m_bEnable && this.m_bShow)) return 0;\n    if (this.m_fChangeTime > 0) {', 'if (!this.m_bEnable) return 0;\n    if (this.m_fChangeTime > 0) {')
m(d, 'dialog: a move needs a change time', 'if (this.m_fChangeTime > 0) {\n      const at = this.m_fAnimateTime;', 'if (this.m_fChangeTime >= 0) {\n      const at = this.m_fAnimateTime;')
m(d, 'dialog: the move goes on while the animate time is below the change time', 'if (at < this.m_fChangeTime) {\n        const k', 'if (at <= this.m_fChangeTime) {\n        const k')
m(d, 'dialog: the share is 1 / (change time - animate time)', 'const k = f(1 / f(this.m_fChangeTime - at));', 'const k = f(1 / this.m_fChangeTime);')
m(d, 'dialog: x goes to the goal x', 'p.x = approach(p.x, g.x, k, dt);', 'p.x = approach(p.x, g.y, k, dt);')
m(d, 'dialog: y goes to the goal y', 'p.y = approach(p.y, g.y, k, dt);', 'p.y = approach(p.y, g.x, k, dt);')
m(d, 'dialog: without fading the colour is the goal', 'if (!this.m_bFadeInOut) {\n          c.set(gc.r, gc.g, gc.b, gc.a);', 'if (this.m_bFadeInOut) {\n          c.set(gc.r, gc.g, gc.b, gc.a);')
m(d, 'dialog: the goal colour', 'c.set(gc.r, gc.g, gc.b, gc.a);\n        } else {', 'c.set(gc.r, gc.b, gc.g, gc.a);\n        } else {')
m(d, 'dialog: red goes to the goal red', 'c.r = approach(c.r, gc.r, k, dt);', 'c.r = approach(c.r, gc.g, k, dt);')
m(d, 'dialog: green goes to the goal green', 'c.g = approach(c.g, gc.g, k, dt);', 'c.g = approach(c.g, gc.b, k, dt);')
m(d, 'dialog: blue goes to the goal blue', 'c.b = approach(c.b, gc.b, k, dt);', 'c.b = approach(c.b, gc.a, k, dt);')
m(d, 'dialog: alpha goes to the goal alpha', 'c.a = approach(c.a, gc.a, k, dt);', 'c.a = approach(c.a, gc.r, k, dt);')
m(d, 'dialog: the animate time counts the frame', 'this.m_fAnimateTime = f(dt + at);\n      } else {', 'this.m_fAnimateTime = dt;\n      } else {')
m(d, 'dialog: the end clears the animate time', 'this.m_fAnimateTime = 0;\n        this.m_fChangeTime = 0;\n        this.m_Pos.set(', 'this.m_fChangeTime = 0;\n        this.m_Pos.set(')
m(d, 'dialog: the end clears the change time', 'this.m_fChangeTime = 0;\n        this.m_Pos.set(', 'this.m_Pos.set(')
m(d, 'dialog: the end puts the position on the goal', 'this.m_Pos.set(this.m_GoalPos.x, this.m_GoalPos.y);\n        if (this.m_bAutoDelete)', 'this.m_Pos.set(this.m_GoalPos.y, this.m_GoalPos.x);\n        if (this.m_bAutoDelete)')
m(d, 'dialog: the end of an auto-delete move marks the dialog', 'if (this.m_bAutoDelete) this.m_bCheckAutoDeleteEnd = true;', 'if (!this.m_bAutoDelete) this.m_bCheckAutoDeleteEnd = true;')
m(d, 'dialog: the self-delete time', 'if (this.m_fTimeForSelfDelete > 0) {\n      if (((this.ctx.clock()', 'if (this.m_fTimeForSelfDelete >= 0) {\n      if (((this.ctx.clock()')
m(d, 'dialog: the self-delete time is passed', ') | 0) / 1000 > this.m_fTimeForSelfDelete) this.m_bCheckAutoDeleteEnd = true;', ') | 0) / 1000 >= this.m_fTimeForSelfDelete) this.m_bCheckAutoDeleteEnd = true;')
m(d, 'dialog: the self-delete time counts from the making', '(this.ctx.clock() - this.m_TimerToSelfDelete._start_time) | 0) / 1000 > this.m_fTimeForSelfDelete) this.m_bCheckAutoDeleteEnd = true;', '(this.ctx.clock() + this.m_TimerToSelfDelete._start_time) | 0) / 1000 > this.m_fTimeForSelfDelete) this.m_bCheckAutoDeleteEnd = true;')
m(d, 'dialog: the self-delete time is in seconds', ') | 0) / 1000 > this.m_fTimeForSelfDelete) this.m_bCheckAutoDeleteEnd = true;', ') | 0) / 100 > this.m_fTimeForSelfDelete) this.m_bCheckAutoDeleteEnd = true;')
m(d, 'dialog: the queue waits for the end of the move', 'if (this.m_fChangeTime === 0 && this.m_queMoveItems.length !== 0) {', 'if (this.m_queMoveItems.length !== 0) {')
m(d, 'dialog: the queue gives the goal position', 'this.m_GoalPos.set(item.pos.x, item.pos.y);\n      this.m_GoalColor', 'this.m_GoalPos.set(item.pos.y, item.pos.x);\n      this.m_GoalColor')
m(d, 'dialog: the queue gives the goal colour', 'this.m_GoalColor.set(item.color.r, item.color.g, item.color.b, item.color.a);', 'this.m_GoalColor.set(item.color.r, item.color.b, item.color.g, item.color.a);')
m(d, 'dialog: the queue gives auto-delete', 'this.m_bAutoDelete = item.bIsAutoDelete;\n      this.m_fChangeTime', 'this.m_fChangeTime')
m(d, 'dialog: the queue gives the change time', 'this.m_fChangeTime = item.fChangeTime;\n    }\n    for', '}\n    for')
m(d, 'dialog: the controls move from the last to the first', 'for (let i = this.m_ControlsList.length - 1; i >= 0; i--) {', 'for (let i = 0; i < this.m_ControlsList.length; i++) {')
m(d, 'dialog: a control that is marked is looked at', 'if (control.m_bCheckAutoDeleteEnd) {\n        const named', 'if (!control.m_bCheckAutoDeleteEnd) {\n        const named')
m(d, 'dialog: a marked control that the map has', 'if (named !== undefined) {\n          const at', 'if (named === undefined) {\n          const at')
m(d, 'dialog: a marked control that the map and the list have is destroyed', 'if (at >= 0) throw new Error', 'if (at < 0) throw new Error')
m(d, 'dialog: ... the list has the control of the map', 'const at = this.m_ControlsList.indexOf(named);', 'const at = this.m_ControlsList.indexOf(control);')
m(d, 'dialog: a marked control that only the map has: the entry goes', 'this.m_ControlsMap.erase(control.m_Name); // found in the map but not in the list', '// found in the map but not in the list')
m(d, 'dialog: a control that is out of the list is not moved', 'if (!control.m_bOutofList) control.onFrameMove(fTime, fElapsedTime);', 'control.onFrameMove(fTime, fElapsedTime);')
m(d, 'dialog: a control is moved', 'if (!control.m_bOutofList) control.onFrameMove(fTime, fElapsedTime);', 'if (control.m_bOutofList) control.onFrameMove(fTime, fElapsedTime);')
m(d, 'dialog: the drag range needs the drag', 'if (this.m_bEnableMoveByDrag && this.m_bEnableDraggingRange) {', 'if (this.m_bEnableDraggingRange) {')
m(d, 'dialog: the drag range needs the range', 'if (this.m_bEnableMoveByDrag && this.m_bEnableDraggingRange) {', 'if (this.m_bEnableMoveByDrag) {')
m(d, 'dialog: half the range x', 'const halfRangeX = f(this.m_vDraggingRange.x * 0.5)', 'const halfRangeX = f(this.m_vDraggingRange.x)')
m(d, 'dialog: half the range y', 'halfRangeY = f(this.m_vDraggingRange.y * 0.5);', 'halfRangeY = f(this.m_vDraggingRange.x * 0.5);')
m(d, 'dialog: half the size x', 'const halfSizeX = f(this.m_vSize.x * 0.5)', 'const halfSizeX = f(this.m_vSize.x)')
m(d, 'dialog: half the size y', 'halfSizeY = f(this.m_vSize.y * 0.5);', 'halfSizeY = f(this.m_vSize.x * 0.5);')
m(d, 'dialog: the range\'s centre', 'const cx = this.m_vDraggingRangeCenter.x, cy = this.m_vDraggingRangeCenter.y;', 'const cx = this.m_vDraggingRangeCenter.y, cy = this.m_vDraggingRangeCenter.x;')
m(d, 'dialog: the least x', 'const minX = f(f(cx - halfRangeX) - halfSizeX)', 'const minX = f(f(cx - halfRangeX) + halfSizeX)')
m(d, 'dialog: the greatest x', 'maxX = f(f(cx + halfRangeX) - halfSizeX);', 'maxX = f(f(cx + halfRangeX) + halfSizeX);')
m(d, 'dialog: the least y', 'const minY = f(f(cy - halfRangeY) - halfSizeY)', 'const minY = f(f(cy - halfRangeY) + halfSizeY)')
m(d, 'dialog: the greatest y', 'maxY = f(f(cy + halfRangeY) - halfSizeY);', 'maxY = f(f(cy + halfRangeY) + halfSizeY);')
m(d, 'dialog: held above the least x', 'if (minX > p.x) p.x = minX;', 'if (minX < p.x) p.x = minX;')
m(d, 'dialog: held below the greatest x', 'if (p.x > maxX) p.x = maxX;', 'if (p.x < maxX) p.x = maxX;')
m(d, 'dialog: held above the least y', 'if (minY > p.y) p.y = minY;', 'if (minY < p.y) p.y = minY;')
m(d, 'dialog: held below the greatest y', 'if (p.y > maxY) p.y = maxY;', 'if (p.y < maxY) p.y = maxY;')
m(d, 'dialog: the goal follows while moving', 'if (!(this.m_fChangeTime <= this.m_fAnimateTime)) this.m_GoalPos.set(p.x, p.y);', 'if (this.m_fChangeTime <= this.m_fAnimateTime) this.m_GoalPos.set(p.x, p.y);')
m(d, 'dialog: the goal follows the position', 'this.m_GoalPos.set(p.x, p.y);\n    }\n    return 0;', 'this.m_GoalPos.set(p.y, p.x);\n    }\n    return 0;')
m(d, 'dialog: setshow: a change of the flag', 'if (show !== this.m_bShow) {\n      this.m_bShow = show;', 'if (true) {\n      this.m_bShow = show;')
m(d, 'dialog: setshow: the flag is stored', 'this.m_bShow = show;\n      if (show) throw', 'if (show) throw')
m(d, 'dialog: setshow: showing needs the mouse', 'if (show) throw new Error("CKTDGUIDialog::SetShow(true)', 'if (!show) throw new Error("CKTDGUIDialog::SetShow(true)')
m(d, 'dialog: setshow: hiding hides the guide dialog', 'this.m_pDialogGuideDesc?.setShow(false);\n      if (!this.m_bModal', 'if (!this.m_bModal')
m(d, 'dialog: setshow: the modal count is made again for a dialog that is not modal', 'if (!this.m_bModal && this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.countModalDialog(null);\n    }\n    if (CKTDGUISlot', 'if (this.m_bModal && this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.countModalDialog(null);\n    }\n    if (CKTDGUISlot')
m(d, 'dialog: setshow: a hidden dialog returns its dragged slot', 'CKTDGUISlot.s_pDragSlot.m_pDialog === this && !show) CKTDGUISlot.returnDraggingItem();', 'CKTDGUISlot.s_pDragSlot.m_pDialog === this && show) CKTDGUISlot.returnDraggingItem();')
m(d, 'dialog: setshow: the slot is the dialog\'s', 'CKTDGUISlot.s_pDragSlot.m_pDialog === this && !show)', 'CKTDGUISlot.s_pDragSlot.m_pDialog !== this && !show)')

# ---- dialogmanager.ts -------------------------------------------------------------------------------------------------------------------
dm = 'dialogmanager.ts'
m(dm, 'manager: hidden: it can hide', 'return this.m_bCanHide && !this.m_bShow;', 'return this.m_bCanHide || !this.m_bShow;')
m(dm, 'manager: hidden: it is not shown', 'return this.m_bCanHide && !this.m_bShow;', 'return this.m_bCanHide && this.m_bShow;')
m(dm, 'manager: CheckDlg needs a dialog', 'return dialog !== null && this.m_setDialog.has(dialog) && dialog.m_pkUIDialogManager !== null;', 'return this.m_setDialog.has(dialog!) && dialog!.m_pkUIDialogManager !== null;', 'a Set never holds null: has(null) is false, as the exe\'s search of the set for a null dialog finds nothing')
m(dm, 'manager: CheckDlg needs the dialog in the set', 'return dialog !== null && this.m_setDialog.has(dialog) && dialog.m_pkUIDialogManager !== null;', 'return dialog !== null && dialog.m_pkUIDialogManager !== null;')
m(dm, 'manager: CheckDlg needs a manager', 'return dialog !== null && this.m_setDialog.has(dialog) && dialog.m_pkUIDialogManager !== null;', 'return dialog !== null && this.m_setDialog.has(dialog);')
m(dm, 'manager: CheckFrontModalDlg checks the pivot', 'if (!this.checkDlg(pivot)) return false;', '')
m(dm, 'manager: the list is walked from the front', 'for (let i = this.m_listDialog.length - 1; i >= 0; i--) {', 'for (let i = 0; i < this.m_listDialog.length; i++) {')
m(dm, 'manager: the pivot ends the walk', 'if (dialog === pivot) return false;', '')
m(dm, 'manager: a dialog in front must be shown', 'if (dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal) return true;', 'if (dialog.m_bEnable && !dialog.m_bModal) return true;')
m(dm, 'manager: a dialog in front must be enabled', 'if (dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal) return true;', 'if (dialog.m_bShow && !dialog.m_bModal) return true;')
m(dm, 'manager: a dialog in front must not be modal', 'if (dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal) return true;', 'if (dialog.m_bShow && dialog.m_bEnable) return true;')
m(dm, 'manager: a dialog in front must not be modal (the other way)', 'if (dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal) return true;', 'if (dialog.m_bShow && dialog.m_bEnable && dialog.m_bModal) return true;')
m(dm, 'manager: a modal dialog does not count', 'const counts = (d: CKTDGUIDialog): boolean => !d.m_bModal && d.m_bShow && !d.m_bHasSlot;', 'const counts = (d: CKTDGUIDialog): boolean => d.m_bShow && !d.m_bHasSlot;')
m(dm, 'manager: a hidden dialog does not count', 'const counts = (d: CKTDGUIDialog): boolean => !d.m_bModal && d.m_bShow && !d.m_bHasSlot;', 'const counts = (d: CKTDGUIDialog): boolean => !d.m_bModal && !d.m_bHasSlot;')
m(dm, 'manager: a dialog with a slot does not count', 'const counts = (d: CKTDGUIDialog): boolean => !d.m_bModal && d.m_bShow && !d.m_bHasSlot;', 'const counts = (d: CKTDGUIDialog): boolean => !d.m_bModal && d.m_bShow;')
m(dm, 'manager: one dialog counts one', 'if (counts(dialog)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 1) | 0;\n      return;', 'if (counts(dialog)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 2) | 0;\n      return;')
m(dm, 'manager: one dialog is added to the count', 'if (counts(dialog)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 1) | 0;\n      return;', 'if (counts(dialog)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 1) | 0;')
m(dm, 'manager: a dialog that is counted returns', 'if (counts(dialog)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 1) | 0;\n      return;', 'if (counts(dialog)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 1) | 0;\n      return;'.replace('return;', ''))
m(dm, 'manager: the count is made again from 0', 'this.m_iModalDialogCount = 0;\n    for (const d of this.m_listDialog)', 'for (const d of this.m_listDialog)')
m(dm, 'manager: the count is made again over the list', 'for (const d of this.m_listDialog) if (counts(d)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 1) | 0;', '')

# ---- input.ts ---------------------------------------------------------------------------------------------------------------------------
m('input.ts', 'keyboard: a key that is up answers 0', 'if (this.m_State[n]! >= 0 || this.m_Locks[n] !== 0) return 0;', 'if (this.m_State[n]! > 0 || this.m_Locks[n] !== 0) return 0;')
m('input.ts', 'keyboard: a locked key answers 0', 'if (this.m_State[n]! >= 0 || this.m_Locks[n] !== 0) return 0;', 'if (this.m_State[n]! >= 0) return 0;')
m('input.ts', 'keyboard: a key that goes down is locked', 'this.m_Locks[n] = 1;\n    return 1;', 'return 1;')
m('input.ts', 'keyboard: a key that goes down answers 1', 'this.m_Locks[n] = 1;\n    return 1;', 'this.m_Locks[n] = 1;\n    return 0;')
m('input.ts', 'keyboard: a key that is up is unlocked', 'if (this.m_State[i]! >= 0) this.m_Locks[i] = 0;', 'if (this.m_State[i]! > 0) this.m_Locks[i] = 0;')
m('input.ts', 'keyboard: a key that is down stays locked', 'if (this.m_State[i]! >= 0) this.m_Locks[i] = 0;', 'this.m_Locks[i] = 0;')


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (8 * 2**30, 8 * 2**30))


def main():
    args = sys.argv[1:]
    if '--list' in args:
        for f, name, a, b, why in M:
            print(f'{f:18s} {name}' + (f'   [survives: {why}]' if why else ''))
        print(f'{len(M)} mutants')
        return 0
    pick = [a for a in args if not a.startswith('--')]
    sources = {}
    problems = 0
    for f, name, a, b, why in M:
        path = os.path.join(ROOT, SRC, f)
        if path not in sources:
            sources[path] = open(path).read()
        n = sources[path].count(a)
        if n != 1:
            problems += 1
            print(f'anchor found {n} times (must be once): {f}: {name}')
        if a == b:
            problems += 1
            print(f'the mutant is the original: {f}: {name}')
    if problems:
        return 2
    if '--check' in args:
        print(f'{len(M)} mutants, every anchor is in its file exactly once')
        return 0
    bad = survived = run = 0
    try:
        for f, name, a, b, why in M:
            if pick and not any(p in name for p in pick):
                continue
            path = os.path.join(ROOT, SRC, f)
            orig = sources[path]
            open(path, 'w').write(orig.replace(a, b, 1))
            try:
                r = subprocess.run([BUN, 'test', TEST], cwd=ROOT, capture_output=True, text=True, timeout=90, preexec_fn=limits)
                killed = r.returncode != 0
            except subprocess.TimeoutExpired:
                killed = True
            finally:
                open(path, 'w').write(orig)
            run += 1
            if killed:
                print(f'killed    {name}', flush=True)
            else:
                survived += 1
                if why:
                    print(f'SURVIVED  {name}   (expected: {why})', flush=True)
                else:
                    bad += 1
                    print(f'SURVIVED  {name}   <-- not expected', flush=True)
    finally:
        for path, orig in sources.items():
            open(path, 'w').write(orig)
    print(f'{run} mutants: {run - survived} killed, {survived} survived ({survived - bad} expected, {bad} not)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
