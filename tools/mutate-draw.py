#!/usr/bin/env python3
"""Mutation check of the UI drawing classes (CKTDXDeviceTexture::Draw, the edges of the static / button / radio button, the
OnFrameRender of the radio button, check box, slider, navigation, control list and scroll bar, and the strings the static, button and
radio button draw: stringdraw.ts): apply one small change at a time to a source file of packages/ui/src, run
packages/ui/test/controldraw.test.ts, render.test.ts and stringdraw.test.ts and report whether a test notices (killed) or not
(SURVIVED).  The last mutants are of the CPU reference of the GPU test (packages/ui/test-gpu/reference.ts: corners, culling, alpha
test), which packages/ui/test/reference.test.ts must pin.

    python3 tools/mutate-draw.py [--list] [substring of a mutant name ...]

A mutant that must be killed and survives makes the exit code 1; a mutant with a reason is expected to survive.  The source is restored
after every mutant (also on Ctrl-C), but do not run this with uncommitted edits in the mutated files you cannot afford to lose.  Needs
`bun` in ./node_modules/.bin; the run takes ~2 s per mutant.  Each run has a 90 s timeout and an 8 GB address-space limit.
"""
import os, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
TESTS = [os.path.join(ROOT, 'packages/ui/test/controldraw.test.ts'), os.path.join(ROOT, 'packages/ui/test/render.test.ts'), os.path.join(ROOT, 'packages/ui/test/stringdraw.test.ts')]
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
    _orig = f'{_a}: f(f(dialog.m_Pos.{_a} + data.pos.{_a}) + control.m_OffsetPos.{_a}),'
    _o = 'y' if _a == 'x' else 'x'
    M += [
        (S, f'string place: {_a} ignores the dialog', _orig, f'{_a}: f(data.pos.{_a} + control.m_OffsetPos.{_a}),', ''),
        (S, f'string place: {_a} ignores the string', _orig, f'{_a}: f(dialog.m_Pos.{_a} + control.m_OffsetPos.{_a}),', ''),
        (S, f'string place: {_a} ignores the offset', _orig, f'{_a}: f(dialog.m_Pos.{_a} + data.pos.{_a}),', ''),
        (S, f"string place: {_a} takes the dialog's {_o}", _orig, f'{_a}: f(f(dialog.m_Pos.{_o} + data.pos.{_a}) + control.m_OffsetPos.{_a}),', ''),
        (S, f"string place: {_a} takes the string's {_o}", _orig, f'{_a}: f(f(dialog.m_Pos.{_a} + data.pos.{_o}) + control.m_OffsetPos.{_a}),', ''),
        (S, f"string place: {_a} takes the offset's {_o}", _orig, f'{_a}: f(f(dialog.m_Pos.{_a} + data.pos.{_a}) + control.m_OffsetPos.{_o}),', ''),
        (S, f'string place: {_a} is the sum of three, rounded once', _orig, f'{_a}: f(dialog.m_Pos.{_a} + data.pos.{_a} + control.m_OffsetPos.{_a}),', ''),
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
