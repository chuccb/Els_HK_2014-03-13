#!/usr/bin/env python3
"""Mutation check of the UI drawing classes (CKTDXDeviceTexture::Draw, the edges of the static / button / radio button, the
OnFrameRender of the radio button, check box, slider, navigation, control list and scroll bar, the strings the static, button and
radio button draw: stringdraw.ts, and the combo box: combobox.ts, OnFrameRender and OnFrameRenderEnd): apply one small change at a
time to a source file of packages/ui/src, run packages/ui/test/controldraw.test.ts, render.test.ts, stringdraw.test.ts and
comboboxdraw.test.ts and report whether a test notices (killed) or not (SURVIVED).  The last mutants are of the CPU reference of the GPU test (packages/ui/test-gpu/reference.ts: corners, culling, alpha
test), which packages/ui/test/reference.test.ts must pin.

    python3 tools/mutate-draw.py [--list] [substring of a mutant name ...]

A mutant that must be killed and survives makes the exit code 1; a mutant with a reason is expected to survive.  The source is restored
after every mutant (also on Ctrl-C), but do not run this with uncommitted edits in the mutated files you cannot afford to lose.  Needs
`bun` in ./node_modules/.bin; the run takes ~2-4 s per mutant (380 mutants: ~23 minutes).  Each run has a 90 s timeout and an 8 GB address-space limit.
"""
import os, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
TESTS = [os.path.join(ROOT, 'packages/ui/test/controldraw.test.ts'), os.path.join(ROOT, 'packages/ui/test/render.test.ts'), os.path.join(ROOT, 'packages/ui/test/stringdraw.test.ts'), os.path.join(ROOT, 'packages/ui/test/comboboxdraw.test.ts')]
SRC = 'packages/ui/src/'
REFERENCE = 'packages/ui/test-gpu/reference.ts'
REFERENCE_TESTS = [os.path.join(ROOT, 'packages/ui/test/reference.test.ts')]


def path_of(f):
    return os.path.join(ROOT, f if f.startswith('packages/') else SRC + f)


def tests_of(f):
    return REFERENCE_TESTS if f == REFERENCE else TESTS

# (file, name, original text, mutated text, why it may survive ('' = must be killed))
M = [
 # ---- device.ts: CKTDXDeviceTexture::Draw
 ('device.ts', 'draw: the states are set for good, not pushed', r'states.apply(RSI_DEVICE_TEXTURE);', r'states.set(RSI_DEVICE_TEXTURE);', ''),
 ('device.ts', 'draw: the states are not popped', "states.popTo(top);\n  }\n}\n\n/** where the device objects", "}\n}\n\n/** where the device objects", ''),
 ('device.ts', 'draw: left has no half pixel off', r'const left = f(x - 0.5);', r'const left = x;', ''),
 ('device.ts', 'draw: top has no half pixel off', r'const upper = f(y - 0.5);', r'const upper = y;', ''),
 ('device.ts', 'draw: right is counted from the left side', r'const right = f(f(f(nWidth) * sx) + x);', r'const right = f(f(f(nWidth) * sx) + left);', ''),
 ('device.ts', 'draw: bottom is counted from the top side', r'const lower = f(f(f(nHeight) * sy) + y);', r'const lower = f(f(f(nHeight) * sy) + upper);', ''),
 ('device.ts', 'draw: x is cut to whole pixels', r'const x = f(sx * f(nX));', r'const x = Math.trunc(f(sx * f(nX)));', ''),
 ('device.ts', 'draw: y is cut to whole pixels', r'const y = f(sy * f(nY));', r'const y = Math.trunc(f(sy * f(nY)));', ''),
 ('device.ts', 'draw: left-bottom v', r'[left, lower, 0, 1],', r'[left, lower, 0, 0],', ''),
 ('device.ts', 'draw: right-top u', r'[right, upper, 1, 0],', r'[right, upper, 0, 0],', ''),
 ('device.ts', 'draw: z', r'v.setZ(i, 1);', r'v.setZ(i, 0);', ''),
 ('device.ts', 'draw: rhw', r'v.setRhw(i, 1);', r'v.setRhw(i, 0);', ''),
 ('device.ts', 'draw: a rotation is not refused', r'if (rotateDegree !== 0) throw', r'if (false) throw', ''),
 ('device.ts', 'draw: the texture goes to stage 1', "this.setDeviceTexture(render, 0);\n    render.dvb.drawPrimitive", "this.setDeviceTexture(render, 1);\n    render.dvb.drawPrimitive", ''),
 # ---- control.ts: the four bars
 ('control.ts', 'edge: the alpha is the edge colour\'s green', r'clampedByte(f(f(dc.a * edgeColor.a) * cc.a))', r'clampedByte(f(f(dc.a * edgeColor.g) * cc.a))', ''),
 ('control.ts', 'edge: the red ignores the dialog', r'clampedByte(f(f(dc.r * edgeColor.r) * cc.r))', r'clampedByte(f(edgeColor.r * cc.r))', ''),
 ('control.ts', 'edge: the green ignores the control', r'clampedByte(f(f(dc.g * edgeColor.g) * cc.g))', r'clampedByte(f(dc.g * edgeColor.g))', ''),
 ('control.ts', 'edge: the blue ignores the edge colour', r'clampedByte(f(f(dc.b * edgeColor.b) * cc.b))', r'clampedByte(f(dc.b * cc.b))', ''),
 ('control.ts', 'edge: the offset is not added', r'f(f(dialog.m_Pos.x + this.m_OffsetPos.x) + corner)', r'f(dialog.m_Pos.x + corner)', ''),
 ('control.ts', 'edge: the Y offset is not added', r'f(f(dialog.m_Pos.y + this.m_OffsetPos.y) + corner)', r'f(dialog.m_Pos.y + corner)', ''),
 ('control.ts', 'edge out: the left bar starts at the quad', 'texture.draw(render, ftoi(f(x(lt.x) - w)), ftoi(f(y(lt.y) - w)), w, (w + nHeight) | 0, argb, 0);', 'texture.draw(render, ftoi(x(lt.x)), ftoi(f(y(lt.y) - w)), w, (w + nHeight) | 0, argb, 0);', ''),
 ('control.ts', 'edge out: the bottom bar is at the top', 'texture.draw(render, ftoi(f(x(lt.x) - w)), ftoi(y(lb.y)), (w + nWidth) | 0, w, argb, 0);', 'texture.draw(render, ftoi(f(x(lt.x) - w)), ftoi(y(lt.y)), (w + nWidth) | 0, w, argb, 0);', ''),
 ('control.ts', 'edge out: the right bar is at the left', 'texture.draw(render, ftoi(x(rt.x)), ftoi(y(lt.y)), w, (w + nHeight) | 0, argb, 0);', 'texture.draw(render, ftoi(x(lt.x)), ftoi(y(lt.y)), w, (w + nHeight) | 0, argb, 0);', ''),
 ('control.ts', 'edge out: the top bar is as wide as the quad', 'texture.draw(render, ftoi(x(lt.x)), ftoi(f(y(lt.y) - w)), (w + nWidth) | 0, w, argb, 0);', 'texture.draw(render, ftoi(x(lt.x)), ftoi(f(y(lt.y) - w)), nWidth, w, argb, 0);', ''),
 ('control.ts', 'edge out: the corner is rounded, not cut', 'ftoi(f(y(lt.y) - w)), w, (w + nHeight) | 0, argb, 0);', 'Math.round(f(y(lt.y) - w)), w, (w + nHeight) | 0, argb, 0);', ''),
 ('control.ts', 'edge in: the left bar is as high as the quad', 'texture.draw(render, ftoi(x(lt.x)), ftoi(y(lt.y)), w, nHeight, argb, 0);', 'texture.draw(render, ftoi(x(lt.x)), ftoi(y(lt.y)), w, w, argb, 0);', ''),
 ('control.ts', 'edge in: the bottom bar is not moved up by its width', 'texture.draw(render, ftoi(x(lt.x)), ftoi(f(y(lb.y) - w)), nWidth, w, argb, 0);', 'texture.draw(render, ftoi(x(lt.x)), ftoi(y(lb.y)), nWidth, w, argb, 0);', ''),
 ('control.ts', 'edge in: the right bar is not moved left by its width', 'texture.draw(render, ftoi(f(x(rt.x) - w)), ftoi(y(lt.y)), w, nHeight, argb, 0);', 'texture.draw(render, ftoi(x(rt.x)), ftoi(y(lt.y)), w, nHeight, argb, 0);', ''),
 ('control.ts', 'edge in: the top bar is as wide as the quad', 'texture.draw(render, ftoi(x(lt.x)), ftoi(y(lt.y)), nWidth, w, argb, 0);', 'texture.draw(render, ftoi(x(lt.x)), ftoi(y(lt.y)), nWidth, nHeight, argb, 0);', ''),
 # ---- static.ts
 ('static.ts', 'static: no edge before the picture', "if (picture.m_EdgeWidth !== 0) this.drawEdge(picture.m_bDrawEdgeOut, picture.m_EdgeWidth, picture.m_EdgeColor, point);\n      this.updateVertex(this.m_Vertex, point);", "this.updateVertex(this.m_Vertex, point);", ''),
 ('static.ts', 'static: no edge after the picture', "render?.states.popTo(top);\n      if (picture.m_EdgeWidth !== 0) this.drawEdge(picture.m_bDrawEdgeOut, picture.m_EdgeWidth, picture.m_EdgeColor, point);", "render?.states.popTo(top);", ''),
 ('static.ts', 'static: the edge is always drawn outside', "this.drawEdge(picture.m_bDrawEdgeOut, picture.m_EdgeWidth, picture.m_EdgeColor, point);\n      this.updateVertex", "this.drawEdge(true, picture.m_EdgeWidth, picture.m_EdgeColor, point);\n      this.updateVertex", ''),
 ('static.ts', 'static: the width is the right-bottom corner\'s', r'const nWidth = ftoi(f(point.rightTopPoint.x - point.leftTopPoint.x));', r'const nWidth = ftoi(f(point.rightBottomPoint.x - point.leftTopPoint.x));', ''),
 ('static.ts', 'static: the height is the right-top corner\'s', r'const nHeight = ftoi(f(point.rightBottomPoint.y - point.leftTopPoint.y));', r'const nHeight = ftoi(f(point.rightTopPoint.y - point.leftTopPoint.y));', ''),
 ('static.ts', 'static: a width of 0 draws bars', r'if (edgeWidth === 0 || !this.m_pEdgeTexture || !point) return;', r'if (!this.m_pEdgeTexture || !point) return;', ''),
 ('static.ts', 'static: an edge needs its texture', r'if (edgeWidth === 0 || !this.m_pEdgeTexture || !point) return;', r'if (edgeWidth === 0 || !point) return;', ''),
 ('static.ts', 'static: an edge needs a point', r'if (edgeWidth === 0 || !this.m_pEdgeTexture || !point) return;', r'if (edgeWidth === 0 || !this.m_pEdgeTexture) return;', ''),
 # ---- button.ts
 ('button.ts', 'button: the edge needs the focus', r'const edge = this.m_bHasFocus && this.m_EdgeWidth > 0;', r'const edge = this.m_EdgeWidth > 0;', ''),
 ('button.ts', 'button: the edge needs a positive width', r'const edge = this.m_bHasFocus && this.m_EdgeWidth > 0;', r'const edge = this.m_bHasFocus && this.m_EdgeWidth !== 0;', ''),
 ('button.ts', 'button: the edge outside comes after the quad', "if (edge) this.drawEdge(true);\n    this.updateVertex(this.m_Vertex, this.m_NowPoint);", "this.updateVertex(this.m_Vertex, this.m_NowPoint);", ''),
 ('button.ts', 'button: the edge inside comes after the quad', "this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);\n    if (edge) this.drawEdge(false);", "this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);", ''),
 ('button.ts', 'button: the edge inside is drawn outside', "this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);\n    if (edge) this.drawEdge(false);", "this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);\n    if (edge) this.drawEdge(true);", ''),
 ('button.ts', 'button: a width of 0 draws bars', r'if (this.m_EdgeWidth === 0 || !texture || !render) return;', r'if (!texture || !render) return;', ''),
 ('button.ts', 'button: the width is the right-top corner\'s', r'const v45 = ftoi(f(p.rightBottomPoint.x - p.leftTopPoint.x));', r'const v45 = ftoi(f(p.rightTopPoint.x - p.leftTopPoint.x));', ''),
 ('button.ts', 'button: the height is the left-bottom corner\'s', r'const v46 = ftoi(f(p.rightBottomPoint.y - p.leftTopPoint.y));', r'const v46 = ftoi(f(p.leftBottomPoint.y - p.leftTopPoint.y));', ''),
 ('button.ts', 'button: the enlargement is not used', r'const e = this.m_EdgeEnlargeValue | 0;', r'const e = 0;', ''),
 ('button.ts', 'button: the edge colour is the control\'s', r'const dc = dialog.m_Color, cc = this.m_Color, ec = this.m_EdgeColor;', r'const dc = dialog.m_Color, cc = this.m_Color, ec = this.m_Color;', ''),
 ('button.ts', 'button: the outer left bar is not enlarged', 'draw(ftoi(f(x(lt.x) - w)) - e, ftoi(f(y(lt.y) - w)) - e, w, v46 + w + 2 * e);', 'draw(ftoi(f(x(lt.x) - w)), ftoi(f(y(lt.y) - w)) - e, w, v46 + w + 2 * e);', ''),
 ('button.ts', 'button: the inner bottom bar is not enlarged', 'draw(ftoi(x(lt.x)) - e, e + ftoi(f(y(lb.y) - w)), e + v45, w);', 'draw(ftoi(x(lt.x)) - e, ftoi(f(y(lb.y) - w)), e + v45, w);', ''),
 # ---- radiobutton.ts
 ('radiobutton.ts', 'radio: no edge outside', "if (!background) {\n      this.drawCheckedEdge(true);", "if (!background) {", ''),
 ('radiobutton.ts', 'radio: the background shows although it is switched off', r'background = !this.m_bChecked || !this.m_bShowOffBGByCheck;', r'background = true;', ''),
 ('radiobutton.ts', 'radio: the background is switched off although unchecked', r'background = !this.m_bChecked || !this.m_bShowOffBGByCheck;', r'background = !this.m_bShowOffBGByCheck;',
  'equivalent: the exe tests m_bChecked again after DrawCheckedEdge(true), but it is true there (the call cannot change it)'),
 ('radiobutton.ts', 'radio: no edge on the quad', r'if (this.m_bChecked) this.drawCheckedEdge(false);', r'', ''),
 ('radiobutton.ts', 'radio: the check point is always drawn', "if (this.m_bChecked) {\n      const point = this.m_pCheckedPoint;", "if (true) {\n      const point = this.m_pCheckedPoint;", ''),
 ('radiobutton.ts', 'radio: the width is the right-top corner\'s', r'const nWidth = ftoi(f(p.rightBottomPoint.x - p.leftTopPoint.x));', r'const nWidth = ftoi(f(p.rightTopPoint.x - p.leftTopPoint.x));', ''),
 ('radiobutton.ts', 'radio: the height is the right-top corner\'s', r'const nHeight = ftoi(f(p.rightBottomPoint.y - p.leftTopPoint.y));', r'const nHeight = ftoi(f(p.rightTopPoint.y - p.leftTopPoint.y));', ''),
 ('radiobutton.ts', 'radio: a width of 0 draws bars', r'if (this.m_CheckedEdgeWidth === 0 || !texture) return;', r'if (!texture) return;', ''),
 ('radiobutton.ts', 'radio: the edge is of the check point', "const p = this.m_MyNowPoint;\n    const nWidth", "const p = this.m_pCheckedPoint ?? this.m_MyNowPoint;\n    const nWidth", ''),
 # ---- checkbox.ts
 ('checkbox.ts', 'checkbox: the background is empty for either flag', r'if (!(this.m_bEmptyBGWhenChecked && this.m_bChecked)) {', r'if (!(this.m_bEmptyBGWhenChecked || this.m_bChecked)) {', ''),
 ('checkbox.ts', 'checkbox: the check point is always drawn', "if (this.m_bChecked) {\n      const point = this.m_pCheckedPoint;", "if (true) {\n      const point = this.m_pCheckedPoint;", ''),
 ('checkbox.ts', 'checkbox: a hidden box draws', "if (!this.m_bShow) return 0;\n    if (!(this.m_bEmptyBGWhenChecked", "if (!(this.m_bEmptyBGWhenChecked", ''),
 ('checkbox.ts', 'checkbox: the check point is drawn first', "      this.updateVertex(this.m_Vertex, this.m_NowPoint);\n      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);", "      this.updateVertex(this.m_Vertex, this.m_pCheckedPoint ?? this.m_NowPoint);\n      this.renderVertex(this.m_Vertex, this.m_pCheckedPoint ?? this.m_NowPoint, 1);", ''),
 # ---- slider.ts
 ('slider.ts', 'slider: the button is drawn with the background texture', r'[this.m_rcButton, this.m_pButtonTex]', r'[this.m_rcButton, this.m_pBGTex]', ''),
 ('slider.ts', 'slider: the point loses a missing texture', r'if (tex) point.pUITextureData = tex;', r'point.pUITextureData = tex as never;', ''),
 ('slider.ts', 'slider: the right-top corner is the left one', r'point.rightTopPoint.set(rc.right, rc.top);', r'point.rightTopPoint.set(rc.left, rc.top);', ''),
 ('slider.ts', 'slider: the left-bottom corner is the top one', r'point.leftBottomPoint.set(rc.left, rc.bottom);', r'point.leftBottomPoint.set(rc.left, rc.top);', ''),
 ('slider.ts', 'slider: a hidden slider draws', "if (!this.m_bShow) return 0;\n    const point = this.m_TempPoint;", "const point = this.m_TempPoint;", ''),
 # ---- navigation.ts
 ('navigation.ts', 'navigation: the point keeps its own texture', r'point.pUITextureData = tex;', r'', ''),
 ('navigation.ts', 'navigation: a missing texture is drawn', r'if (!tex || !point) continue;', r'if (!point) continue;', ''),
 ('navigation.ts', 'navigation: a hidden control draws', "if (!this.m_bShow) return 0;\n    for (const [tex, point]", "for (const [tex, point]", ''),
 ('navigation.ts', 'navigation: the window is drawn first', r'[[this.m_pBGTex, this.m_pBGPoint], [this.m_pWindowTex, this.m_pWindowPoint]]', r'[[this.m_pWindowTex, this.m_pWindowPoint], [this.m_pBGTex, this.m_pBGPoint]]', ''),
 # ---- controllist.ts
 ('controllist.ts', 'list: the Y bar is drawn first', "this.m_pScrollBarX?.onFrameRender();\n      this.m_pScrollBarY?.onFrameRender();", "this.m_pScrollBarY?.onFrameRender();\n      this.m_pScrollBarX?.onFrameRender();", ''),
 ('controllist.ts', 'list: a hidden list draws its bars', "if (this.m_bShow) {\n      this.m_pScrollBarX?.onFrameRender();", "if (true) {\n      this.m_pScrollBarX?.onFrameRender();", ''),
 # ---- scrollbar.ts
 ('scrollbar.ts', 'bar: the track is drawn although it is off', r'if (this.m_bEnableTrack) draw(', r'if (true) draw(', ''),
 ('scrollbar.ts', 'bar: the thumb is drawn although it is hidden', r'if (this.m_bEnableThumb && this.m_bShowThumb) draw(', r'if (this.m_bEnableThumb) draw(', ''),
 ('scrollbar.ts', 'bar: the thumb is drawn although it is off', r'if (this.m_bEnableThumb && this.m_bShowThumb) draw(', r'if (this.m_bShowThumb) draw(', ''),
 ('scrollbar.ts', 'bar: the up button never shows pressed', r'(this.m_bIsUpButtonClicked && this.m_pUpButtonDownTex) || this.m_pUpButtonTex', r'this.m_pUpButtonTex', ''),
 ('scrollbar.ts', 'bar: the down button never shows pressed', r'(this.m_bIsDownButtonClicked && this.m_pDownButtonDownTex) || this.m_pDownButtonTex', r'this.m_pDownButtonTex', ''),
 ('scrollbar.ts', 'bar: a pressed up button without a texture draws nothing', r'(this.m_bIsUpButtonClicked && this.m_pUpButtonDownTex) || this.m_pUpButtonTex', r'this.m_bIsUpButtonClicked ? this.m_pUpButtonDownTex : this.m_pUpButtonTex', ''),
 ('scrollbar.ts', 'bar: the first repeat comes at 0.33 s inclusive', "if (this.m_Arrow === ARROWSTATE.CLICKED_UP) {\n        if (now - this.m_dArrowTS <= 0.33) return;", "if (this.m_Arrow === ARROWSTATE.CLICKED_UP) {\n        if (now - this.m_dArrowTS < 0.33) return;", ''),
 ('scrollbar.ts', 'bar: the down click waits less', "if (this.m_Arrow === ARROWSTATE.CLICKED_DOWN) {\n        if (now - this.m_dArrowTS <= 0.33) return;", "if (this.m_Arrow === ARROWSTATE.CLICKED_DOWN) {\n        if (now - this.m_dArrowTS <= 0.3) return;", ''),
 ('scrollbar.ts', 'bar: the up repeat is slower', "if (this.m_Arrow !== ARROWSTATE.HELD_UP || now - this.m_dArrowTS <= 0.05) return;", "if (this.m_Arrow !== ARROWSTATE.HELD_UP || now - this.m_dArrowTS <= 0.5) return;", ''),
 ('scrollbar.ts', 'bar: the down repeat is slower', "if (this.m_Arrow !== ARROWSTATE.HELD_DOWN || now - this.m_dArrowTS <= 0.05) return;", "if (this.m_Arrow !== ARROWSTATE.HELD_DOWN || now - this.m_dArrowTS <= 0.5) return;", ''),
 ('scrollbar.ts', 'bar: the up click scrolls down', "this.scroll(-1);\n        this.m_Arrow = ARROWSTATE.HELD_UP;", "this.scroll(1);\n        this.m_Arrow = ARROWSTATE.HELD_UP;", ''),
 ('scrollbar.ts', 'bar: the down click scrolls up', "this.scroll(1);\n        this.m_Arrow = ARROWSTATE.HELD_DOWN;", "this.scroll(-1);\n        this.m_Arrow = ARROWSTATE.HELD_DOWN;", ''),
 ('scrollbar.ts', 'bar: the arrow is not held after the first scroll', "this.scroll(-1);\n        this.m_Arrow = ARROWSTATE.HELD_UP;", "this.scroll(-1);", ''),
 ('scrollbar.ts', 'bar: the time stamp is not kept', r'    this.m_dArrowTS = now;', r'', ''),
 ('scrollbar.ts', 'bar: an arrow repeats without the mouse on a button', "      if (!ptInRect(this.m_rcDownButton, this.m_LastMouse)) return;", "", ''),
 ('rect.ts', 'ptInRect: the right side belongs to the rectangle', r'pt.x >= rc.left && pt.x < rc.right && pt.y >= rc.top && pt.y < rc.bottom', r'pt.x >= rc.left && pt.x <= rc.right && pt.y >= rc.top && pt.y < rc.bottom', ''),
 ('rect.ts', 'ptInRect: the bottom side belongs to the rectangle', r'pt.x >= rc.left && pt.x < rc.right && pt.y >= rc.top && pt.y < rc.bottom', r'pt.x >= rc.left && pt.x < rc.right && pt.y >= rc.top && pt.y <= rc.bottom', ''),
 ('rect.ts', 'ptInRect: the left side is outside', r'pt.x >= rc.left && pt.x < rc.right && pt.y >= rc.top && pt.y < rc.bottom', r'pt.x > rc.left && pt.x < rc.right && pt.y >= rc.top && pt.y < rc.bottom', ''),
 ('rect.ts', 'ptInRect: the top side is outside', r'pt.x >= rc.left && pt.x < rc.right && pt.y >= rc.top && pt.y < rc.bottom', r'pt.x >= rc.left && pt.x < rc.right && pt.y > rc.top && pt.y < rc.bottom', ''),
 # ---- the CPU reference of the GPU test
 (REFERENCE, 'reference: culling drops the wrong winding', r'if ((cull === 2 && area > 0) || (cull === 3 && area < 0)) return;', r'if ((cull === 2 && area < 0) || (cull === 3 && area > 0)) return;', ''),
 (REFERENCE, 'reference: culling is ignored', r'if ((cull === 2 && area > 0) || (cull === 3 && area < 0)) return;', r'', ''),
 (REFERENCE, 'reference: cull mode CW is not culling', r'(cull === 2 && area > 0) ||', r'(false) ||', ''),
 (REFERENCE, 'reference: cull mode CCW is not culling', r'|| (cull === 3 && area < 0)) return;', r'|| (false)) return;', ''),
 (REFERENCE, 'reference: an unknown cull mode is taken', r'if (cull < 1 || cull > 3) throw', r'if (false) throw', ''),
 (REFERENCE, 'reference: the alpha reference is not masked', r'(q.alphaRef ?? 0) & 255', r'(q.alphaRef ?? 0)', ''),
 (REFERENCE, 'reference: the alpha is cut, not rounded', r'Math.round(255 * sa), (q.alphaRef', r'Math.floor(255 * sa), (q.alphaRef', ''),
 (REFERENCE, 'reference: the alpha is rounded up', r'Math.round(255 * sa), (q.alphaRef', r'Math.ceil(255 * sa), (q.alphaRef', ''),
 (REFERENCE, 'reference: the alpha test is ignored', r'if (q.alphaTest && !alphaPasses', r'if (false && !alphaPasses', ''),
 (REFERENCE, 'reference: the alpha test is always on', r'if (q.alphaTest && !alphaPasses', r'if (!alphaPasses', ''),
 (REFERENCE, 'reference: the alpha function defaults to NEVER', r'q.alphaFunc ?? 8', r'q.alphaFunc ?? 1', ''),
 (REFERENCE, 'reference: alpha NOTEQUAL is GREATER', r'case 6: return a !== ref;', r'case 6: return a > ref;', ''),
 (REFERENCE, 'reference: alpha LESS is LESSEQUAL', r'case 2: return a < ref;', r'case 2: return a <= ref;', ''),
 (REFERENCE, 'reference: alpha EQUAL is LESSEQUAL', r'case 3: return a === ref;', r'case 3: return a <= ref;', ''),
 (REFERENCE, 'reference: alpha LESSEQUAL is LESS', r'case 4: return a <= ref;', r'case 4: return a < ref;', ''),
 (REFERENCE, 'reference: alpha GREATER is GREATEREQUAL', r'case 5: return a > ref;', r'case 5: return a >= ref;', ''),
 (REFERENCE, 'reference: alpha GREATEREQUAL is GREATER', r'case 7: return a >= ref;', r'case 7: return a > ref;', ''),
 (REFERENCE, 'reference: alpha NEVER passes', r'case 1: return false; // NEVER', r'case 1: return true; // NEVER', ''),
 (REFERENCE, 'reference: alpha ALWAYS fails', r'case 8: return true; // ALWAYS', r'case 8: return false; // ALWAYS', ''),
 (REFERENCE, 'reference: an unknown alpha function passes', r'default: throw new Error(`reference: alpha function', r'default: return true; throw new Error(`reference: alpha function', ''),
 (REFERENCE, 'reference: the corner takes x and y the wrong way round', r'cornerOf.push((Y[i] === yb ? 2 : 0) + (X[i] === xr ? 1 : 0));', r'cornerOf.push((Y[i] === yb ? 1 : 0) + (X[i] === xr ? 2 : 0));', ''),
 (REFERENCE, 'reference: u follows the vertex, not the corner', r'Uc[cornerOf[i]!] = U[i]!;', r'Uc[i] = U[i]!;', ''),
 (REFERENCE, 'reference: v follows the vertex, not the corner', r'Vc[cornerOf[i]!] = V[i]!;', r'Vc[i] = V[i]!;', ''),
 (REFERENCE, 'reference: the colour follows the vertex, not the corner', r'Cc[cornerOf[i]!] = C[i]!;', r'Cc[i] = C[i]!;', ''),
 (REFERENCE, 'reference: any shared edge of the strip is taken', r'if (!antiDiagonal && !mainDiagonal) {', r'if (false) {', ''),
 (REFERENCE, 'reference: the diagonal from the left-top to the right-bottom corner is not recognised', r'const mainDiagonal = (cornerOf[1] === 0 && cornerOf[2] === 3) || (cornerOf[1] === 3 && cornerOf[2] === 0);', r'const mainDiagonal = false;', ''),
 (REFERENCE, 'reference: the diagonal from the right-top to the left-bottom corner is not recognised', r'const antiDiagonal = (cornerOf[1] === 1 && cornerOf[2] === 2) || (cornerOf[1] === 2 && cornerOf[2] === 1);', r'const antiDiagonal = false;', ''),
 (REFERENCE, 'reference: every strip gets the weights of the right-top to left-bottom diagonal', r'if (antiDiagonal) {', r'if (true) {', ''),
 (REFERENCE, 'reference: the sides of the main diagonal are swapped', r'} else if (s >= t) {', r'} else if (s <= t) {', ''),
 (REFERENCE, 'reference: the right-top weight of the main diagonal ignores t', r'w[1] = s - t;', r'w[1] = s;', ''),
 (REFERENCE, 'reference: the left-bottom weight of the main diagonal ignores s', r'w[2] = t - s;', r'w[2] = t;', ''),
 (REFERENCE, 'reference: a quad without area is an error', r'if (xl === xr || yt === yb) return;', r'', ''),
 (REFERENCE, 'reference: a quad of no width is the only one without area', r'if (xl === xr || yt === yb) return;', r'if (xl === xr) return;', ''),
 (REFERENCE, 'reference: a quad of no height is the only one without area', r'if (xl === xr || yt === yb) return;', r'if (yt === yb) return;', ''),
 (REFERENCE, 'reference: two vertices may share a corner', r'if (new Set(cornerOf).size !== 4) throw new Error(upright);', r'', ''),
]


# ---- stringdraw.ts and the strings of the static, button and radio button (the colour and the place of a string, the call of the font)
S = 'stringdraw.ts'
_NEXT = {'a': 'r', 'r': 'g', 'g': 'b', 'b': 'a'}
for _role, _v in (('colour', 's'), ('outline', 'o')):
    for _c in 'argb':
        _orig = f'{_c}: channel(d.{_c}, {_v}.{_c}, c.{_c})'
        _n = _NEXT[_c]
        M += [
            (S, f'string {_role}: {_c} ignores the dialog', _orig, f'{_c}: channel(1, {_v}.{_c}, c.{_c})', ''),
            (S, f'string {_role}: {_c} ignores the string', _orig, f'{_c}: channel(d.{_c}, 1, c.{_c})', ''),
            (S, f'string {_role}: {_c} ignores the control', _orig, f'{_c}: channel(d.{_c}, {_v}.{_c}, 1)', ''),
            (S, f"string {_role}: {_c} takes the dialog's {_n}", _orig, f'{_c}: channel(d.{_n}, {_v}.{_c}, c.{_c})', ''),
            (S, f"string {_role}: {_c} takes the string's {_n}", _orig, f'{_c}: channel(d.{_c}, {_v}.{_n}, c.{_c})', ''),
            (S, f"string {_role}: {_c} takes the control's {_n}", _orig, f'{_c}: channel(d.{_c}, {_v}.{_c}, c.{_n})', ''),
        ]
M += [
 (S, 'string colour: the product of the dialog and the string is not rounded to a float', r'f(f(dialog * string) * control)', r'f(dialog * string * control)', ''),
 (S, 'string colour: the string and the control are multiplied first', r'f(f(dialog * string) * control)', r'f(dialog * f(string * control))', ''),
 (S, 'string colour: the channel is not rounded to a float at all', r'=> f(f(dialog * string) * control);', r'=> dialog * string * control;', ''),
]
for _a in 'xy':
    _orig = f'{_a}: f(f(dialog.m_Pos.{_a} + at.{_a}) + control.m_OffsetPos.{_a}),'
    _o = 'y' if _a == 'x' else 'x'
    M += [
        (S, f'string place: {_a} ignores the dialog', _orig, f'{_a}: f(at.{_a} + control.m_OffsetPos.{_a}),', ''),
        (S, f'string place: {_a} ignores the string', _orig, f'{_a}: f(dialog.m_Pos.{_a} + control.m_OffsetPos.{_a}),', ''),
        (S, f'string place: {_a} ignores the offset', _orig, f'{_a}: f(dialog.m_Pos.{_a} + at.{_a}),', ''),
        (S, f"string place: {_a} takes the dialog's {_o}", _orig, f'{_a}: f(f(dialog.m_Pos.{_o} + at.{_a}) + control.m_OffsetPos.{_a}),', ''),
        (S, f"string place: {_a} takes the string's {_o}", _orig, f'{_a}: f(f(dialog.m_Pos.{_a} + at.{_o}) + control.m_OffsetPos.{_a}),', ''),
        (S, f"string place: {_a} takes the offset's {_o}", _orig, f'{_a}: f(f(dialog.m_Pos.{_a} + at.{_a}) + control.m_OffsetPos.{_o}),', ''),
        (S, f'string place: {_a} is the sum of three, rounded once', _orig, f'{_a}: f(dialog.m_Pos.{_a} + at.{_a} + control.m_OffsetPos.{_a}),', ''),
    ]
M += [
 (S, 'string: a control in no dialog is drawn (the exe uses a null object)', r'if (!dialog) throw new Error("CKTDGUIDialogHandle::operator->', r'if (false) throw new Error("CKTDGUIDialogHandle::operator->', ''),
 (S, 'string: a null font is called', r'if (!font) throw new Error(`CUKFont::${method}', r'if (false) throw new Error(`CUKFont::${method}', ''),
 (S, 'string: the dialog is looked up before the UK font', "const font = ctx.fonts.getUKFont(data.fontIndex);\n  const dialog = dialogOf(control);", "const dialog = dialogOf(control);\n  const font = ctx.fonts.getUKFont(data.fontIndex);", ''),
 (S, 'string: the dialog is looked up before the font of the map', "const font = ctx.fonts.getMappedUKFont(data.fontIndex);\n  const dialog = dialogOf(control);", "const dialog = dialogOf(control);\n  const font = ctx.fonts.getMappedUKFont(data.fontIndex);", ''),
 (S, 'string: x and y are swapped in OutTextMultiline', r'OutTextMultiline(ftoi(x), ftoi(y), text,', r'OutTextMultiline(ftoi(y), ftoi(x), text,', ''),
 (S, 'string: the place is rounded, not cut', r'OutTextMultiline(ftoi(x), ftoi(y), text,', r'OutTextMultiline(Math.round(x), Math.round(y), text,', ''),
 (S, 'string: the place is rounded up', r'OutTextMultiline(ftoi(x), ftoi(y), text,', r'OutTextMultiline(Math.ceil(x), Math.ceil(y), text,', ''),
 (S, 'string: the colours are swapped in OutTextMultiline', r'text, packColor(color), data.fontStyle, packColor(outline), 1, null,', r'text, packColor(outline), data.fontStyle, packColor(color), 1, null,', ''),
 (S, 'string: the font style is not passed on', r'packColor(color), data.fontStyle, packColor(outline), 1, null,', r'packColor(color), 0, packColor(outline), 1, null,', ''),
 (S, 'string: the line space is 2', r'packColor(outline), 1, null, data.sortFlag, -1, 1, 1);', r'packColor(outline), 2, null, data.sortFlag, -1, 1, 1);', ''),
 (S, 'string: the sort flag is not passed on', r'packColor(outline), 1, null, data.sortFlag, -1, 1, 1);', r'packColor(outline), 1, null, 0, -1, 1, 1);', ''),
 (S, 'string: only one character is drawn', r'packColor(outline), 1, null, data.sortFlag, -1, 1, 1);', r'packColor(outline), 1, null, data.sortFlag, 1, 1, 1);', ''),
 (S, 'string: the x scale is 2', r'packColor(outline), 1, null, data.sortFlag, -1, 1, 1);', r'packColor(outline), 1, null, data.sortFlag, -1, 2, 1);', ''),
 (S, 'string: the y scale is 2', r'packColor(outline), 1, null, data.sortFlag, -1, 1, 1);', r'packColor(outline), 1, null, data.sortFlag, -1, 1, 2);', ''),
 (S, 'string: the font of the map is the UK font list', r'const font = ctx.fonts.getMappedUKFont(data.fontIndex);', r'const font = ctx.fonts.getUKFont(data.fontIndex);', ''),
 (S, 'string: Draw2DText counts the whole message, not the part shown', r'data.fontStyle, text.length);', r'data.fontStyle, data.msg.length);', ''),
 (S, 'string: Draw2DText takes the colours swapped', r'.Draw2DText(text, ftoi(x), ftoi(y), color, outline,', r'.Draw2DText(text, ftoi(x), ftoi(y), outline, color,', ''),
 (S, 'string: Draw2DText takes the flag and the style swapped', r'outline, data.sortFlag, data.fontStyle, text.length);', r'outline, data.fontStyle, data.sortFlag, text.length);', ''),
 (S, 'string: Draw2DText has x and y swapped', r'.Draw2DText(text, ftoi(x), ftoi(y),', r'.Draw2DText(text, ftoi(y), ftoi(x),', ''),
 (S, 'string: Draw2DText cuts the place by rounding', r'.Draw2DText(text, ftoi(x), ftoi(y),', r'.Draw2DText(text, Math.round(x), Math.round(y),', ''),
 (S, 'spread: the longer of the count and the length is shown', r'Math.min(data.iSpreadCount, data.msg.length)', r'Math.max(data.iSpreadCount, data.msg.length)', ''),
 (S, 'spread: a count of 0 is refused', r'if (count < 0) throw', r'if (count <= 0) throw', ''),
 (S, 'spread: a negative count is not refused', r'if (count < 0) throw', r'if (false) throw', ''),
 (S, 'spread: one character too many', r'return data.msg.slice(0, count);', r'return data.msg.slice(0, count + 1);', ''),
 (S, 'spread: the first character is left out', r'return data.msg.slice(0, count);', r'return data.msg.slice(1, count);', ''),
 ('static.ts', 'static: a string without text is drawn', r'if (data.msg.length === 0) continue;', r'', ''),
 ('static.ts', 'static: a string with one character is not drawn', r'if (data.msg.length === 0) continue;', r'if (data.msg.length <= 1) continue;', ''),
 ('static.ts', 'static: a string spreads whether it spreads or not', r'const text = data.bSpread ? spreadText(data) : data.msg;', r'const text = spreadText(data);', ''),
 ('static.ts', 'static: a spreading string is shown whole', r'const text = data.bSpread ? spreadText(data) : data.msg;', r'const text = data.msg;', ''),
 ('static.ts', 'static: USE_UK_FONT is ignored: every string goes to the UK font', r'if (data.bUseUkFont) drawUKString(this.ctx, this, data, text);', r'if (true) drawUKString(this.ctx, this, data, text);', ''),
 ('static.ts', 'static: USE_UK_FONT is turned round', r'if (data.bUseUkFont) drawUKString(this.ctx, this, data, text);', r'if (!data.bUseUkFont) drawUKString(this.ctx, this, data, text);', ''),
 ('static.ts', 'static: only the first string is drawn', r'if (data.msg.length === 0) continue;', r'if (data.msg.length === 0 || data !== this.m_StringDataList[0]) continue;', ''),
 ('static.ts', 'static: the strings are drawn before the pictures are done: after the first picture only', "    for (const data of this.m_StringDataList) {\n      if (data.msg.length === 0) continue;", "    if (this.m_PictureDataList.length > 0) for (const data of this.m_StringDataList) {\n      if (data.msg.length === 0) continue;", ''),
 ('button.ts', 'button: an empty message is not drawn', r'if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);', r'if (this.m_pStringData && this.m_pStringData.msg.length !== 0) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);', ''),
 ('button.ts', 'button: the string is drawn before the edge on the quad', "if (edge) this.drawEdge(false);\n    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);", "if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);\n    if (edge) this.drawEdge(false);", ''),
 ('button.ts', 'button: the string is drawn before the quad', "    this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);\n    if (edge) this.drawEdge(false);\n    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);", "    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);\n    this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);\n    if (edge) this.drawEdge(false);", ''),
 ('radiobutton.ts', 'radio button: an empty message is not drawn', r'if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);', r'if (this.m_pStringData && this.m_pStringData.msg.length !== 0) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);', ''),
 ('radiobutton.ts', 'radio button: the string is drawn after the check point', "    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);\n    if (this.m_bChecked) {\n      const point = this.m_pCheckedPoint;", "    if (this.m_bChecked) {\n      const point = this.m_pCheckedPoint;", ''),
 ('radiobutton.ts', 'radio button: the string is drawn before the checked edge', "    if (this.m_bChecked) this.drawCheckedEdge(false);\n    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);", "    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);\n    if (this.m_bChecked) this.drawCheckedEdge(false);", ''),
 ('radiobutton.ts', 'radio button: the string is drawn before the background', "    if (background) {\n      this.updateVertex(this.m_Vertex, this.m_MyNowPoint);\n      this.renderVertex(this.m_Vertex, this.m_MyNowPoint, 1);\n    }\n    if (this.m_bChecked) this.drawCheckedEdge(false);\n    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);\n", "    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);\n    if (background) {\n      this.updateVertex(this.m_Vertex, this.m_MyNowPoint);\n      this.renderVertex(this.m_Vertex, this.m_MyNowPoint, 1);\n    }\n    if (this.m_bChecked) this.drawCheckedEdge(false);\n", ''),
]


# ---- combobox.ts: OnFrameRender (3293DB00) and OnFrameRenderEnd (3293E390), and the place a combo box gives its strings (stringdraw.ts `at`)
C = 'combobox.ts'
_RC = '    if (!this.m_bShow) return 0;\n    const data = this.m_pStringData;\n    const font = data ? this.ctx.fonts.getUKFont(data.fontIndex) : null;\n'
M += [
 (C, 'combo: a hidden box is drawn', _RC + '    const statics = this.ctx.statics;', _RC.replace('    if (!this.m_bShow) return 0;\n', '') + '    const statics = this.ctx.statics;', ''),
 (C, 'combo end: a hidden box draws its dropdown', _RC + '    const open = this.m_bOpened;', _RC.replace('    if (!this.m_bShow) return 0;\n', '') + '    const open = this.m_bOpened;', ''),
 (C, 'combo: the first-box rule runs for every box', 'if (!statics.bSBInit) {', 'if (true) {', ''),
 (C, 'combo: the first-box rule is never used up', '      statics.bSBInit = true;\n    }\n    const pressed', '    }\n    const pressed', ''),
 (C, 'combo: only a box with a bar uses the first-box rule up', '        bar.updateThumbRect();\n      }\n      statics.bSBInit = true;\n    }', '        bar.updateThumbRect();\n        statics.bSBInit = true;\n      }\n    }', ''),
 (C, 'combo page: the height is the sum of bottom and top', 'const height = (this.m_rcDropdownText.bottom - this.m_rcDropdownText.top) | 0;', 'const height = (this.m_rcDropdownText.bottom + this.m_rcDropdownText.top) | 0;', ''),
 (C, 'combo page: the static box does not divide by its row height', 'this.m_bIsStaticComboBox ? idiv(height, this.m_nStaticHeight) :', 'this.m_bIsStaticComboBox ? height :', ''),
 (C, 'combo page: the static box divides by the font height', 'this.m_bIsStaticComboBox ? idiv(height, this.m_nStaticHeight) :', 'this.m_bIsStaticComboBox ? idiv(height, font ? font.lineHeight() : 1) :', ''),
 (C, 'combo page: a box with a font does not divide', 'font ? idiv(height, font.lineHeight()) : height;', 'font ? height : height;', ''),
 (C, 'combo page: a box without a font divides by 2', 'font ? idiv(height, font.lineHeight()) : height;', 'font ? idiv(height, font.lineHeight()) : idiv(height, 2);', ''),
 (C, 'combo page: a box with a font divides by the static height', 'font ? idiv(height, font.lineHeight()) : height;', 'font ? idiv(height, this.m_nStaticHeight || 1) : height;', ''),
 (C, 'combo page: the bar is not capped', '        bar.cap();\n        bar.updateThumbRect();\n      }\n      statics', '        bar.updateThumbRect();\n      }\n      statics', ''),
 (C, 'combo page: the thumb is not updated', '        bar.cap();\n        bar.updateThumbRect();\n      }\n      statics', '        bar.cap();\n      }\n      statics', ''),
 (C, 'combo: a disabled box can be pressed', 'const pressed = this.m_bEnable && this.m_bPressed;', 'const pressed = this.m_bPressed;', ''),
 (C, 'combo: pressed or enabled is pressed', 'const pressed = this.m_bEnable && this.m_bPressed;', 'const pressed = this.m_bEnable || this.m_bPressed;', ''),
 (C, 'combo: an enabled box that is not pressed is pressed', 'const pressed = this.m_bEnable && this.m_bPressed;', 'const pressed = this.m_bEnable && !this.m_bPressed;', ''),
 (C, 'combo: the button is at the text rectangle', 'copyRect(window, this.m_rcButton);', 'copyRect(window, this.m_rcText);', ''),
 (C, 'combo: the button is moved by (3, 0)', 'offsetRect(window, 0, 0);', 'offsetRect(window, 3, 0);', ''),
 (C, 'combo: the button is moved by (0, 3)', 'offsetRect(window, 0, 0);', 'offsetRect(window, 0, 3);', ''),
 (C, 'combo: the button texture is not taken', 'if (this.m_pButtonTex) point.pUITextureData = this.m_pButtonTex;\n', '', ''),
 (C, 'combo: the button texture is taken even when there is none', 'if (this.m_pButtonTex) point.pUITextureData = this.m_pButtonTex;\n', 'point.pUITextureData = this.m_pButtonTex;\n', ''),
 (C, 'combo: the mouse-down texture is taken when pressed, there is one or not', 'if (pressed && this.m_pButtonMouseDownTex) point', 'if (pressed) point', ''),
 (C, 'combo: the mouse-down texture is taken without the press', 'if (pressed && this.m_pButtonMouseDownTex) point', 'if (this.m_pButtonMouseDownTex) point', ''),
 (C, 'combo: the mouse-over texture beats the mouse-down one', '    else if (this.m_bMouseOver) point.pUITextureData', '    if (this.m_bMouseOver) point.pUITextureData', ''),
 (C, 'combo: the mouse-over texture is taken when the mouse is away', 'else if (this.m_bMouseOver) point.pUITextureData', 'else if (!this.m_bMouseOver) point.pUITextureData', ''),
 (C, 'combo: no mouse-over texture falls back to the button texture', 'point.pUITextureData = this.m_pButtonMouseOverTex;', 'point.pUITextureData = this.m_pButtonMouseOverTex ?? this.m_pButtonTex;', ''),
 (C, 'combo: the button is drawn even without a texture', 'if (point.pUITextureData) this.drawTempPoint();', 'this.drawTempPoint();', 'RenderVertex draws nothing for a point without a texture and the vertex UpdateVertex fills is not read again'),
 (C, 'combo: the button is not drawn', 'if (point.pUITextureData) this.drawTempPoint();', '', ''),
 (C, 'combo: the text rectangle is the button rectangle', 'this.drawRect(this.m_rcText, this.m_pTextTex);', 'this.drawRect(this.m_rcButton, this.m_pTextTex);', ''),
 (C, 'combo: the text rectangle has the button texture', 'this.drawRect(this.m_rcText, this.m_pTextTex);', 'this.drawRect(this.m_rcText, this.m_pButtonTex);', ''),
 (C, 'combo: the text rectangle is not drawn', 'this.drawRect(this.m_rcText, this.m_pTextTex);\n', '', ''),
 # a rectangle without a texture does not change the point (the next button quad may still use the texture it holds)
 (C, 'combo: a rectangle without a texture clears the point', '    if (!texture) return;\n    p.pUITextureData = texture;\n    this.drawTempPoint();', '    p.pUITextureData = texture;\n    if (!texture) return;\n    this.drawTempPoint();', ''),
 (C, 'combo: a rectangle is drawn with the texture it had', '    p.pUITextureData = texture;\n    this.drawTempPoint();\n  }\n\n  /**\n   * `OnFrameRender`', '    this.drawTempPoint();\n  }\n\n  /**\n   * `OnFrameRender`', ''),
 (C, 'combo: the left-bottom corner has the right side', '    p.leftTopPoint.set(rc.left, rc.top);\n    p.rightTopPoint.set(rc.right, rc.top);\n    p.leftBottomPoint.set(rc.left, rc.bottom);', '    p.leftTopPoint.set(rc.left, rc.top);\n    p.rightTopPoint.set(rc.right, rc.top);\n    p.leftBottomPoint.set(rc.right, rc.bottom);', ''),
 (C, 'combo: the right-bottom corner has the left side', '    p.rightBottomPoint.set(rc.right, rc.bottom);\n    return p;', '    p.rightBottomPoint.set(rc.left, rc.bottom);\n    return p;', ''),
 (C, 'combo: the right-top corner has the bottom', '    p.rightTopPoint.set(rc.right, rc.top);\n    p.leftBottomPoint', '    p.rightTopPoint.set(rc.right, rc.bottom);\n    p.leftBottomPoint', ''),
 (C, 'combo: the left-top corner has the right side', '    p.leftTopPoint.set(rc.left, rc.top);\n    p.rightTopPoint', '    p.leftTopPoint.set(rc.right, rc.top);\n    p.rightTopPoint', ''),
 (C, 'combo: the selected text is shown without m_bSelectTextShow', 'if (this.m_bSelectTextShow) {', 'if (true) {', ''),
 (C, 'combo: the row -1 is selected too', 'if (selected >= 0 && selected < this.m_Items.length) {', 'if (selected >= -1 && selected < this.m_Items.length) {', ''),
 (C, 'combo: the first row cannot be selected', 'if (selected >= 0 && selected < this.m_Items.length) {', 'if (selected > 0 && selected < this.m_Items.length) {', ''),
 (C, 'combo: the row past the last can be selected', 'if (selected >= 0 && selected < this.m_Items.length) {', 'if (selected >= 0 && selected <= this.m_Items.length) {', ''),
 (C, 'combo: the last row cannot be selected', 'if (selected >= 0 && selected < this.m_Items.length) {', 'if (selected >= 0 && selected < this.m_Items.length - 1) {', ''),
 (C, 'combo: the text and the control swap', '        if (!this.m_bIsStaticComboBox) {\n          if (data) {', '        if (this.m_bIsStaticComboBox) {\n          if (data) {', ''),
 (C, 'combo: a box without string data speaks', '          if (data) {\n            const at', '          if (true) {\n            const at', ''),
 (C, 'combo text: x ignores the offset', 'x: f(f(this.m_TextStringOffsetPosX) + f(this.m_rcText.left)),', 'x: f(this.m_rcText.left),', ''),
 (C, 'combo text: x ignores the text rectangle', 'x: f(f(this.m_TextStringOffsetPosX) + f(this.m_rcText.left)),', 'x: f(this.m_TextStringOffsetPosX),', ''),
 (C, "combo text: x takes the offset's y", 'x: f(f(this.m_TextStringOffsetPosX) + f(this.m_rcText.left)),', 'x: f(f(this.m_TextStringOffsetPosY) + f(this.m_rcText.left)),', ''),
 (C, "combo text: x takes the rectangle's right", 'x: f(f(this.m_TextStringOffsetPosX) + f(this.m_rcText.left)),', 'x: f(f(this.m_TextStringOffsetPosX) + f(this.m_rcText.right)),', ''),
 (C, 'combo text: y ignores the offset', 'y: f(f(this.m_TextStringOffsetPosY) + f(this.m_rcText.top)) };', 'y: f(this.m_rcText.top) };', ''),
 (C, 'combo text: y ignores the text rectangle', 'y: f(f(this.m_TextStringOffsetPosY) + f(this.m_rcText.top)) };', 'y: f(this.m_TextStringOffsetPosY) };', ''),
 (C, "combo text: y takes the offset's x", 'y: f(f(this.m_TextStringOffsetPosY) + f(this.m_rcText.top)) };', 'y: f(f(this.m_TextStringOffsetPosX) + f(this.m_rcText.top)) };', ''),
 (C, "combo text: y takes the rectangle's bottom", 'y: f(f(this.m_TextStringOffsetPosY) + f(this.m_rcText.top)) };', 'y: f(f(this.m_TextStringOffsetPosY) + f(this.m_rcText.bottom)) };', ''),
 (C, 'combo text: the limit counts from 1 (0 cuts everything)', 'limit > 0 ? item.strText', 'limit >= 0 ? item.strText', ''),
 (C, 'combo text: a limit of 1 does not cut', 'limit > 0 ? item.strText', 'limit > 1 ? item.strText', ''),
 (C, 'combo text: the limit is not applied', 'limit > 0 ? item.strText.slice(0, Math.min(limit, item.strText.length)) : item.strText', 'item.strText', ''),
 (C, 'combo text: the limit cuts the other end', 'item.strText.slice(0, Math.min(limit, item.strText.length))', 'item.strText.slice(Math.min(limit, item.strText.length))', ''),
 (C, 'combo text: the limit is one more', 'item.strText.slice(0, Math.min(limit, item.strText.length))', 'item.strText.slice(0, Math.min(limit + 1, item.strText.length))', ''),
 (C, 'combo text: the limit is not capped at the length', 'item.strText.slice(0, Math.min(limit, item.strText.length))', 'item.strText.slice(0, limit)', 'String.slice clamps: the exe\'s constructor needs the cap, JS does not'),
 (C, 'combo static: the control is not moved', '            control.setOffsetPos(new Vec2(x, y));\n            control.onFrameRender();\n          }\n        }\n      }\n    }\n    return 0;', '            control.onFrameRender();\n          }\n        }\n      }\n    }\n    return 0;', ''),
 (C, 'combo static: the control is not drawn', '            control.setOffsetPos(new Vec2(x, y));\n            control.onFrameRender();\n          }\n        }\n      }\n    }\n    return 0;', '            control.setOffsetPos(new Vec2(x, y));\n          }\n        }\n      }\n    }\n    return 0;', ''),
 (C, 'combo static: a row without a control is drawn', '          if (control) {\n            control.setOffsetPos(new Vec2(x, y));', '          if (true) {\n            control.setOffsetPos(new Vec2(x, y));', ''),
 (C, 'combo static: x ignores the dialog', 'const x = f(f(dialog.m_Pos.x + this.m_OffsetPos.x) + f(this.m_rcText.left));', 'const x = f(this.m_OffsetPos.x + f(this.m_rcText.left));', ''),
 (C, 'combo static: x ignores the offset', 'const x = f(f(dialog.m_Pos.x + this.m_OffsetPos.x) + f(this.m_rcText.left));', 'const x = f(dialog.m_Pos.x + f(this.m_rcText.left));', ''),
 (C, 'combo static: x ignores the text rectangle', 'const x = f(f(dialog.m_Pos.x + this.m_OffsetPos.x) + f(this.m_rcText.left));', 'const x = f(dialog.m_Pos.x + this.m_OffsetPos.x);', ''),
 (C, "combo static: x takes the dialog's y", 'const x = f(f(dialog.m_Pos.x + this.m_OffsetPos.x) + f(this.m_rcText.left));', 'const x = f(f(dialog.m_Pos.y + this.m_OffsetPos.x) + f(this.m_rcText.left));', ''),
 (C, 'combo static: y ignores the dialog', 'const y = f(f(this.m_rcText.top) + f(dialog.m_Pos.y + this.m_OffsetPos.y));', 'const y = f(f(this.m_rcText.top) + f(this.m_OffsetPos.y));', ''),
 (C, 'combo static: y ignores the offset', 'const y = f(f(this.m_rcText.top) + f(dialog.m_Pos.y + this.m_OffsetPos.y));', 'const y = f(f(this.m_rcText.top) + f(dialog.m_Pos.y));', ''),
 (C, 'combo static: y ignores the text rectangle', 'const y = f(f(this.m_rcText.top) + f(dialog.m_Pos.y + this.m_OffsetPos.y));', 'const y = f(dialog.m_Pos.y + this.m_OffsetPos.y);', ''),
 (C, "combo static: y takes the offset's x", 'const y = f(f(this.m_rcText.top) + f(dialog.m_Pos.y + this.m_OffsetPos.y));', 'const y = f(f(this.m_rcText.top) + f(dialog.m_Pos.y + this.m_OffsetPos.x));', ''),
 (C, 'combo static: y takes the bottom of the text rectangle', 'const y = f(f(this.m_rcText.top) + f(dialog.m_Pos.y + this.m_OffsetPos.y));', 'const y = f(f(this.m_rcText.bottom) + f(dialog.m_Pos.y + this.m_OffsetPos.y));', ''),
]
# ---- OnFrameRenderEnd
M += [
 (C, 'combo end: a closed box draws its dropdown', 'if (open) this.drawRect(this.m_rcDropdown, this.m_pDropdownTex);', 'this.drawRect(this.m_rcDropdown, this.m_pDropdownTex);', ''),
 (C, 'combo end: an open box does not draw its dropdown', 'if (open) this.drawRect(this.m_rcDropdown, this.m_pDropdownTex);', '', ''),
 (C, 'combo end: the dropdown has the highlight texture', 'if (open) this.drawRect(this.m_rcDropdown, this.m_pDropdownTex);', 'if (open) this.drawRect(this.m_rcDropdown, this.m_pDropdownTextTex);', ''),
 (C, 'combo end: the dropdown is the dropdown text rectangle', 'if (open) this.drawRect(this.m_rcDropdown, this.m_pDropdownTex);', 'if (open) this.drawRect(this.m_rcDropdownText, this.m_pDropdownTex);', ''),
 (C, 'combo end: the rows are laid out for a box with string data only', '    if (font) {\n      const text', '    if (data) {\n      const text', ''),
 (C, 'combo end: the rows are laid out without a font', '    if (font) {\n      const text', '    if (true) {\n      const text', ''),
 (C, 'combo end: a static row is as high as the font', 'const rowHeight = this.m_bIsStaticComboBox ? this.m_nStaticHeight : font.lineHeight();', 'const rowHeight = font.lineHeight();', ''),
 (C, 'combo end: a text row is as high as m_nStaticHeight', 'const rowHeight = this.m_bIsStaticComboBox ? this.m_nStaticHeight : font.lineHeight();', 'const rowHeight = this.m_nStaticHeight;', ''),
 (C, 'combo end: a row is one pixel too high', 'const rowHeight = this.m_bIsStaticComboBox ? this.m_nStaticHeight : font.lineHeight();', 'const rowHeight = this.m_bIsStaticComboBox ? this.m_nStaticHeight : font.lineHeight() + 1;', ''),
 (C, 'combo end: the rows start at the bottom of the text rectangle', 'let top = text.top;', 'let top = text.bottom;', ''),
 (C, 'combo end: the room is the width', 'let room = (text.bottom - top) | 0;', 'let room = (text.right - top) | 0;', ''),
 (C, 'combo end: the room is counted from the left', 'let room = (text.bottom - top) | 0;', 'let room = (text.bottom - text.left) | 0;', ''),
 (C, "combo end: the rows start at 0 whatever the bar's position", 'let i = bar ? bar.m_nPosition : 0;', 'let i = 0;', ''),
 (C, 'combo end: the rows start at the bar position even without a bar (the first row)', 'let i = bar ? bar.m_nPosition : 0;', 'let i = bar ? bar.m_nPosition : 1;', ''),
 (C, 'combo end: the rows start one after the bar position', 'let i = bar ? bar.m_nPosition : 0;', 'let i = bar ? bar.m_nPosition + 1 : 0;', ''),
 (C, 'combo end: the room grows by a row', 'room = (room - rowHeight) | 0;', 'room = (room + rowHeight) | 0;', ''),
 (C, 'combo end: a row that leaves 0 is hidden', 'if (room < 0) {', 'if (room <= 0) {', ''),
 (C, 'combo end: a row that leaves -1 is shown', 'if (room < 0) {', 'if (room < -1) {', ''),
 (C, 'combo end: a hidden row stops the layout', '          row.bVisible = false;\n          continue;', '          row.bVisible = false;\n          break;', ''),
 (C, 'combo end: a hidden row is laid out too', '          row.bVisible = false;\n          continue;', '          row.bVisible = false;', ''),
 (C, 'combo end: a hidden row is not marked', '          row.bVisible = false;\n          continue;', '          continue;', ''),
 (C, 'combo end: the row rectangle starts at the right of the text', 'setRect(row.rcActive, text.left, top,', 'setRect(row.rcActive, text.right, top,', ''),
 (C, 'combo end: the row rectangle ignores the bar width', '(text.right + (bar ? bar.m_width : 0)) | 0, (top + rowHeight) | 0);', 'text.right, (top + rowHeight) | 0);', ''),
 (C, 'combo end: the row rectangle takes the bar width of no bar as 1', '(text.right + (bar ? bar.m_width : 0)) | 0', '(text.right + (bar ? bar.m_width : 1)) | 0', ''),
 (C, 'combo end: the row rectangle is as wide as the bar adds twice', '(text.right + (bar ? bar.m_width : 0)) | 0', '(text.right + (bar ? 2 * bar.m_width : 0)) | 0', ''),
 (C, 'combo end: the row rectangle has no height', '(text.right + (bar ? bar.m_width : 0)) | 0, (top + rowHeight) | 0);', '(text.right + (bar ? bar.m_width : 0)) | 0, top);', ''),
 (C, 'combo end: the row rectangle top is the text top', 'setRect(row.rcActive, text.left, top,', 'setRect(row.rcActive, text.left, text.top,', ''),
 (C, 'combo end: the rows do not advance', '        top = (top + rowHeight) | 0;\n        row.bVisible = true;', '        row.bVisible = true;', ''),
 (C, 'combo end: the rows advance by 2', '        top = (top + rowHeight) | 0;\n        row.bVisible = true;', '        top = (top + 2 * rowHeight) | 0;\n        row.bVisible = true;', ''),
 (C, 'combo end: a row that fits is not marked visible', '        row.bVisible = true;\n        if (!open) continue;', '        if (!open) continue;', ''),
 (C, 'combo end: a closed box goes on to draw its rows', '        if (!open) continue;', '', ''),
 (C, 'combo end: an open box does not draw its rows', '        if (!open) continue;', '        if (open) continue;', ''),
 (C, 'combo end: the row highlight starts at the text left', 'const rc: Rect = { left: this.m_rcDropdown.left,', 'const rc: Rect = { left: this.m_rcDropdownText.left,', ''),
 (C, 'combo end: the row highlight starts at the dropdown right', 'const rc: Rect = { left: this.m_rcDropdown.left,', 'const rc: Rect = { left: this.m_rcDropdown.right,', ''),
 (C, 'combo end: the row highlight top is the row top + 2', 'top: (row.rcActive.top - 2) | 0,', 'top: (row.rcActive.top + 2) | 0,', ''),
 (C, 'combo end: the row highlight top is the row top - 1', 'top: (row.rcActive.top - 2) | 0,', 'top: (row.rcActive.top - 1) | 0,', ''),
 (C, 'combo end: the row highlight top is the row top', 'top: (row.rcActive.top - 2) | 0,', 'top: row.rcActive.top,', ''),
 (C, 'combo end: the row highlight ends at the dropdown left', 'right: this.m_rcDropdown.right, bottom:', 'right: this.m_rcDropdown.left, bottom:', ''),
 (C, 'combo end: the row highlight ends at the text right', 'right: this.m_rcDropdown.right, bottom:', 'right: this.m_rcDropdownText.right, bottom:', ''),
 (C, 'combo end: the row highlight bottom is the row bottom - 2', 'bottom: (row.rcActive.bottom + 2) | 0 };', 'bottom: (row.rcActive.bottom - 2) | 0 };', ''),
 (C, 'combo end: the row highlight bottom is the row bottom', 'bottom: (row.rcActive.bottom + 2) | 0 };', 'bottom: row.rcActive.bottom };', ''),
 (C, 'combo end: the row highlight bottom is the row top + 2', 'bottom: (row.rcActive.bottom + 2) | 0 };', 'bottom: (row.rcActive.top + 2) | 0 };', ''),
 (C, 'combo end: a text box takes the static branch', '        if (this.m_bIsStaticComboBox) {\n          const control = row.pControl;', '        if (!this.m_bIsStaticComboBox) {\n          const control = row.pControl;', ''),
 (C, 'combo end: a row without a control is drawn', '          if (control) {\n            control.setOffsetPos(new Vec2(rc.left, rc.top));', '          if (true) {\n            control.setOffsetPos(new Vec2(rc.left, rc.top));', ''),
 (C, "combo end: the control is moved to the dropdown's right", 'control.setOffsetPos(new Vec2(rc.left, rc.top));\n            control.onFrameRender();\n          }\n          continue;', 'control.setOffsetPos(new Vec2(rc.right, rc.top));\n            control.onFrameRender();\n          }\n          continue;', ''),
 (C, "combo end: the control is moved to the row's bottom", 'control.setOffsetPos(new Vec2(rc.left, rc.top));\n            control.onFrameRender();\n          }\n          continue;', 'control.setOffsetPos(new Vec2(rc.left, rc.bottom));\n            control.onFrameRender();\n          }\n          continue;', ''),
 (C, "combo end: the control is moved to the row's own top", 'control.setOffsetPos(new Vec2(rc.left, rc.top));\n            control.onFrameRender();\n          }\n          continue;', 'control.setOffsetPos(new Vec2(rc.left, row.rcActive.top));\n            control.onFrameRender();\n          }\n          continue;', ''),
 (C, 'combo end: the control is not moved', '            control.setOffsetPos(new Vec2(rc.left, rc.top));\n            control.onFrameRender();\n          }\n          continue;', '            control.onFrameRender();\n          }\n          continue;', ''),
 (C, 'combo end: the control is not drawn', '            control.setOffsetPos(new Vec2(rc.left, rc.top));\n            control.onFrameRender();\n          }\n          continue;', '            control.setOffsetPos(new Vec2(rc.left, rc.top));\n          }\n          continue;', ''),
 (C, 'combo end: a static row goes on to draw a highlight and text', '            control.onFrameRender();\n          }\n          continue;\n        }\n        if (i === this.m_iFocused)', '            control.onFrameRender();\n          }\n        }\n        if (i === this.m_iFocused)', ''),
 (C, 'combo end: the focused row is not highlighted', 'if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', '', ''),
 (C, 'combo end: every row is highlighted', 'if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', 'this.drawRect(rc, this.m_pDropdownTextTex);', ''),
 (C, 'combo end: the rows but the focused one are highlighted', 'if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', 'if (i !== this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', ''),
 (C, 'combo end: the rows from the focused one on are highlighted', 'if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', 'if (i >= this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', ''),
 (C, 'combo end: the highlight has the dropdown texture', 'if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', 'if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTex);', ''),
 (C, 'combo end: the highlight is the row rectangle', 'if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', 'if (i === this.m_iFocused) this.drawRect(row.rcActive, this.m_pDropdownTextTex);', ''),
 (C, 'combo end: the text is drawn without string data', '        if (data) drawUKString(this.ctx, this, data, row.strText,', '        if (true) drawUKString(this.ctx, this, data!, row.strText,', 'the loop runs only with a font, and a font needs string data'),
 (C, 'combo end: the text is drawn before the highlight', '        if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);\n        if (data) drawUKString(this.ctx, this, data, row.strText, { x: row.rcActive.left, y: row.rcActive.top });', '        if (data) drawUKString(this.ctx, this, data, row.strText, { x: row.rcActive.left, y: row.rcActive.top });\n        if (i === this.m_iFocused) this.drawRect(rc, this.m_pDropdownTextTex);', ''),
 (C, 'combo end: the text is cut to m_iTextLimit', 'data, row.strText, { x: row.rcActive.left, y: row.rcActive.top });', 'data, this.m_iTextLimit > 0 ? row.strText.slice(0, this.m_iTextLimit) : row.strText, { x: row.rcActive.left, y: row.rcActive.top });', ''),
 (C, 'combo end: the text is at the right of the row', '{ x: row.rcActive.left, y: row.rcActive.top });', '{ x: row.rcActive.right, y: row.rcActive.top });', ''),
 (C, 'combo end: the text is at the bottom of the row', '{ x: row.rcActive.left, y: row.rcActive.top });', '{ x: row.rcActive.left, y: row.rcActive.bottom });', ''),
 (C, 'combo end: the text is at the row top for x', '{ x: row.rcActive.left, y: row.rcActive.top });', '{ x: row.rcActive.top, y: row.rcActive.top });', ''),
 (C, 'combo end: the text is at the row left for y', '{ x: row.rcActive.left, y: row.rcActive.top });', '{ x: row.rcActive.left, y: row.rcActive.left });', ''),
 (C, 'combo end: the text is at the corner of the dropdown', '{ x: row.rcActive.left, y: row.rcActive.top });', '{ x: this.m_rcDropdown.left, y: row.rcActive.top });', ''),
 (C, 'combo end: the bar is checked for a closed box', '    if (open) {\n      let total: number;', '    if (true) {\n      let total: number;', ''),
 (C, 'combo end: the bar is not drawn', '      if (this.m_nDropHeight < total) bar.onFrameRender();', '', ''),
 (C, 'combo end: the bar is drawn when the height is not above the rows', 'if (this.m_nDropHeight < total) bar.onFrameRender();', 'if (this.m_nDropHeight <= total) bar.onFrameRender();', ''),
 (C, 'combo end: the bar is drawn when the rows are not above the height', 'if (this.m_nDropHeight < total) bar.onFrameRender();', 'if (this.m_nDropHeight > total) bar.onFrameRender();', ''),
 (C, 'combo end: the bar is drawn always', 'if (this.m_nDropHeight < total) bar.onFrameRender();', 'bar.onFrameRender();', ''),
 (C, 'combo end: a static box without a bar goes on', '        if (!bar) return 0;\n        total = Math.imul(this.m_nStaticHeight, this.m_Items.length);', '        total = Math.imul(this.m_nStaticHeight, this.m_Items.length);', ''),
 (C, 'combo end: a static box counts the font height', 'total = Math.imul(this.m_nStaticHeight, this.m_Items.length);', 'total = Math.imul(font ? font.lineHeight() : 1, this.m_Items.length);', ''),
 (C, 'combo end: a static box adds instead of multiplying', 'total = Math.imul(this.m_nStaticHeight, this.m_Items.length);', 'total = (this.m_nStaticHeight + this.m_Items.length) | 0;', ''),
 (C, 'combo end: a text box without a font goes on', '        if (!bar || !font) return 0;', '        if (!bar) return 0;', ''),
 (C, 'combo end: a text box counts the static height', 'total = Math.imul(this.m_Items.length, font.lineHeight());', 'total = Math.imul(this.m_Items.length, this.m_nStaticHeight);', ''),
 (C, 'combo end: a text box adds instead of multiplying', 'total = Math.imul(this.m_Items.length, font.lineHeight());', 'total = (this.m_Items.length + font.lineHeight()) | 0;', ''),
 (C, 'combo end: a text box counts the font height without the extra pixel', 'total = Math.imul(this.m_Items.length, font.lineHeight());', 'total = Math.imul(this.m_Items.length, font.lineHeight() - 1);', ''),
 (S, 'string place: the place of the control is ignored (the string data\'s)', 'stringPosition(dialog, control, data, at);', 'stringPosition(dialog, control, data);', ''),
 (S, "string place: the default is the origin", 'at: StringPlace = data.pos): { x: number; y: number } {', 'at: StringPlace = { x: 0, y: 0 }): { x: number; y: number } {', ''),
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
        path = path_of(f)
        if path not in sources:
            sources[path] = open(path).read()
        assert sources[path].count(a) == 1, f'anchor not found exactly once: {f}: {name}'
        assert a != b, f'no change: {name}'
    bad = survived = run = 0
    try:
        for f, name, a, b, why in M:
            if pick and not any(p in name for p in pick):
                continue
            path = path_of(f)
            orig = sources[path]
            open(path, 'w').write(orig.replace(a, b, 1))
            try:
                r = subprocess.run([BUN, 'test', *tests_of(f)], cwd=ROOT, capture_output=True, text=True, timeout=90, preexec_fn=limits)
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
