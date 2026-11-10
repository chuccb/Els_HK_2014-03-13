#!/usr/bin/env python3
"""Mutation check of the UI classes added with the dialog census (Navigation, CMovieData, Slider, ControlList, EditBox,
CX2MapSelectWindow, ChangeSequence*, IntPairMap, ftoi, the render target devices, ScrollBar.destroy): apply one small change at a time to a
source file of packages/ui/src, run packages/ui/test/widgets.test.ts (for the slider's mutants then also bars-input.test.ts, the oracle's scenes of its
input: its mouse-up message sits in the code the input unit added) and report whether a test notices (killed) or not (SURVIVED).

    python3 tools/mutate-ui.py [--list] [substring of a mutant name ...]

A mutant that must be killed and survives makes the exit code 1; a mutant with a reason is expected to survive (it is equivalent to the
original, or only the live game could tell).  The source is restored after every mutant (also on Ctrl-C), but do not run this with
uncommitted edits in the mutated files you cannot afford to lose.  Needs `bun` in ./node_modules/.bin; the run takes ~4 s per mutant.
Each run has a 90 s timeout and an 8 GB address-space limit: a mutant that loops or blows up is killed, too.
"""
import os, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
TEST = os.path.join(ROOT, 'packages/ui/test/widgets.test.ts')
# the tests that run after widgets.test.ts for the mutants of a file that kills nothing there
EXTRA = {'slider.ts': [os.path.join(ROOT, 'packages/ui/test/bars-input.test.ts')]}
SRC = 'packages/ui/src/'

# (file, name, original text, mutated text, why it may survive ('' = must be killed))
M = [
 # ---- slider.ts
 ('slider.ts', 'slider: value below the minimum', r'if (this.m_nMin > v) v = this.m_nMin;', r'if (false) v = this.m_nMin;', ''),
 ('slider.ts', 'slider: value above the maximum', r'if (this.m_nMax < v) v = this.m_nMax;', r'if (this.m_nMax < v) v = this.m_nMin;', ''),
 ('slider.ts', 'slider: an unchanged value is silent', r'if (v === this.m_nValue) return;', r'if (false) return;', ''),
 ('slider.ts', 'slider: control event argument (mouse up)', r'if (this.m_CustomMsgValueChanged === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 0);', r'if (this.m_CustomMsgValueChanged === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 1);', ''),
 ('slider.ts', 'slider: control event argument (set value)', r'if (custom === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 0);', r'if (custom === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 1);', ''),
 ('slider.ts', 'slider: custom message argument', r'else this.sendInternelEvent(UIM.CUSTOM_MSG, custom);', r'else this.sendInternelEvent(UIM.CUSTOM_MSG, 0);', ''),
 ('slider.ts', 'slider: width or height missing', r'if (this.m_width === 0 || this.m_height === 0) return;', r'if (this.m_width === 0 && this.m_height === 0) return;', ''),
 ('slider.ts', 'slider: default button height', r'if (this.m_iButtonHeight === 0) this.m_iButtonHeight = this.m_height;', r'if (this.m_iButtonHeight === 0) this.m_iButtonHeight = this.m_width;', ''),
 ('slider.ts', 'slider: default button width', r'if (this.m_iButtonWidth === 0) this.m_iButtonWidth = this.m_height;', r'if (this.m_iButtonWidth === 0) this.m_iButtonWidth = this.m_width;', ''),
 ('slider.ts', 'slider: vertical centring truncates toward zero', r'idiv((this.m_height - this.m_iButtonHeight) | 0, 2)', r'Math.floor((this.m_height - this.m_iButtonHeight) / 2)', ''),
 ('slider.ts', 'slider: pixel is cut by cvttss2si', r'this.m_nButtonX = ftoi(along);', r'this.m_nButtonX = Math.round(along) | 0;', ''),
 ('slider.ts', 'slider: button centred on the value', r'(this.m_nButtonX - idiv(this.m_iButtonWidth, 2)) | 0', r'(this.m_nButtonX - this.m_iButtonWidth) | 0', ''),
 ('slider.ts', 'slider: SetRange clamps the value', "this.m_nMax = max | 0;\n    this.setValueInternal(this.m_nValue, false);", r'this.m_nMax = max | 0;', ''),
 ('slider.ts', 'slider: the range starts at min', r'f((this.m_nValue - this.m_nMin) | 0) * f(this.m_width)', r'f(this.m_nValue | 0) * f(this.m_width)', ''),
 ('slider.ts', 'slider: the width scales the position', r'* f(this.m_width)) / f((this.m_nMax - this.m_nMin) | 0)', r'* f(this.m_height)) / f((this.m_nMax - this.m_nMin) | 0)', ''),
 # ---- rect.ts
 ('rect.ts', 'ftoi: 2^31 is out of range', r'x >= 2147483648', r'x > 2147483648',
  'equivalent: for exactly 2^31 the truncation `| 0` gives -2^31 as well'),
 ('rect.ts', 'ftoi: -2^31 - 1 is out of range', r'x <= -2147483649', r'x < -2147483649', ''),
 ('rect.ts', 'ftoi truncates', r'return Math.trunc(x) | 0;', r'return Math.round(x) | 0;', ''),
 # ---- controllist.ts
 ('controllist.ts', 'list: largest column', r'if (c > this.m_iMaxIndexX) this.m_iMaxIndexX = c;', r'if (c < this.m_iMaxIndexX) this.m_iMaxIndexX = c;', ''),
 ('controllist.ts', 'list: largest row', r'if (r > this.m_iMaxIndexY) this.m_iMaxIndexY = r;', r'if (r < this.m_iMaxIndexY) this.m_iMaxIndexY = r;', ''),
 ('controllist.ts', 'list: InsertItem answers false', "this.m_pDialog.AddControl(control);\n    }\n    return false;", "this.m_pDialog.AddControl(control);\n    }\n    return true;", ''),
 ('controllist.ts', 'list: a control without a dialog joins the list\'s', r'if (!control.m_pDialog) {', r'if (control.m_pDialog) {', ''),
 ('controllist.ts', 'list: window left edge', r'this.m_iTopIndexX <= col && col <', r'this.m_iTopIndexX < col && col <', ''),
 ('controllist.ts', 'list: window right edge', r'col < this.m_iTopIndexX + this.m_iViewSizeX', r'col <= this.m_iTopIndexX + this.m_iViewSizeX', ''),
 ('controllist.ts', 'list: window top edge', r'this.m_iTopIndexY <= row && row <', r'this.m_iTopIndexY < row && row <', ''),
 ('controllist.ts', 'list: window bottom edge', r'row < this.m_iTopIndexY + this.m_iViewSizeY', r'row <= this.m_iTopIndexY + this.m_iViewSizeY', ''),
 ('controllist.ts', 'list: out-of-list mark', r'control.m_bOutofList = true;', r'control.m_bOutofList = false;', ''),
 ('controllist.ts', 'list: absolute placement sign', r'f(f(-imul(this.m_iTopIndexX, this.m_iScrollOffsetX)) + this.m_Pos.x)', r'f(f(imul(this.m_iTopIndexX, this.m_iScrollOffsetX)) + this.m_Pos.x)', ''),
 ('controllist.ts', 'list: relative placement row', r'f(f(imul(this.m_iScrollOffsetY, (row - this.m_iTopIndexY) | 0)) + this.m_Pos.y)', r'f(f(imul(this.m_iScrollOffsetY, (row + this.m_iTopIndexY) | 0)) + this.m_Pos.y)', ''),
 ('controllist.ts', 'list: the X index goes to the Y bar (exe bug)', r'this.bar("Y").setTrackPos(this.m_iTopIndexX);', r'x.setTrackPos(this.m_iTopIndexX);', ''),
 ('controllist.ts', 'list: X bar range', r'x.setTrackRange(0, (this.m_iMaxIndexX - this.m_iViewSizeX + 2) | 0);', r'x.setTrackRange(0, (this.m_iMaxIndexX - this.m_iViewSizeX + 1) | 0);', ''),
 ('controllist.ts', 'list: Y bar threshold', r'if (y && this.m_iMaxIndexY >= this.m_iViewSizeY) {', r'if (y && this.m_iMaxIndexY > this.m_iViewSizeY) {', ''),
 ('controllist.ts', 'list: X bar threshold', r'if (x && this.m_iMaxIndexX >= this.m_iViewSizeX) {', r'if (x && this.m_iMaxIndexX > this.m_iViewSizeX) {', ''),
 ('controllist.ts', 'list: setIndex sends only when asked', r'if (sendMessage && this.m_CustomMsgScroll !== -1)', r'if (this.m_CustomMsgScroll !== -1)', ''),
 ('controllist.ts', 'list: setIndex needs a custom message', r'if (sendMessage && this.m_CustomMsgScroll !== -1)', r'if (sendMessage)', ''),
 ('controllist.ts', 'list: the old bar is deleted', r'old?.Destroy();', r'', ''),
 ('controllist.ts', 'list: bounding box right', r'ftoi(f(f(width) + x))', r'ftoi(f(f(width)))', ''),
 ('controllist.ts', 'list: SetScrollOffset times the view', r'this.setBoundingBox(imul(x | 0, this.m_iViewSizeX), imul(y | 0, this.m_iViewSizeY));', r'this.setBoundingBox(imul(x | 0, this.m_iViewSizeY), imul(y | 0, this.m_iViewSizeX));', ''),
 ('controllist.ts', 'list: SetShow cells', r'(row === -1 || row === r) && (col === -1 || col === c)', r'(row === -1 || row === r) || (col === -1 || col === c)', ''),
 ('controllist.ts', 'list: SetXScrollBarPos updates the bar', "const bar = this.bar(\"X\");\n    bar.m_x = x | 0;\n    bar.m_y = y | 0;\n    bar.updateRects();", "const bar = this.bar(\"X\");\n    bar.m_x = x | 0;\n    bar.m_y = y | 0;", ''),
 ('controllist.ts', 'list: SetXScrollBarSize updates the bar', "const bar = this.bar(\"X\");\n    bar.m_width = width | 0;\n    bar.m_height = height | 0;\n    bar.updateRects();", "const bar = this.bar(\"X\");\n    bar.m_width = width | 0;\n    bar.m_height = height | 0;", ''),
 ('controllist.ts', 'list: SetYScrollBarPos updates the bar', "const bar = this.bar(\"Y\");\n    bar.m_x = x | 0;\n    bar.m_y = y | 0;\n    bar.updateRects();", "const bar = this.bar(\"Y\");\n    bar.m_x = x | 0;\n    bar.m_y = y | 0;", ''),
 ('controllist.ts', 'list: SetYScrollBarSize updates the bar', "const bar = this.bar(\"Y\");\n    bar.m_width = width | 0;\n    bar.m_height = height | 0;\n    bar.updateRects();", "const bar = this.bar(\"Y\");\n    bar.m_width = width | 0;\n    bar.m_height = height | 0;", ''),
 ('controllist.ts', 'list: ShowEnable arguments', r'this.bar("X").SetShowEnable(show, enable);', r'this.bar("X").SetShowEnable(enable, show);', ''),
 ('controllist.ts', 'list: the Y thumb texture', r'this.yTex.thumb = this.replaceTexture(this.yTex.thumb, file, key);', r'this.yTex.track = this.replaceTexture(this.yTex.track, file, key);', ''),
 ('controllist.ts', 'list: the bar gets its down button texture', r'bar.setDownButtonTex(tex.downButton);', r'bar.setDownButtonTex(tex.upButton);', ''),
 ('controllist.ts', 'list: the bar joins the list\'s dialog', r'bar.setDialog(this.m_pDialog);', r'', ''),
 # ---- editbox.ts
 ('editbox.ts', 'edit: the normal texture marks the background', "if (this.m_pNormalPoint) this.m_pNormalPoint.pUITextureData = this.m_pNormalTex;\n    this.m_bBGCheck = true;", r'if (this.m_pNormalPoint) this.m_pNormalPoint.pUITextureData = this.m_pNormalTex;', ''),
 ('editbox.ts', 'edit: the normal point follows its texture', r'if (this.m_pNormalPoint) this.m_pNormalPoint.pUITextureData = this.m_pNormalTex;', r'', ''),
 ('editbox.ts', 'edit: the disable point follows its texture', r'if (this.m_pDisablePoint) this.m_pDisablePoint.pUITextureData = this.m_pDisableTex;', r'', ''),
 ('editbox.ts', 'edit: a point is sized from its texture', r'p.applyTextureSize();', r'', ''),
 ('editbox.ts', 'edit: the hide char makes a password box', "this.m_bPasswordEditBox = true;\n    this.m_Buffer.SetHideChar(true, code);", r'this.m_Buffer.SetHideChar(true, code);', ''),
 ('editbox.ts', 'edit: the hide char of an empty string', r'const code = hideChar ? hideChar.charCodeAt(0) : 0;', r'const code = hideChar ? hideChar.charCodeAt(0) : 42;', ''),
 ('editbox.ts', 'edit: the constructor clears s_bHideCaret', r'CKTDGUIEditBox.s_bHideCaret = false;', r'', ''),
 ('editbox.ts', 'edit: text colour default', r'm_TextColor = 0xff101010;', r'm_TextColor = 0xff101011;', ''),
 ('editbox.ts', 'edit: blink factor', r'f(0.0005)', r'f(0.0006)', ''),
 ('editbox.ts', 'edit: the outline colour switches the outline on', "o.a = f(f(Number(BigInt.asUintN(64, packed >> 24n))) * ONE_OVER_255);\n    this.m_bOutlineCheck = true;", r'o.a = f(f(Number(BigInt.asUintN(64, packed >> 24n))) * ONE_OVER_255);', ''),
 ('editbox.ts', 'edit: the font comes from the mapped fonts', r'this.m_pFont = this.ctx.fonts.getMappedUKFont(nFontIndex);', r'this.m_pFont = this.ctx.fonts.getUKFont(nFontIndex);', ''),
 ('editbox.ts', 'edit: the selection background colour', r'this.m_SelBkColor = d3dColor(r, g, b, a);', r'this.m_SelTextColor = d3dColor(r, g, b, a);', ''),
 ('editbox.ts', 'edit: the enter message', r'this.m_CustomMsgEditBoxEnter = msg | 0;', r'this.m_CustomMsgEditBoxChange = msg | 0;', ''),
 ('editbox.ts', 'edit: the key sound', r'this.openControlSounds(["EditBox_KeyDown"])', r'this.openControlSounds(["EditBox_KeyUp"])', ''),
 # ---- d3dcolor.ts
 ('d3dcolor.ts', 'colour: channels are cut, not rounded', r'BigInt(Math.trunc(v))', r'BigInt(Math.round(v))', ''),
 ('d3dcolor.ts', 'colour: the red channel', r'| byte(channel(r))', r'| byte(channel(g))', ''),
 ('d3dcolor.ts', 'colour: the alpha channel', r'const A = channel(a);', r'const A = channel(r);', ''),
 # ---- navigation.ts
 ('navigation.ts', 'nav: the window point draws the background (exe bug)', r'this.m_pWindowPoint = this.makePoint(this.m_pBGTex);', r'this.m_pWindowPoint = this.makePoint(this.m_pWindowTex);', ''),
 ('navigation.ts', 'nav: the background point follows its texture', r'if (this.m_pBGPoint) this.m_pBGPoint.pUITextureData = this.m_pBGTex;', r'', ''),
 ('navigation.ts', 'nav: the window point follows its texture', r'if (this.m_pWindowPoint) this.m_pWindowPoint.pUITextureData = this.m_pWindowTex;', r'', ''),
 ('navigation.ts', 'nav: the sound', r'this.openControlSounds(["Button_Mouse_Up"])', r'this.openControlSounds(["Button_Mouse_Down"])', ''),
 ('navigation.ts', 'nav: the drag message', r'this.m_CustomMsgMouseDragging = msg | 0;', r'this.m_CustomMsgLButtonDown = msg | 0;', ''),
 # ---- movie.ts
 ('movie.ts', 'movie: the verification key', r'"1b9b533c"', r'"1b9b533d"', ''),
 ('movie.ts', 'movie: a file that does not open', r'if (bvl.open(this.m_wstrMovieFileName, 0) < 0) return;', r'if (bvl.open(this.m_wstrMovieFileName, 0) <= 0) return;', ''),
 ('movie.ts', 'movie: the video texture is made once', "if (this.m_pBvt) this.m_pBvt.close();\n    else this.m_pBvt = devices.createVideoTexture(this.ctx.render);", r'this.m_pBvt = devices.createVideoTexture(this.ctx.render);', ''),
 ('movie.ts', 'movie: the render target size is cut', r'Math.trunc(width), Math.trunc(height)', r'Math.round(width), Math.round(height)', ''),
 ('movie.ts', 'movie: the render target id', r'openRenderTargetTexture("MoveData"', r'openRenderTargetTexture("MovieData"', ''),
 ('movie.ts', 'movie: the player is closed before it opens', "    bvl.close();\n    if (bvl.open", "    if (bvl.open", ''),
 ('movie.ts', 'movie: the library is created once', r'if (!bvl.isCreated()) bvl.create("bdvid32.dll");', r'bvl.create("bdvid32.dll");', ''),
 ('movie.ts', 'movie: SetLoop writes the loop flag', "SetLoop(loop: boolean): void {\n    this.m_bLoop = loop;", "SetLoop(loop: boolean): void {\n    this.m_bShow = loop;", ''),
 ('movie.ts', 'movie: the video starts playing', "this.m_pBvt.open(this.m_Info.width, this.m_Info.height);\n    bvl.play();", r'this.m_pBvt.open(this.m_Info.width, this.m_Info.height);', ''),
 # ---- mapselect.ts
 ('mapselect.ts', 'map: a new map goes in front of the first old one', r'list.splice(firstOld, 0, info);', r'list.splice(firstOld + 1, 0, info);', ''),
 ('mapselect.ts', 'map: the first old one', r'list.findIndex((e) => !e.m_bNew)', r'list.findIndex((e) => e.m_bNew)', ''),
 ('mapselect.ts', 'map: OpenScript empties the list', r'this.m_vecpMapInfo.length = 0;', r'', ''),
 ('mapselect.ts', 'map: error 0x2793', r'log.push(0x2793, fileName);', r'log.push(0x2794, fileName);', ''),
 ('mapselect.ts', 'map: a Lua error is 0x49', r'log.push(0x49, fileName);', r'log.push(0x48, fileName);', ''),
 ('mapselect.ts', 'map: no name is the empty string', r'm.getInt("m_MapName") ?? -1', r'm.getInt("m_MapName") ?? 0', ''),
 ('mapselect.ts', 'map: the global', r'setObject("g_pMapSelectWindow", this,', r'setObject("g_pMapSelectWindow2", this,', ''),
 ('mapselect.ts', 'map: the hot flag', r'm_bHot: m.getBool("m_bHot") ?? false,', r'm_bHot: m.getBool("m_bNew") ?? false,', ''),
 # ---- dialog.ts
 ('dialog.ts', 'dialog: ChangeSequence front is the end', "if (front) this.m_ControlsList.push(control);\n    else this.m_ControlsList.unshift(control);", "if (front) this.m_ControlsList.unshift(control);\n    else this.m_ControlsList.push(control);", ''),
 ('dialog.ts', 'dialog: behind or in front of the pivot', r'list.splice(front ? p + 1 : p, 0, control);', r'list.splice(front ? p : p + 1, 0, control);', ''),
 ('dialog.ts', 'dialog: the control is looked up before the pivot', "const control = this.getControl(name);\n    const pivot = this.getControl(pivotName);", "const pivot = this.getControl(pivotName);\n    const control = this.getControl(name);", ''),
 ('dialog.ts', 'dialog: the pivot must be in the list', r'if (!pivot || !list.includes(pivot)) return;', r'if (!pivot) return;', ''),
 ('dialog.ts', 'dialog: the control must be in the list', r'if (!control || list.length <= 0 || !list.includes(control)) return;', r'if (!control || list.length <= 0) return;',
  'equivalent: the loop below finds nothing to move for a control that is not in the list (the exe tests it first)'),
 # ---- stdmap.ts
 ('stdmap.ts', 'IntPairMap: order of the second key', r'(c.first === first && c.second < second)', r'(c.first === first && c.second > second)', ''),
 ('stdmap.ts', 'IntPairMap: order of the first key', r'if (c.first < first || (c.first === first', r'if (c.first > first || (c.first === first', ''),
 ('stdmap.ts', 'IntPairMap: get compares both keys', r'return c && c.first === first && c.second === second ? c.value : undefined;', r'return c && c.first === first ? c.value : undefined;', ''),
 ('stdmap.ts', 'IntPairMap: getOrInsert compares both keys', "if (c && c.first === first && c.second === second) return c.value;\n    const value = make();", "if (c && c.first === first) return c.value;\n    const value = make();", ''),
 # ---- device.ts
 ('device.ts', 'device: no id, no render target', "if (deviceID.length === 0) return undefined;\n    const id = towupperAscii(deviceID);\n    let target", "const id = towupperAscii(deviceID);\n    let target", ''),
 ('device.ts', 'device: an open render target is referenced again', "target.refCount++;\n      return target;", "return target;", ''),
 ('device.ts', 'device: CloseDevice deletes a render target at zero', r'if (--target.refCount <= 0) {', r'if (--target.refCount <= 1) {', ''),
 ('device.ts', 'device: render target ids are upper case', "const id = towupperAscii(deviceID);\n    let target = this.renderTargets.get(id);", "const id = deviceID;\n    let target = this.renderTargets.get(id);", ''),
 # ---- scrollbar.ts
 ('scrollbar.ts', 'scrollbar: the destructor closes the sound', "this.m_pSndMouseDown = this.closeHeldDevice(this.m_pSndMouseDown);", "this.m_pSndMouseDown = undefined;", ''),
]


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (8 * 2**30, 8 * 2**30))


def main():
    args = sys.argv[1:]
    if '--list' in args:
        for f, name, a, b, why in M:
            print(f'{f:16s} {name}' + (f'   [survives: {why}]' if why else ''))
        return 0
    pick = [a for a in args if not a.startswith('--')]
    sources = {}
    for f, name, a, b, why in M:
        path = os.path.join(ROOT, SRC, f)
        if path not in sources:
            sources[path] = open(path).read()
        assert sources[path].count(a) == 1, f'anchor not found exactly once: {f}: {name}'
    bad = survived = run = 0
    try:
        for f, name, a, b, why in M:
            if pick and not any(p in name for p in pick):
                continue
            path = os.path.join(ROOT, SRC, f)
            orig = sources[path]
            open(path, 'w').write(orig.replace(a, b, 1))
            killed = False
            try:
                for test in [TEST] + EXTRA.get(f, []):
                    r = subprocess.run([BUN, 'test', test], cwd=ROOT, capture_output=True, text=True, timeout=90, preexec_fn=limits)
                    if r.returncode != 0:
                        killed = True
                        break
            except subprocess.TimeoutExpired:
                killed = True
            finally:
                open(path, 'w').write(orig)
            run += 1
            if killed:
                print(f'killed    {name}')
            else:
                survived += 1
                if why:
                    print(f'SURVIVED  {name}   (expected: {why})')
                else:
                    bad += 1
                    print(f'SURVIVED  {name}   <-- not expected')
    finally:
        for path, orig in sources.items():
            open(path, 'w').write(orig)
    print(f'{run} mutants: {run - survived} killed, {survived} survived ({survived - bad} expected, {bad} not)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
