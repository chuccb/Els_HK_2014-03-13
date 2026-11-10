#!/usr/bin/env python3
"""Mutation check of the UI drawing classes (CKTDXDeviceTexture::Draw, the edges of the static / button / radio button, the
OnFrameRender of the radio button, check box, slider, navigation, control list and scroll bar, the strings the static, button and
radio button draw: stringdraw.ts, the combo box: combobox.ts, OnFrameRender and OnFrameRenderEnd, the list box: listbox.ts, and the slot:
slot.ts, OnFrameRender, DrawEdge, UpdateDraggingVertex and RenderDragSlot): apply one small change at a time to a source file of
packages/ui/src, run packages/ui/test/controldraw.test.ts, render.test.ts, stringdraw.test.ts, comboboxdraw.test.ts and listboxdraw.test.ts
(for slot.ts: slotdraw.test.ts) and report whether a test notices (killed) or not (SURVIVED).  The last mutants are of the CPU reference of the GPU test (packages/ui/test-gpu/reference.ts: corners, culling, alpha
test), which packages/ui/test/reference.test.ts must pin.

    python3 tools/mutate-draw.py [--list] [substring of a mutant name ...]

A mutant that must be killed and survives makes the exit code 1; a mutant with a reason is expected to survive.  The source is restored
after every mutant (also on Ctrl-C), but do not run this with uncommitted edits in the mutated files you cannot afford to lose.  Needs
`bun` in ./node_modules/.bin; the run takes ~2-4 s per mutant, ~1 s for those of slot.ts (960 mutants: 24 minutes on 2 CPUs).  Each run has a
90 s timeout and an 8 GB address-space limit.
"""
import os, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
TESTS = [os.path.join(ROOT, 'packages/ui/test/controldraw.test.ts'), os.path.join(ROOT, 'packages/ui/test/render.test.ts'), os.path.join(ROOT, 'packages/ui/test/stringdraw.test.ts'), os.path.join(ROOT, 'packages/ui/test/comboboxdraw.test.ts'), os.path.join(ROOT, 'packages/ui/test/listboxdraw.test.ts')]
SRC = 'packages/ui/src/'
REFERENCE = 'packages/ui/test-gpu/reference.ts'
REFERENCE_TESTS = [os.path.join(ROOT, 'packages/ui/test/reference.test.ts')]


def path_of(f):
    return os.path.join(ROOT, f if f.startswith('packages/') else SRC + f)


SLOT_TESTS = [os.path.join(ROOT, 'packages/ui/test/slotdraw.test.ts')]


def tests_of(f):
    # the slot is drawn by its own tests only: a mutant of slot.ts needs no other file (a run takes 1 s instead of 4)
    return REFERENCE_TESTS if f == REFERENCE else SLOT_TESTS if f == 'slot.ts' else TESTS

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
 ('scrollbar.ts', 'bar: the time stamp is not kept', '\n    this.m_dArrowTS = now;\n  }', '\n  }', ''),
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
 # a quad without a texture: the diffuse colour alone (stage 0 selects it: the rectangles of the edit boxes)
 (REFERENCE, 'reference: a quad without a texture is sampled all the same', r'if (q.texture) sampleBilinear(', r'if (true) sampleBilinear(', ''),
 (REFERENCE, 'reference: a quad with a texture is flat too', r'if (q.texture) sampleBilinear(', r'if (false) sampleBilinear(', ''),
 (REFERENCE, 'reference: a quad without a texture is black', r'else tex[0] = tex[1] = tex[2] = tex[3] = 1;', r'else tex[0] = tex[1] = tex[2] = tex[3] = 0;', ''),
 (REFERENCE, 'reference: a quad without a texture is transparent', r'else tex[0] = tex[1] = tex[2] = tex[3] = 1;', r'else { tex[0] = tex[1] = tex[2] = 1; tex[3] = 0; }', ''),
 (REFERENCE, 'reference: a quad without a texture has no red', r'else tex[0] = tex[1] = tex[2] = tex[3] = 1;', r'else { tex[0] = 0; tex[1] = tex[2] = tex[3] = 1; }', ''),
 (REFERENCE, 'reference: a quad without a texture has no green', r'else tex[0] = tex[1] = tex[2] = tex[3] = 1;', r'else { tex[1] = 0; tex[0] = tex[2] = tex[3] = 1; }', ''),
 (REFERENCE, 'reference: a quad without a texture has no blue', r'else tex[0] = tex[1] = tex[2] = tex[3] = 1;', r'else { tex[2] = 0; tex[0] = tex[1] = tex[3] = 1; }', ''),
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


# ---- listbox.ts: OnFrameRender (32943BA0): the bounding box, the page size of the bar, the mouse pass, the rows and their strings; input.ts: UIMouse
L = 'listbox.ts'
_PASS = '    if (item.m_bShow && (this.m_dwStyle & 1) === 0 && item.m_iMessageID > -1) {'
_ROWS_HEAD = '    let i = bar.m_nPosition;\n    if (i >= size) return;\n    while (rc.bottom <= this.m_rcText.bottom) {\n      const item = this.m_Items[i]!;\n'
_X = 'f(f(f(mouse.GetXPos()) / (scale ? scale.x : 1)) - dialog.m_Pos.x)'
_Y = 'f(f(f(mouse.GetYPos()) / (scale ? scale.y : 1)) - dialog.m_Pos.y)'
_HIT = 'if (x > f(this.m_rcSelection.left) && right > x && y > f(rc.top) && f(rc.bottom) > y) {'
_HL = 'item.m_bMegaSelect || item.m_bMegaOver || i === this.m_nSelected'
_BOX = 'this.setCorners(bb.left, bb.top, bb.right, bb.bottom);\n    if (this.m_pBoudingBoxTex)'
_FONT = 'const font = this.ctx.fonts.getUKFont(data.fontIndex);\n    if (!font) {\n      this.ctx.messageBox(this.ctx.strings.get(954), this.ctx.strings.get(955));\n      return 0;\n    }'
_PAGE = '        bar.cap();\n        bar.updateThumbRect();\n      }\n      statics.bSBInit_0 = true;'
M += [
 # ---- OnFrameRender
 (L, 'listbox: a hidden box is drawn', '    if (!this.m_bShow) return 0;\n    const data = this.m_pStringData;\n    if (!data) throw', '    const data = this.m_pStringData;\n    if (!data) throw', ''),
 (L, 'listbox: a box without string data goes on', 'if (!data) throw new Error("CKTDGUIListBox::OnFrameRender: no string data (SetString was not called); the exe dereferences null");', 'if (!data) return 0;', ''),
 (L, 'listbox: the font is the first one', _FONT, _FONT.replace('getUKFont(data.fontIndex)', 'getUKFont(0)'), ''),
 (L, 'listbox: the message box has the caption first', _FONT, _FONT.replace('get(954), this.ctx.strings.get(955)', 'get(955), this.ctx.strings.get(954)'), ''),
 (L, 'listbox: a missing font goes on drawing', _FONT, _FONT.replace('      return 0;\n', ''), ''),
 (L, 'listbox: a missing font gives no message box', _FONT, _FONT.replace('      this.ctx.messageBox(this.ctx.strings.get(954), this.ctx.strings.get(955));\n', ''), ''),
 (L, 'listbox: the bounding box starts at its right edge', _BOX, _BOX.replace('(bb.left, bb.top,', '(bb.right, bb.top,'), ''),
 (L, 'listbox: the bounding box starts at its bottom edge', _BOX, _BOX.replace('(bb.left, bb.top,', '(bb.left, bb.bottom,'), ''),
 (L, 'listbox: the bounding box ends at its left edge', _BOX, _BOX.replace(', bb.right, bb.bottom)', ', bb.left, bb.bottom)'), ''),
 (L, 'listbox: the bounding box ends at its top edge', _BOX, _BOX.replace(', bb.right, bb.bottom)', ', bb.right, bb.top)'), ''),
 (L, 'listbox: the bounding box has no texture of its own', 'if (this.m_pBoudingBoxTex) point.pUITextureData = this.m_pBoudingBoxTex;', 'point.pUITextureData = null;', ''),
 (L, 'listbox: a box without a bounding box texture loses the texture of the point', 'if (this.m_pBoudingBoxTex) point.pUITextureData = this.m_pBoudingBoxTex;', 'point.pUITextureData = this.m_pBoudingBoxTex;', ''),
 (L, 'listbox: the bounding box is not drawn', '    this.drawTempPoint();\n    if (this.m_Items.length > 0) this.drawItems(font);', '    if (this.m_Items.length > 0) this.drawItems(font);', ''),
 (L, 'listbox: the quad is drawn twice', 'this.renderVertex(this.m_Vertex, this.m_TempPoint, 1);', 'this.renderVertex(this.m_Vertex, this.m_TempPoint, 2);', ''),
 (L, 'listbox: the quad is not rendered', 'this.renderVertex(this.m_Vertex, this.m_TempPoint, 1);', 'this.renderVertex(this.m_Vertex, this.m_TempPoint, 0);', ''),
 (L, 'listbox: the quad is not updated', '    this.updateVertex(this.m_Vertex, this.m_TempPoint);\n', '', ''),
 (L, 'listbox: an empty box draws rows', 'if (this.m_Items.length > 0) this.drawItems(font);', 'if (this.m_Items.length >= 0) this.drawItems(font);', ''),
 (L, 'listbox: a box of one row draws none', 'if (this.m_Items.length > 0) this.drawItems(font);', 'if (this.m_Items.length > 1) this.drawItems(font);', ''),
 (L, 'listbox: the bar is drawn before the rows', '    if (this.m_Items.length > 0) this.drawItems(font);\n    this.m_pScrollBar?.onFrameRender();', '    this.m_pScrollBar?.onFrameRender();\n    if (this.m_Items.length > 0) this.drawItems(font);', ''),
 (L, 'listbox: the bar is drawn with rows only', '    if (this.m_Items.length > 0) this.drawItems(font);\n    this.m_pScrollBar?.onFrameRender();', '    if (this.m_Items.length > 0) { this.drawItems(font); this.m_pScrollBar?.onFrameRender(); }', ''),
 (L, 'listbox: the bar is not drawn', '    this.m_pScrollBar?.onFrameRender();\n    return 0;', '    return 0;', ''),
 # ---- drawItems: the row height, the page size of the bar (once), the position, the two passes
 (L, 'list items: a static box is taken for a text box', 'if (!this.m_bIsStaticListBox) {\n      rc.bottom = (rc.top + font.lineHeight()) | 0;', 'if (this.m_bIsStaticListBox) {\n      rc.bottom = (rc.top + font.lineHeight()) | 0;', ''),
 (L, 'list items: the row height is not kept', '      this.m_nTextHeight = (rc.bottom - rc.top) | 0;\n', '', ''),
 (L, 'list items: the row height is the line of the box font', 'rc.bottom = (rc.top + font.lineHeight()) | 0;\n      this.m_nTextHeight', 'rc.bottom = (rc.top + (this.m_pUKFont ? this.m_pUKFont.lineHeight() : 1)) | 0;\n      this.m_nTextHeight', ''),
 (L, 'list items: the row height has an extra pixel', 'rc.bottom = (rc.top + font.lineHeight()) | 0;\n      this.m_nTextHeight', 'rc.bottom = (rc.top + font.lineHeight() + 1) | 0;\n      this.m_nTextHeight', ''),
 (L, 'list items: a static box has the line of the font', '    } else {\n      rc.bottom = (rc.top + this.m_nTextHeight) | 0;\n    }', '    } else {\n      rc.bottom = (rc.top + font.lineHeight()) | 0;\n    }', ''),
 (L, 'list items: the page size is made for every box', 'if (!statics.bSBInit_0) {\n      if (bar) {', 'if (true) {\n      if (bar) {', ''),
 (L, 'list items: the page size is never made', 'if (!statics.bSBInit_0) {\n      if (bar) {', 'if (false) {\n      if (bar) {', ''),
 (L, 'list items: the page size is made by the second box', 'if (!statics.bSBInit_0) {\n      if (bar) {', 'if (statics.bSBInit_0) {\n      if (bar) {', ''),
 (L, 'list items: the first-box rule is not used up', '      statics.bSBInit_0 = true;\n    }\n    if (!bar) return;', '    }\n    if (!bar) return;', ''),
 (L, 'list items: only a box with a bar uses the rule up', '        bar.updateThumbRect();\n      }\n      statics.bSBInit_0 = true;', '        bar.updateThumbRect();\n        statics.bSBInit_0 = true;\n      }', ''),
 (L, 'list items: the height of the page is counted from the origin', 'const height = (text.bottom - text.top) | 0;', 'const height = text.bottom | 0;', ''),
 (L, 'list items: the height of the page is the box height', 'const height = (text.bottom - text.top) | 0;', 'const height = this.m_height | 0;', ''),
 (L, 'list items: the page is the row height over the height', 'idiv(height, this.m_nTextHeight)', 'idiv(this.m_nTextHeight, height)', ''),
 (L, 'list items: the page is rounded', 'idiv(height, this.m_nTextHeight)', 'Math.round(height / this.m_nTextHeight)', ''),
 (L, 'list items: the page is rounded up', 'idiv(height, this.m_nTextHeight)', 'Math.ceil(height / this.m_nTextHeight)', ''),
 (L, 'list items: a row height of 0 is taken as a height', 'this.m_nTextHeight !== 0 ? idiv(height, this.m_nTextHeight) : height', 'this.m_nTextHeight === 0 ? idiv(height, this.m_nTextHeight) : height', ''),
 (L, 'list items: a row height of 0 gives a page of 1', ': height;\n        bar.cap();', ': 1;\n        bar.cap();', ''),
 (L, 'list items: the page is not capped', _PAGE, _PAGE.replace('        bar.cap();\n', ''), ''),
 (L, 'list items: the thumb is not made after the page', _PAGE, _PAGE.replace('        bar.updateThumbRect();\n', ''), ''),
 (L, 'list items: a box without a bar goes on', '    if (!bar) return;\n    if (bar.m_nPosition < 0)', '    if (bar.m_nPosition < 0)', ''),
 (L, 'list items: a position of 0 is set again', 'if (bar.m_nPosition < 0) bar.setTrackPos(0);', 'if (bar.m_nPosition <= 0) bar.setTrackPos(0);', ''),
 (L, 'list items: a position of -1 is left', 'if (bar.m_nPosition < 0) bar.setTrackPos(0);', 'if (bar.m_nPosition < -1) bar.setTrackPos(0);', ''),
 (L, 'list items: a negative position is not set', 'if (bar.m_nPosition < 0) bar.setTrackPos(0);', '', ''),
 (L, 'list items: a negative position is set without the thumb', 'bar.setTrackPos(0);', 'bar.m_nPosition = 0;', ''),
 (L, 'list items: a negative position is set to 1', 'bar.setTrackPos(0);', 'bar.setTrackPos(1);', ''),
 (L, 'list items: the mouse pass is skipped', '    this.updateMegaOver(bar, rectOf(rc));\n', '', ''),
 (L, 'list items: the mouse pass is after the rows', '    this.updateMegaOver(bar, rectOf(rc));\n    this.drawRows(bar, rectOf(text), font);', '    this.drawRows(bar, rectOf(text), font);\n    this.updateMegaOver(bar, rectOf(rc));', ''),
 (L, 'list items: the rows are not drawn', '    this.drawRows(bar, rectOf(text), font);\n', '', ''),
 (L, 'list items: the rows move the text rectangle', 'this.drawRows(bar, rectOf(text), font);', 'this.drawRows(bar, text, font);', ''),
 (L, 'list items: the mouse pass keeps its rectangle', 'this.updateMegaOver(bar, rectOf(rc));', 'this.updateMegaOver(bar, rc);', 'rc is not used after the pass'),
 # ---- updateMegaOver: the mouse over a row with a message id
 (L, 'list mouse: a position past the rows is visited', _ROWS_HEAD + '      if (item.m_bShow && (this.m_dwStyle', _ROWS_HEAD.replace('    if (i >= size) return;\n', '') + '      if (item.m_bShow && (this.m_dwStyle', ''),
 (L, 'list mouse: the pass stops at a row that ends at the text bottom', 'while (rc.bottom <= this.m_rcText.bottom) {\n      const item = this.m_Items[i]!;\n      if (item.m_bShow && (this.m_dwStyle', 'while (rc.bottom < this.m_rcText.bottom) {\n      const item = this.m_Items[i]!;\n      if (item.m_bShow && (this.m_dwStyle', ''),
 (L, 'list mouse: a hidden row is visited', _PASS, _PASS.replace('item.m_bShow && ', ''), ''),
 (L, 'list mouse: a multi selection is visited', _PASS, _PASS.replace(' && (this.m_dwStyle & 1) === 0', ''), ''),
 (L, 'list mouse: only a multi selection is visited', _PASS, _PASS.replace('=== 0', '!== 0'), ''),
 (L, 'list mouse: a row without a message id is visited', _PASS, _PASS.replace(' && item.m_iMessageID > -1', ''), ''),
 (L, 'list mouse: the message id 0 is none', _PASS, _PASS.replace('> -1', '> 0'), ''),
 (L, 'list mouse: the message id -1 is one', _PASS, _PASS.replace('> -1', '> -2'), ''),
 (L, 'list mouse: x is not divided by the scale', _X, 'f(f(f(mouse.GetXPos())) - dialog.m_Pos.x)', ''),
 (L, 'list mouse: x is divided by the y scale', _X, _X.replace('scale.x', 'scale.y'), ''),
 (L, 'list mouse: x is the y of the mouse', _X, _X.replace('GetXPos', 'GetYPos'), ''),
 (L, 'list mouse: the dialog is not taken off x', _X, 'f(f(f(mouse.GetXPos()) / (scale ? scale.x : 1)))', ''),
 (L, 'list mouse: the dialog y is taken off x', _X, _X.replace('m_Pos.x', 'm_Pos.y'), ''),
 (L, 'list mouse: without a device x is scaled by 0', _X, _X.replace(': 1)', ': 0)'), ''),
 (L, 'list mouse: y is not divided by the scale', _Y, 'f(f(f(mouse.GetYPos())) - dialog.m_Pos.y)', ''),
 (L, 'list mouse: y is divided by the x scale', _Y, _Y.replace('scale.y', 'scale.x'), ''),
 (L, 'list mouse: y is the x of the mouse', _Y, _Y.replace('GetYPos', 'GetXPos'), ''),
 (L, 'list mouse: the dialog is not taken off y', _Y, 'f(f(f(mouse.GetYPos()) / (scale ? scale.y : 1)))', ''),
 (L, 'list mouse: the dialog x is taken off y', _Y, _Y.replace('m_Pos.y', 'm_Pos.x'), ''),
 (L, 'list mouse: without a device y is scaled by 0', _Y, _Y.replace(': 1)', ': 0)'), ''),
 (L, 'list mouse: the right side is the width alone', 'const right = f(f(this.m_width) + this.getPos().x);\n        if (x > f', 'const right = f(this.m_width);\n        if (x > f', ''),
 (L, 'list mouse: the right side is the width and y', 'const right = f(f(this.m_width) + this.getPos().x);\n        if (x > f', 'const right = f(f(this.m_width) + this.getPos().y);\n        if (x > f', ''),
 (L, 'list mouse: the right side is the height', 'const right = f(f(this.m_width) + this.getPos().x);\n        if (x > f', 'const right = f(f(this.m_height) + this.getPos().x);\n        if (x > f', ''),
 (L, 'list mouse: the left side is the box edge', _HIT, _HIT.replace('this.m_rcSelection.left', 'this.m_rcText.left'), ''),
 (L, 'list mouse: the left side is the selection right', _HIT, _HIT.replace('this.m_rcSelection.left', 'this.m_rcSelection.right'), ''),
 (L, 'list mouse: the left side counts', _HIT, _HIT.replace('x > f(', 'x >= f('), ''),
 (L, 'list mouse: the right side counts', _HIT, _HIT.replace('right > x', 'right >= x'), ''),
 (L, 'list mouse: the top counts', _HIT, _HIT.replace('y > f(rc.top)', 'y >= f(rc.top)'), ''),
 (L, 'list mouse: the bottom counts', _HIT, _HIT.replace('f(rc.bottom) > y', 'f(rc.bottom) >= y'), ''),
 (L, 'list mouse: the left side is not tested', _HIT, _HIT.replace('x > f(this.m_rcSelection.left) && ', ''), ''),
 (L, 'list mouse: the right side is not tested', _HIT, _HIT.replace('right > x && ', ''), ''),
 (L, 'list mouse: the top is not tested', _HIT, _HIT.replace('y > f(rc.top) && ', ''), ''),
 (L, 'list mouse: the bottom is not tested', _HIT, _HIT.replace(' && f(rc.bottom) > y', ''), ''),
 (L, 'list mouse: the hit starts at the first row', 'for (let j = bar.m_nPosition; j < this.m_Items.length; j++) {', 'for (let j = 0; j < this.m_Items.length; j++) {', ''),
 (L, 'list mouse: the hit stops one row early', 'for (let j = bar.m_nPosition; j < this.m_Items.length; j++) {', 'for (let j = bar.m_nPosition; j < this.m_Items.length - 1; j++) {', ''),
 (L, 'list mouse: the hit takes the sender own rows', 'other.m_bMegaOver = id === other.m_iMessageID && !other.m_bMyMessage;', 'other.m_bMegaOver = id === other.m_iMessageID;', ''),
 (L, 'list mouse: the hit takes only the sender own rows', 'other.m_bMegaOver = id === other.m_iMessageID && !other.m_bMyMessage;', 'other.m_bMegaOver = id === other.m_iMessageID && other.m_bMyMessage;', ''),
 (L, 'list mouse: the hit takes the rows of other ids', 'other.m_bMegaOver = id === other.m_iMessageID && !other.m_bMyMessage;', 'other.m_bMegaOver = id !== other.m_iMessageID && !other.m_bMyMessage;', ''),
 (L, 'list mouse: the hit takes every row', 'other.m_bMegaOver = id === other.m_iMessageID && !other.m_bMyMessage;', 'other.m_bMegaOver = !other.m_bMyMessage;', ''),
 (L, 'list mouse: the hit does not end the pass', '          break;\n        }\n        item.m_bMegaOver = false;', '        } else {\n        item.m_bMegaOver = false;\n        }', ''),
 (L, 'list mouse: a row that is not hit keeps the flag', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);', '      }\n      offsetRect(rc, 0, this.m_nTextHeight);', ''),
 (L, 'list mouse: a row that is not hit gets the flag', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);', '        item.m_bMegaOver = true;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);', ''),
 (L, 'list mouse: the next row is a pixel lower', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight + 1);', ''),
 (L, 'list mouse: the next row is at the side', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, this.m_nTextHeight, 0);', ''),
 (L, 'list mouse: the pass goes past the last row', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);\n      if (++i >= size) break;', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);\n      if (++i > size) break;', ''),
 (L, 'list mouse: the pass has no end but the rectangle', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);\n      if (++i >= size) break;', '        item.m_bMegaOver = false;\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);\n      ++i;', ''),
]
_DRAW_HEAD = '    let i = bar.m_nPosition;\n    if (i >= size) return;\n    while (rc.bottom <= this.m_rcText.bottom) {\n      const item = this.m_Items[i]!;\n      if (item.m_bShow) {\n'
_HLINE = '(this.m_dwStyle & 1) === 0 ? item.m_bMegaSelect || item.m_bMegaOver || i === this.m_nSelected : this.multiSelected(i, item);'
_CORNERS = 'this.setCorners(left, rc.top, selectionRight, rc.bottom)'
_MEGA = 'if (item.m_bMegaSelect || item.m_bMegaOver) {\n                const right = f(f(this.m_width) + this.getPos().x);\n'
_OVER = 'if (this.m_pButtonMouseOverTex && item.m_bMegaOver && !item.m_bMegaSelect) point.pUITextureData = this.m_pButtonMouseOverTex;'
_ADV = '        }\n      }\n      offsetRect(rc, 0, this.m_nTextHeight);\n      if (++i >= size) break;'
M += [
 # ---- drawRows
 (L, 'list rows: a static box has the line of the font', 'rc.bottom = this.m_bIsStaticListBox ? (rc.top + this.m_nTextHeight) | 0 : (rc.top + font.lineHeight()) | 0;', 'rc.bottom = (rc.top + font.lineHeight()) | 0;', ''),
 (L, 'list rows: a text box has the row height of the box', 'rc.bottom = this.m_bIsStaticListBox ? (rc.top + this.m_nTextHeight) | 0 : (rc.top + font.lineHeight()) | 0;', 'rc.bottom = (rc.top + this.m_nTextHeight) | 0;', 'drawItems has just set m_nTextHeight to the line of the font for a box that is not static'),
 (L, 'list rows: a position past the rows draws a row', _DRAW_HEAD, _DRAW_HEAD.replace('    if (i >= size) return;\n', ''), ''),
 (L, 'list rows: a row that ends at the text bottom is not drawn', _DRAW_HEAD, _DRAW_HEAD.replace('rc.bottom <= this', 'rc.bottom < this'), ''),
 (L, 'list rows: a hidden row is drawn', _DRAW_HEAD, _DRAW_HEAD.replace('if (item.m_bShow) {', 'if (true) {'), ''),
 (L, 'list rows: a shown row is not drawn', _DRAW_HEAD, _DRAW_HEAD.replace('if (item.m_bShow) {', 'if (!item.m_bShow) {'), ''),
 (L, 'list rows: a multi selection is highlighted as a single box', _HLINE, _HLINE.replace(': this.multiSelected(i, item);', ': ' + _HL + ';'), ''),
 (L, 'list rows: a single box is highlighted as a multi selection', _HLINE, _HLINE.replace('=== 0 ?', '!== 0 ?'), ''),
 (L, 'list rows: m_bMegaSelect does not highlight', _HLINE, _HLINE.replace('item.m_bMegaSelect || ', ''), ''),
 (L, 'list rows: m_bMegaOver does not highlight', _HLINE, _HLINE.replace('item.m_bMegaOver || ', ''), ''),
 (L, 'list rows: the selected row is not highlighted', _HLINE, _HLINE.replace(' || i === this.m_nSelected', ''), ''),
 (L, 'list rows: the rows but the selected are highlighted', _HLINE, _HLINE.replace('i === this.m_nSelected', 'i !== this.m_nSelected'), ''),
 (L, 'list rows: the row above the selected is highlighted', _HLINE, _HLINE.replace('i === this.m_nSelected', 'i === this.m_nSelected - 1'), ''),
 (L, 'list rows: a plain static row is at the selection left', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, rc.top);', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, left, rc.top);', ''),
 (L, 'list rows: a plain static row is at the row bottom', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, rc.top);', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, rc.bottom);', ''),
 (L, 'list rows: a plain static row is at the text top', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, rc.top);', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, this.m_rcText.top);', ''),
 (L, 'list rows: a plain static row draws its text too', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, rc.top);\n          else if', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, rc.top);\n          if', ''),
 (L, 'list rows: a plain text row is a static row', 'if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, rc.top);', 'if (false) this.drawRowControl(item, rc.left, rc.top);', ''),
 (L, 'list rows: the right edge is not widened', '          selectionRight = (selectionRight + bar.m_width) | 0;', '          selectionRight = selectionRight | 0;', ''),
 (L, 'list rows: the right edge is widened by the width of the box bar', 'selectionRight = (selectionRight + bar.m_width) | 0;', 'selectionRight = (selectionRight + this.m_nSBWidth) | 0;', ''),
 (L, 'list rows: the right edge is widened from the selection right', 'selectionRight = (selectionRight + bar.m_width) | 0;', 'selectionRight = (this.m_rcSelection.right + bar.m_width) | 0;', ''),
 (L, 'list rows: the right edge is widened by a pixel too much', 'selectionRight = (selectionRight + bar.m_width) | 0;', 'selectionRight = (selectionRight + bar.m_width + 1) | 0;', ''),
 (L, 'list rows: a plain row widens the right edge', '        if (!highlighted) {\n          if (this.m_bIsStaticListBox)', '        if (!highlighted) {\n          selectionRight = (selectionRight + bar.m_width) | 0;\n          if (this.m_bIsStaticListBox)', ''),
 (L, 'list rows: a highlighted static row is at the row left', 'this.drawRowControl(item, left, rc.top);', 'this.drawRowControl(item, rc.left, rc.top);', ''),
 (L, 'list rows: a highlighted static row is at the selection top', 'this.drawRowControl(item, left, rc.top);', 'this.drawRowControl(item, left, this.m_rcSelection.top);', ''),
 (L, 'list rows: a highlighted static row has a quad', '          if (this.m_bIsStaticListBox) {\n            this.drawRowControl(item, left, rc.top);\n          } else {', '          if (this.m_bIsStaticListBox) {\n            this.drawRowControl(item, left, rc.top);\n          }\n          {', ''),
 (L, 'list rows: the type is compared as a signed number', 'item.itemType >>> 0 <= LBIT.NOT_ENABLE', 'item.itemType <= LBIT.NOT_ENABLE', ''),
 (L, 'list rows: a NOT_ENABLE row has no quad', 'item.itemType >>> 0 <= LBIT.NOT_ENABLE', 'item.itemType >>> 0 < LBIT.NOT_ENABLE', ''),
 (L, 'list rows: a group row has a quad', 'item.itemType >>> 0 <= LBIT.NOT_ENABLE', 'item.itemType >>> 0 <= LBIT.GROUP_PLUS', ''),
 (L, 'list rows: a DEFAULT row has the quad of the group', 'item.itemType >>> 0 <= LBIT.NOT_ENABLE', 'item.itemType >>> 0 === LBIT.NOT_ENABLE', ''),
 (L, 'list rows: the quad is drawn without m_bShowTextTex', ' && this.m_bShowTextTex) {', ') {', ''),
 (L, 'list rows: the quad is drawn only without m_bShowTextTex', ' && this.m_bShowTextTex) {', ' && !this.m_bShowTextTex) {', ''),
 (L, 'list rows: the quad starts at the row left', _CORNERS, _CORNERS.replace('(left,', '(rc.left,'), ''),
 (L, 'list rows: the quad starts at the text top', _CORNERS, _CORNERS.replace('rc.top,', 'this.m_rcText.top,'), ''),
 (L, 'list rows: the quad starts at the row bottom', _CORNERS, _CORNERS.replace('rc.top,', 'rc.bottom,'), ''),
 (L, 'list rows: the quad ends at the text bottom', _CORNERS, _CORNERS.replace(', rc.bottom)', ', this.m_rcText.bottom)'), ''),
 (L, 'list rows: the quad ends at the row top', _CORNERS, _CORNERS.replace(', rc.bottom)', ', rc.top)'), ''),
 (L, 'list rows: the quad ends at the selection right', _CORNERS, _CORNERS.replace('selectionRight', 'this.m_rcSelection.right'), ''),
 (L, 'list rows: a mega row does not reach the box right', _MEGA, _MEGA.replace('if (item.m_bMegaSelect || item.m_bMegaOver) {', 'if (false) {'), ''),
 (L, 'list rows: a megaSelect row does not reach the box right', _MEGA, _MEGA.replace('item.m_bMegaSelect || ', ''), ''),
 (L, 'list rows: a megaOver row does not reach the box right', _MEGA, _MEGA.replace(' || item.m_bMegaOver', ''), ''),
 (L, 'list rows: the box right is the width alone', _MEGA, _MEGA.replace('f(f(this.m_width) + this.getPos().x)', 'f(this.m_width)'), ''),
 (L, 'list rows: the box right is counted from y', _MEGA, _MEGA.replace('getPos().x', 'getPos().y'), ''),
 (L, 'list rows: the right top corner stays', '                point.rightTopPoint.x = right;\n', '', ''),
 (L, 'list rows: the right bottom corner stays', '                point.rightBottomPoint.x = right;\n', '', ''),
 (L, 'list rows: the right top corner is moved down', '                point.rightTopPoint.x = right;\n', '                point.rightTopPoint.y = right;\n', ''),
 (L, 'list rows: the quad keeps the texture of the last', 'if (this.m_pTextTex) point.pUITextureData = this.m_pTextTex;', 'point.pUITextureData = this.m_pTextTex;', ''),
 (L, 'list rows: the quad has no text texture', 'if (this.m_pTextTex) point.pUITextureData = this.m_pTextTex;', '', ''),
 (L, 'list rows: the over texture is for a row that is selected too', _OVER, _OVER.replace(' && !item.m_bMegaSelect', ''), ''),
 (L, 'list rows: the over texture is for a row that is not over', _OVER, _OVER.replace(' && item.m_bMegaOver', ''), ''),
 (L, 'list rows: the over texture is for a row that is only selected', _OVER, _OVER.replace('item.m_bMegaOver && !item.m_bMegaSelect', 'item.m_bMegaSelect'), ''),
 (L, 'list rows: the over texture is set when there is none', _OVER, _OVER.replace('this.m_pButtonMouseOverTex && ', ''), ''),
 (L, 'list rows: the quad is not drawn', '              this.drawTempPoint();\n            }\n            if (this.m_pStringData) this.drawRowString(item, rc);', '            }\n            if (this.m_pStringData) this.drawRowString(item, rc);', ''),
 (L, 'list rows: the text is drawn before the quad', '              this.drawTempPoint();\n            }\n            if (this.m_pStringData) this.drawRowString(item, rc);', '              if (this.m_pStringData) this.drawRowString(item, rc);\n              this.drawTempPoint();\n            }', ''),
 (L, 'list rows: the text of a highlighted row is not drawn', '            }\n            if (this.m_pStringData) this.drawRowString(item, rc);\n          }', '            }\n          }', ''),
 (L, 'list rows: the text of a plain row is not drawn', 'else if (this.m_pStringData) this.drawRowString(item, rc);', '', ''),
 (L, 'list rows: a plain row draws its text without string data', 'else if (this.m_pStringData) this.drawRowString(item, rc);', 'else this.drawRowString(item, rc);', 'm_pStringData is dereferenced at the top of OnFrameRender (a box without it throws), so the check is always true'),
 (L, 'list rows: a highlighted row draws its text without string data', '            if (this.m_pStringData) this.drawRowString(item, rc);\n          }\n        }', '            this.drawRowString(item, rc);\n          }\n        }', 'm_pStringData is dereferenced at the top of OnFrameRender (a box without it throws), so the check is always true'),
 (L, 'list rows: the next row is a pixel lower', _ADV, _ADV.replace('this.m_nTextHeight)', 'this.m_nTextHeight + 1)'), ''),
 (L, 'list rows: the next row is at the side', _ADV, _ADV.replace('(rc, 0, this.m_nTextHeight)', '(rc, this.m_nTextHeight, 0)'), ''),
 (L, 'list rows: the next row is the height of the font', _ADV, _ADV.replace('this.m_nTextHeight)', 'font.lineHeight())'), ''),
 (L, 'list rows: the rows go past the last', _ADV, _ADV.replace('++i >= size', '++i > size'), ''),
 (L, 'list rows: the rows end at the rectangle only', _ADV, _ADV.replace('if (++i >= size) break;', '++i;'), ''),
 # ---- a row of a static box
 (L, 'list control: a row without a control is drawn', 'if (!control) return;\n    control.setOffsetPos', 'control.setOffsetPos', ''),
 (L, 'list control: the control is put at y, x', 'control.setOffsetPos(new Vec2(x, y));', 'control.setOffsetPos(new Vec2(y, x));', ''),
 (L, 'list control: the control is not put anywhere', '    control.setOffsetPos(new Vec2(x, y));\n', '', ''),
 (L, 'list control: the control is not drawn', '    control.onFrameRender();\n  }', '  }', ''),
 (L, 'list control: the control is drawn before it is put', '    control.setOffsetPos(new Vec2(x, y));\n    control.onFrameRender();', '    control.onFrameRender();\n    control.setOffsetPos(new Vec2(x, y));', ''),
]
_SPREAD = 'const text = item.bSpread ? item.strText.slice(0, (item.strText.length >>> 0) < (item.iSpreadCount >>> 0) ? item.strText.length : item.iSpreadCount) : item.strText;'
_PLAIN_CALL = 'this.m_pUKFont?.OutTextMultiline((ftoi(x) + depth) | 0, ftoi(y), text, packColor(color), data.fontStyle, packColor(outline), LINE_SPACE, null, 0, -1, 1, 1);'
_GROUP_CALL = 'this.m_pGroupUKFont?.OutTextMultiline((ftoi(x) + depth + this.m_BlankWidthToGroupMark) | 0, ftoi(y), text, packColor(color), g.fontStyle, packColor(outline), LINE_SPACE, null, 0, -1, 1, 1);'
_OFFSET = 'mark.setOffsetPos(new Vec2(f(f(depth) + f(f(rc.left) + this.m_GroupMarkOffsetPos.x)), f(f(rc.top) + this.m_GroupMarkOffsetPos.y)));'
_ALPHA = 'const alpha = f(f(type !== 0 ? f(f(s.a * 0.5) * d.a) : f(d.a * s.a)) * c.a);'
M += [
 # ---- the text of a row
 (L, 'list string: the text is at the place of the string data', 'stringPosition(dialog, this, data, { x: rc.left, y: rc.top });', 'stringPosition(dialog, this, data);', ''),
 (L, 'list string: the text is at the top and left of the row', '{ x: rc.left, y: rc.top }', '{ x: rc.top, y: rc.left }', ''),
 (L, 'list string: the text is at the bottom of the row', '{ x: rc.left, y: rc.top }', '{ x: rc.left, y: rc.bottom }', ''),
 (L, 'list string: the depth is added to the width', 'Math.imul(item.itemDepth, this.m_BlankWidthByDepth)', '(item.itemDepth + this.m_BlankWidthByDepth) | 0', ''),
 (L, 'list string: the depth is counted by the width of the mark', 'Math.imul(item.itemDepth, this.m_BlankWidthByDepth)', 'Math.imul(item.itemDepth, this.m_BlankWidthToGroupMark)', ''),
 (L, 'list string: the type is a signed number', 'const type = item.itemType >>> 0;', 'const type = item.itemType | 0;', ''),
 (L, 'list string: a spreading row shows everything', _SPREAD, _SPREAD.replace('item.bSpread ?', 'false ?'), ''),
 (L, 'list string: every row spreads', _SPREAD, _SPREAD.replace('item.bSpread ?', 'true ?'), ''),
 (L, 'list string: the count is a signed number', _SPREAD, _SPREAD.replace('(item.iSpreadCount >>> 0)', 'item.iSpreadCount'), ''),
 (L, 'list string: the length is a signed number', _SPREAD, _SPREAD.replace('(item.strText.length >>> 0)', 'item.strText.length'), 'the length of a string is never negative: the unsigned cast of it changes nothing'),
 (L, 'list string: a count above the length shows the count', _SPREAD, _SPREAD.replace('? item.strText.length : item.iSpreadCount', '? item.iSpreadCount : item.strText.length'), ''),
 (L, 'list string: a count equal to the length is a count', _SPREAD, _SPREAD.replace(' < (item.iSpreadCount', ' <= (item.iSpreadCount'), 'both branches give the same number when the length and the count are equal'),
 (L, 'list string: the count is compared the other way', _SPREAD, _SPREAD.replace(' < (item.iSpreadCount', ' > (item.iSpreadCount'), ''),
 (L, 'list string: a group row is drawn as a plain row', 'if (type < 2) {', 'if (type <= 2) {', ''),
 (L, 'list string: a NOT_ENABLE row is a group row', 'if (type < 2) {', 'if (type < 1) {', ''),
 (L, 'list string: GROUP_MINUS is no group row', 'else if (type === 2 || type === 3) {', 'else if (type === 2) {', ''),
 (L, 'list string: GROUP_PLUS is no group row', 'else if (type === 2 || type === 3) {', 'else if (type === 3) {', ''),
 (L, 'list string: every larger type is a group row', 'else if (type === 2 || type === 3) {', 'else if (type >= 2) {', ''),
 (L, 'list string: the alpha of NOT_ENABLE is not halved', _ALPHA, _ALPHA.replace('type !== 0 ? f(f(s.a * 0.5) * d.a) : ', ''), ''),
 (L, 'list string: the alpha of DEFAULT is halved', _ALPHA, _ALPHA.replace('type !== 0 ?', 'true ?'), ''),
 (L, 'list string: the alpha is a quarter for NOT_ENABLE', _ALPHA, _ALPHA.replace('s.a * 0.5', 's.a * 0.25'), ''),
 (L, 'list string: the alpha of NOT_ENABLE ignores the dialog', _ALPHA, _ALPHA.replace('f(f(s.a * 0.5) * d.a)', 'f(s.a * 0.5)'), ''),
 (L, 'list string: the alpha of DEFAULT ignores the dialog', _ALPHA, _ALPHA.replace('f(d.a * s.a)', 's.a'), ''),
 (L, 'list string: the alpha of DEFAULT ignores the string', _ALPHA, _ALPHA.replace('f(d.a * s.a)', 'd.a'), ''),
 (L, 'list string: the alpha ignores the box', _ALPHA, _ALPHA.replace('f(f(type', 'f(type').replace(') * c.a);', ');'), ''),
 (L, 'list string: the alpha is the colour of the row', 'a: alpha,', 'a: own ? item.m_color.a : alpha,', ''),
 (L, 'list string: the colour of the row is never used', 'const own = item.m_bColor;', 'const own = false;', ''),
 (L, 'list string: the colour of the row is always used', 'const own = item.m_bColor;', 'const own = true;', ''),
 (L, 'list string: the own red is the green', 'r: own ? item.m_color.r :', 'r: own ? item.m_color.g :', ''),
 (L, 'list string: the own green is the blue', 'g: own ? item.m_color.g :', 'g: own ? item.m_color.b :', ''),
 (L, 'list string: the own blue is the red', 'b: own ? item.m_color.b :', 'b: own ? item.m_color.r :', ''),
 (L, 'list string: the call has the place of the string data', _PLAIN_CALL, _PLAIN_CALL.replace('(ftoi(x) + depth) | 0', 'ftoi(x) | 0'), ''),
 (L, 'list string: the depth is taken off', _PLAIN_CALL, _PLAIN_CALL.replace('ftoi(x) + depth', 'ftoi(x) - depth'), ''),
 (L, 'list string: y is not cut to a pixel', _PLAIN_CALL, _PLAIN_CALL.replace('ftoi(y)', 'y'), ''),
 (L, 'list string: x is not cut to a pixel', _PLAIN_CALL, _PLAIN_CALL.replace('ftoi(x)', 'x'), ''),
 (L, 'list string: the style is 0', _PLAIN_CALL, _PLAIN_CALL.replace('data.fontStyle', '0'), ''),
 (L, 'list string: the colours are swapped', _PLAIN_CALL, _PLAIN_CALL.replace('packColor(color), data.fontStyle, packColor(outline)', 'packColor(outline), data.fontStyle, packColor(color)'), ''),
 (L, 'list string: the line space is 1', _PLAIN_CALL, _PLAIN_CALL.replace('LINE_SPACE', '1'), ''),
 (L, 'list string: the alignment is the one of the data', _PLAIN_CALL, _PLAIN_CALL.replace('null, 0, -1', 'null, data.sortFlag, -1'), ''),
 (L, 'list string: the count of characters is 0', _PLAIN_CALL, _PLAIN_CALL.replace('0, -1, 1, 1', '0, 0, 1, 1'), ''),
 (L, 'list string: the text is drawn by the group font', _PLAIN_CALL, _PLAIN_CALL.replace('this.m_pUKFont?.', 'this.m_pGroupUKFont?.'), ''),
 (L, 'list string: the text of a plain row ignores the spread', _PLAIN_CALL, _PLAIN_CALL.replace(', text,', ', item.strText,'), ''),
 # ---- a group row
 (L, 'list group: a row without group string data goes on', 'if (!g) throw new Error("CKTDGUIListBox::OnFrameRender: a group row without group string data (SetGroupString was not called); the exe dereferences null");', 'if (!g) return;', ''),
 (L, 'list group: the colour is the one of the plain string data', 'const s = g.color, o = g.outlineColor;', 'const s = data.color, o = data.outlineColor;', ''),
 (L, 'list group: the plus mark is on the minus group', 'const plus = item.itemType === LBIT.GROUP_PLUS;', 'const plus = item.itemType === LBIT.GROUP_MINUS;', ''),
 (L, 'list group: the plus picture is the minus', 'mark.GetPicture(0)!.bShow = plus;', 'mark.GetPicture(0)!.bShow = !plus;', ''),
 (L, 'list group: the minus picture is the plus', 'mark.GetPicture(1)!.bShow = !plus;', 'mark.GetPicture(1)!.bShow = plus;', ''),
 (L, 'list group: the plus picture is not shown', 'mark.GetPicture(0)!.bShow = plus;\n', '', ''),
 (L, 'list group: the minus picture is not shown', 'mark.GetPicture(1)!.bShow = !plus;\n', '', ''),
 (L, 'list group: the mark is at the depth in x only', _OFFSET, _OFFSET.replace('f(depth) + ', ''), ''),
 (L, 'list group: the mark ignores the offset in x', _OFFSET, _OFFSET.replace('f(f(rc.left) + this.m_GroupMarkOffsetPos.x)', 'f(rc.left)'), ''),
 (L, 'list group: the mark ignores the offset in y', _OFFSET, _OFFSET.replace('f(f(rc.top) + this.m_GroupMarkOffsetPos.y)', 'f(rc.top)'), ''),
 (L, 'list group: the mark takes the y of the offset for x', _OFFSET, _OFFSET.replace('m_GroupMarkOffsetPos.x', 'm_GroupMarkOffsetPos.y'), ''),
 (L, 'list group: the mark takes the x of the offset for y', _OFFSET, _OFFSET.replace('m_GroupMarkOffsetPos.y', 'm_GroupMarkOffsetPos.x'), ''),
 (L, 'list group: the mark is at the top of the box', _OFFSET, _OFFSET.replace('f(rc.top)', 'f(this.m_rcText.top)'), ''),
 (L, 'list group: the mark is at the left of the box', _OFFSET, _OFFSET.replace('f(rc.left)', 'f(this.m_rcText.left)'), 'the left of every row is the left of the text rectangle (the rows only move down)'),
 (L, 'list group: the mark is at the bottom of the row', _OFFSET, _OFFSET.replace('f(rc.top)', 'f(rc.bottom)'), ''),
 (L, 'list group: the mark is not drawn', '      mark.onFrameRender();\n', '', ''),
 (L, 'list group: the mark is drawn after the text', '      mark.onFrameRender();\n      ' + _GROUP_CALL, '      ' + _GROUP_CALL + '\n      mark.onFrameRender();', ''),
 (L, 'list group: the text is at the depth only', _GROUP_CALL, _GROUP_CALL.replace(' + this.m_BlankWidthToGroupMark', ''), ''),
 (L, 'list group: the text is at the mark only', _GROUP_CALL, _GROUP_CALL.replace('ftoi(x) + depth + ', 'ftoi(x) + '), ''),
 (L, 'list group: the text is at the mark by the depth blank', _GROUP_CALL, _GROUP_CALL.replace('m_BlankWidthToGroupMark', 'm_BlankWidthByDepth'), ''),
 (L, 'list group: the text has the style of the plain data', _GROUP_CALL, _GROUP_CALL.replace('g.fontStyle', 'data.fontStyle'), ''),
 (L, 'list group: the text is drawn by the font of the plain rows', _GROUP_CALL, _GROUP_CALL.replace('this.m_pGroupUKFont?.', 'this.m_pUKFont?.'), ''),
 (L, 'list group: the text is not cut to pixels', _GROUP_CALL, _GROUP_CALL.replace('ftoi(y)', 'y'), ''),
 (L, 'list group: the alignment is the one of the group data', _GROUP_CALL, _GROUP_CALL.replace('null, 0, -1', 'null, g.sortFlag, -1'), ''),
 (L, 'list group: the line space is 1', _GROUP_CALL, _GROUP_CALL.replace('LINE_SPACE', '1'), ''),
 # ---- a multi selection (multiSelected)
 (L, 'list multi: a drag is not looked at', '    if (this.m_bDrag) {\n      let fromStart: boolean;', '    if (false) {\n      let fromStart: boolean;', ''),
 (L, 'list multi: a drag is looked at without a drag', '    if (this.m_bDrag) {\n      let fromStart: boolean;', '    if (true) {\n      let fromStart: boolean;', ''),
 (L, 'list multi: the rows before the far end include the start', 'if (i < this.m_nSelected) fromStart = i > this.m_nSelStart;', 'if (i < this.m_nSelected) fromStart = i >= this.m_nSelStart;', "at the start row itself both ways answer the start row's own state; the answers agree for every start, far end and row (checked on a list of 6, far end from -1 to 6)"),
 (L, 'list multi: the rows before the far end are from the start', 'if (i < this.m_nSelected) fromStart = i > this.m_nSelStart;', 'if (i < this.m_nSelected) fromStart = true;', ''),
 (L, 'list multi: the rows before the far end are their own', 'if (i < this.m_nSelected) fromStart = i > this.m_nSelStart;', 'if (i < this.m_nSelected) fromStart = false;', ''),
 (L, 'list multi: the first test includes the far end', 'if (i < this.m_nSelected) fromStart', 'if (i <= this.m_nSelected) fromStart', ''),
 (L, 'list multi: the rows before the start are their own', 'else if (i < this.m_nSelStart) fromStart = true;', 'else if (i < this.m_nSelStart) fromStart = false;', ''),
 (L, 'list multi: the start is before the start', 'else if (i < this.m_nSelStart) fromStart = true;', 'else if (i <= this.m_nSelStart) fromStart = true;', "at the start row itself both ways answer the start row's own state; the answers agree for every start, far end and row (checked on a list of 6, far end from -1 to 6)"),
 (L, 'list multi: the rows after the start are not tested', 'else if (i < this.m_nSelStart) fromStart = true;\n', '', ''),
 (L, 'list multi: the last row of the range is not in', 'else if (i <= this.m_nSelected) fromStart = i > this.m_nSelStart;', 'else if (i < this.m_nSelected) fromStart = i > this.m_nSelStart;', ''),
 (L, 'list multi: the last row of the range excludes the start', 'else if (i <= this.m_nSelected) fromStart = i > this.m_nSelStart;', 'else if (i <= this.m_nSelected) fromStart = i >= this.m_nSelStart;', "at the start row itself both ways answer the start row's own state; the answers agree for every start, far end and row (checked on a list of 6, far end from -1 to 6)"),
 (L, 'list multi: the last row of the range is from the start', 'else if (i <= this.m_nSelected) fromStart = i > this.m_nSelStart;', 'else if (i <= this.m_nSelected) fromStart = true;', "at the start row itself both ways answer the start row's own state; the answers agree for every start, far end and row (checked on a list of 6, far end from -1 to 6)"),
 (L, 'list multi: the rows after the range are from the start', 'else fromStart = false;\n      if (fromStart)', 'else fromStart = true;\n      if (fromStart)', ''),
 (L, 'list multi: the range takes the state of the far end', 'if (fromStart) return this.m_Items[this.m_nSelStart]!.bSelected;', 'if (fromStart) return this.m_Items[this.m_nSelected]!.bSelected;', ''),
 (L, 'list multi: the range takes its own state', 'if (fromStart) return this.m_Items[this.m_nSelStart]!.bSelected;', 'if (fromStart) return item.bSelected;', ''),
 (L, 'list multi: the range takes the opposite of the start', 'if (fromStart) return this.m_Items[this.m_nSelStart]!.bSelected;', 'if (fromStart) return !this.m_Items[this.m_nSelStart]!.bSelected;', ''),
 (L, 'list multi: a row outside the range is not selected', '    return item.bSelected;\n  }\n\n  /**\n   * The rows: from', '    return false;\n  }\n\n  /**\n   * The rows: from', ''),
 # ---- input.ts: the mouse of the world
 ('input.ts', 'mouse: GetXPos is the y', '    return this.m_XPos;', '    return this.m_YPos;', ''),
 ('input.ts', 'mouse: GetYPos is the x', '    return this.m_YPos;', '    return this.m_XPos;', ''),
 ('input.ts', 'mouse: x starts at 1', '  m_XPos = 0;', '  m_XPos = 1;', ''),
 ('input.ts', 'mouse: y starts at 1', '  m_YPos = 0;', '  m_YPos = 1;', ''),
]
# the colour and the outline of the text of a plain row and of a group row: each channel from the right colours (the dialog, the string data, the box)
_PLAIN_OUT = 'const outline: ColorF = { a: channel(d.a, o.a, c.a), r: channel(d.r, o.r, c.r), g: channel(d.g, o.g, c.g), b: channel(d.b, o.b, c.b) };\n      this.m_pUKFont?.'
_GROUP_OUT = 'const outline: ColorF = { a: channel(d.a, o.a, c.a), r: channel(d.r, o.r, c.r), g: channel(d.g, o.g, c.g), b: channel(d.b, o.b, c.b) };\n      const mark'
_PLAIN_COL = {c: f'{c}: own ? item.m_color.{c} : channel(d.{c}, s.{c}, c.{c})' for c in 'rgb'}
for _c in 'argb':
    _n = _NEXT[_c]
    _orig = f'{_c}: channel(d.{_c}, o.{_c}, c.{_c})'
    for _role, _anchor in (('the plain row', _PLAIN_OUT), ('the group row', _GROUP_OUT)):
        M += [
            (L, f'list {_role} outline: {_c} ignores the dialog', _anchor, _anchor.replace(_orig, f'{_c}: channel(1, o.{_c}, c.{_c})'), ''),
            (L, f'list {_role} outline: {_c} ignores the string data', _anchor, _anchor.replace(_orig, f'{_c}: channel(d.{_c}, 1, c.{_c})'), ''),
            (L, f'list {_role} outline: {_c} ignores the box', _anchor, _anchor.replace(_orig, f'{_c}: channel(d.{_c}, o.{_c}, 1)'), ''),
            (L, f"list {_role} outline: {_c} takes the dialog's {_n}", _anchor, _anchor.replace(_orig, f'{_c}: channel(d.{_n}, o.{_c}, c.{_c})'), ''),
            (L, f"list {_role} outline: {_c} takes the string data's {_n}", _anchor, _anchor.replace(_orig, f'{_c}: channel(d.{_c}, o.{_n}, c.{_c})'), ''),
            (L, f"list {_role} outline: {_c} takes the box's {_n}", _anchor, _anchor.replace(_orig, f'{_c}: channel(d.{_c}, o.{_c}, c.{_n})'), ''),
            (L, f'list {_role} outline: {_c} is the colour not the outline', _anchor, _anchor.replace(_orig, f'{_c}: channel(d.{_c}, s.{_c}, c.{_c})'), ''),
        ]
    # the colour of a group row (the alpha and the channels all like this) and of a plain row (the three channels; its alpha is _ALPHA)
    _gcol = f'{_c}: channel(d.{_c}, s.{_c}, c.{_c})'
    _gline = 'const color: ColorF = { a: channel(d.a, s.a, c.a), r: channel(d.r, s.r, c.r), g: channel(d.g, s.g, c.g), b: channel(d.b, s.b, c.b) };'
    M += [
        (L, f'list the group row colour: {_c} ignores the dialog', _gline, _gline.replace(_gcol, f'{_c}: channel(1, s.{_c}, c.{_c})'), ''),
        (L, f'list the group row colour: {_c} ignores the string data', _gline, _gline.replace(_gcol, f'{_c}: channel(d.{_c}, 1, c.{_c})'), ''),
        (L, f'list the group row colour: {_c} ignores the box', _gline, _gline.replace(_gcol, f'{_c}: channel(d.{_c}, s.{_c}, 1)'), ''),
        (L, f"list the group row colour: {_c} takes the dialog's {_n}", _gline, _gline.replace(_gcol, f'{_c}: channel(d.{_n}, s.{_c}, c.{_c})'), ''),
        (L, f"list the group row colour: {_c} takes the string data's {_n}", _gline, _gline.replace(_gcol, f'{_c}: channel(d.{_c}, s.{_n}, c.{_c})'), ''),
        (L, f"list the group row colour: {_c} takes the box's {_n}", _gline, _gline.replace(_gcol, f'{_c}: channel(d.{_c}, s.{_c}, c.{_n})'), ''),
        (L, f'list the group row colour: {_c} is the outline not the colour', _gline, _gline.replace(_gcol, f'{_c}: channel(d.{_c}, o.{_c}, c.{_c})'), ''),
    ]
    if _c != 'a':
        _p = _PLAIN_COL[_c]
        M += [
            (L, f'list the plain row colour: {_c} ignores the dialog', _p, f'{_c}: own ? item.m_color.{_c} : channel(1, s.{_c}, c.{_c})', ''),
            (L, f'list the plain row colour: {_c} ignores the string data', _p, f'{_c}: own ? item.m_color.{_c} : channel(d.{_c}, 1, c.{_c})', ''),
            (L, f'list the plain row colour: {_c} ignores the box', _p, f'{_c}: own ? item.m_color.{_c} : channel(d.{_c}, s.{_c}, 1)', ''),
            (L, f"list the plain row colour: {_c} takes the dialog's {_n}", _p, f'{_c}: own ? item.m_color.{_c} : channel(d.{_n}, s.{_c}, c.{_c})', ''),
            (L, f"list the plain row colour: {_c} takes the string data's {_n}", _p, f'{_c}: own ? item.m_color.{_c} : channel(d.{_c}, s.{_n}, c.{_c})', ''),
            (L, f"list the plain row colour: {_c} takes the box's {_n}", _p, f'{_c}: own ? item.m_color.{_c} : channel(d.{_c}, s.{_c}, c.{_n})', ''),
            (L, f'list the plain row colour: {_c} is the outline not the colour', _p, f'{_c}: own ? item.m_color.{_c} : channel(d.{_c}, o.{_c}, c.{_c})', ''),
        ]

# ---- slot.ts: OnFrameRender 32952670, DrawEdge 32951310, UpdateDraggingVertex 329545B0, RenderDragSlot 32952DD0 (packages/ui/test/slotdraw.test.ts)
K = 'slot.ts'
_SORT = '[...this.m_mapAdditionalPictureDataList.keys()].sort((a, b) => a - b)'
_EDGE_CALL = 'this.drawEdge(picture.m_bDrawEdgeOut, picture.m_EdgeWidth, picture.m_EdgeColor, point);'
_EDGE_1 = f'if (picture.m_EdgeWidth !== 0) {_EDGE_CALL}\n      this.updateVertex(this.m_Vertex, point);'
_EDGE_2 = f'render?.states.popTo(top);\n      if (picture.m_EdgeWidth !== 0) {_EDGE_CALL}'
_SKIP = 'if (!(picture.bShow && point && picture.pTexture && picture.pTexture.pTexture)) continue;'
_MOUSE_OVER = 'if (this.m_bMouseOver && this.m_eControlState !== SCS.ONDRAG && this.m_bEnable) {'
_GUARD = 'if (edgeWidth === 0 || !this.m_pEdgeTexture || !point) return;'
_NW = 'const nWidth = ftoi(f(point.rightTopPoint.x - point.leftTopPoint.x));'
_NH = 'const nHeight = ftoi(f(point.rightBottomPoint.y - point.leftTopPoint.y));'
_BARS = 'this.drawEdgeBars(this.m_pEdgeTexture, drawOut, edgeWidth, edgeColor, point, nWidth, nHeight);'
M += [
 # -- OnFrameRender: the points
 (K, 'slot draw: a hidden slot draws', 'if (!this.m_bShow) return 0;\n    this.updateVertex(this.m_Vertex, this.m_NowPoint);', 'this.updateVertex(this.m_Vertex, this.m_NowPoint);', ''),
 (K, 'slot draw: a hidden slot answers 1', 'if (!this.m_bShow) return 0;\n    this.updateVertex(this.m_Vertex, this.m_NowPoint);', 'if (!this.m_bShow) return 1;\n    this.updateVertex(this.m_Vertex, this.m_NowPoint);', ''),
 (K, 'slot draw: the current point is the end point (the update)', 'this.updateVertex(this.m_Vertex, this.m_NowPoint);', 'this.updateVertex(this.m_Vertex, this.m_EndPoint);', ''),
 (K, 'slot draw: the current point is the end point (the draw)', 'this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);', 'this.renderVertex(this.m_Vertex, this.m_EndPoint, 1);', ''),
 (K, 'slot draw: the current point is drawn as often as its count says', 'this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);', 'this.renderVertex(this.m_Vertex, this.m_NowPoint, this.m_NowPoint.m_iDrawCount);', ''),
 (K, 'slot draw: the current point is drawn twice', 'this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);', 'this.renderVertex(this.m_Vertex, this.m_NowPoint, 2);', ''),
 (K, 'slot draw: the mouse over point does not need the mouse', _MOUSE_OVER, 'if (this.m_eControlState !== SCS.ONDRAG && this.m_bEnable) {', ''),
 (K, 'slot draw: the mouse over point is drawn while dragged', _MOUSE_OVER, 'if (this.m_bMouseOver && this.m_bEnable) {', ''),
 (K, 'slot draw: the mouse over point is drawn when disabled', _MOUSE_OVER, 'if (this.m_bMouseOver && this.m_eControlState !== SCS.ONDRAG) {', ''),
 (K, 'slot draw: the mouse over point needs the mouse or the rest', _MOUSE_OVER, 'if (this.m_bMouseOver || this.m_eControlState !== SCS.ONDRAG && this.m_bEnable) {', ''),
 (K, 'slot draw: the mouse over point needs one of dragging and enabled', _MOUSE_OVER, 'if (this.m_bMouseOver && (this.m_eControlState !== SCS.ONDRAG || this.m_bEnable)) {', ''),
 (K, 'slot draw: the mouse over point is for the dragged slot', _MOUSE_OVER, 'if (this.m_bMouseOver && this.m_eControlState === SCS.ONDRAG && this.m_bEnable) {', ''),
 (K, 'slot draw: the mouse over point is for the disabled slot', _MOUSE_OVER, 'if (this.m_bMouseOver && this.m_eControlState !== SCS.ONDRAG && !this.m_bEnable) {', ''),
 (K, 'slot draw: the mouse over point is not for the mouse over state', _MOUSE_OVER, 'if (this.m_bMouseOver && this.m_eControlState !== SCS.ONDRAG && this.m_eControlState !== SCS.MOUSEOVER && this.m_bEnable) {', ''),
 (K, 'slot draw: only the down state keeps the mouse over point away', _MOUSE_OVER, 'if (this.m_bMouseOver && this.m_eControlState !== SCS.DOWN && this.m_bEnable) {', ''),
 (K, 'slot draw: only the normal state keeps the mouse over point away', _MOUSE_OVER, 'if (this.m_bMouseOver && this.m_eControlState !== SCS.NORMAL && this.m_bEnable) {', ''),
 (K, 'slot draw: only the disabled state keeps the mouse over point away', _MOUSE_OVER, 'if (this.m_bMouseOver && this.m_eControlState !== SCS.DISABLE && this.m_bEnable) {', ''),
 (K, 'slot draw: a mouse over without a mouse over point is not noticed', '      if (!over) throw new Error("CKTDGUISlot::OnFrameRender: the mouse is over a slot that has no mouse over point (SetPoint makes it); the exe dereferences null");\n', '', ''),
 (K, 'slot draw: the mouse over quad is placed by the current point', 'this.updateVertex(this.m_Vertex, over);', 'this.updateVertex(this.m_Vertex, this.m_NowPoint);', ''),
 (K, 'slot draw: the mouse over quad is drawn with the current point', 'this.renderVertex(this.m_Vertex, over, 1);', 'this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);', ''),
 (K, 'slot draw: the mouse over quad is drawn as often as its count says', 'this.renderVertex(this.m_Vertex, over, 1);', 'this.renderVertex(this.m_Vertex, over, over.m_iDrawCount);', ''),
 (K, 'slot draw: the mouse over quad is drawn twice', 'this.renderVertex(this.m_Vertex, over, 1);', 'this.renderVertex(this.m_Vertex, over, 2);', ''),
 (K, 'slot draw: the mouse over quad is not drawn', '      this.renderVertex(this.m_Vertex, over, 1);\n', '', ''),
 # -- OnFrameRender: the additional pictures
 (K, 'slot draw: the pictures are drawn in the order they were added', 'for (const picture of this.additionalPictures()) {\n      const point', 'for (const picture of this.m_mapAdditionalPictureDataList.values()) {\n      const point', ''),
 (K, 'slot draw: the pictures are not sorted by their keys', _SORT, '[...this.m_mapAdditionalPictureDataList.keys()]', ''),
 (K, 'slot draw: the pictures are in the opposite order', _SORT, '[...this.m_mapAdditionalPictureDataList.keys()].sort((a, b) => b - a)', ''),
 (K, 'slot draw: the keys are sorted as text', _SORT, '[...this.m_mapAdditionalPictureDataList.keys()].sort()', ''),
 (K, 'slot draw: a hidden picture is drawn', _SKIP, 'if (!(point && picture.pTexture && picture.pTexture.pTexture)) continue;', ''),
 (K, 'slot draw: a picture without a point is drawn', _SKIP, 'if (!(picture.bShow && picture.pTexture && picture.pTexture.pTexture)) continue;', ''),
 (K, 'slot draw: a picture without a texture is drawn', _SKIP, 'if (!(picture.bShow && point && picture.pTexture.pTexture)) continue;', ''),
 (K, 'slot draw: a picture whose texture did not open is drawn', _SKIP, 'if (!(picture.bShow && point && picture.pTexture)) continue;', ''),
 (K, 'slot draw: a picture needs one of the four things', _SKIP, 'if (!(picture.bShow || point || picture.pTexture || picture.pTexture.pTexture)) continue;', ''),
 (K, 'slot draw: a picture that is skipped ends the loop', _SKIP, 'if (!(picture.bShow && point && picture.pTexture && picture.pTexture.pTexture)) break;', ''),
 (K, 'slot draw: a picture is placed by the current point', 'this.updateVertex(this.m_Vertex, point);\n      const top', 'this.updateVertex(this.m_Vertex, this.m_NowPoint);\n      const top', ''),
 (K, 'slot draw: a picture takes the draw count of one', 'this.renderVertex(this.m_Vertex, point, point.m_iDrawCount);', 'this.renderVertex(this.m_Vertex, point, 1);', ''),
 (K, 'slot draw: a picture is drawn with the current point', 'this.renderVertex(this.m_Vertex, point, point.m_iDrawCount);', 'this.renderVertex(this.m_Vertex, this.m_NowPoint, point.m_iDrawCount);', ''),
 (K, 'slot draw: a picture draws with the count of the current point', 'this.renderVertex(this.m_Vertex, point, point.m_iDrawCount);', 'this.renderVertex(this.m_Vertex, point, this.m_NowPoint.m_iDrawCount);', ''),
 # the blend states
 (K, 'slot draw: SRCBLEND takes the destination blend', 'render?.states.setRenderState(D3DRS.SRCBLEND, point.m_eSrcBlend);', 'render?.states.setRenderState(D3DRS.SRCBLEND, point.m_eDestBlend);', ''),
 (K, 'slot draw: DESTBLEND takes the source blend', 'render?.states.setRenderState(D3DRS.DESTBLEND, point.m_eDestBlend);', 'render?.states.setRenderState(D3DRS.DESTBLEND, point.m_eSrcBlend);', ''),
 (K, 'slot draw: the source blend goes to DESTBLEND', 'render?.states.setRenderState(D3DRS.SRCBLEND, point.m_eSrcBlend);', 'render?.states.setRenderState(D3DRS.DESTBLEND, point.m_eSrcBlend);', ''),
 (K, 'slot draw: the destination blend goes to SRCBLEND', 'render?.states.setRenderState(D3DRS.DESTBLEND, point.m_eDestBlend);', 'render?.states.setRenderState(D3DRS.SRCBLEND, point.m_eDestBlend);', ''),
 (K, 'slot draw: SRCBLEND is not set', '      render?.states.setRenderState(D3DRS.SRCBLEND, point.m_eSrcBlend);\n', '', ''),
 (K, 'slot draw: DESTBLEND is not set', '      render?.states.setRenderState(D3DRS.DESTBLEND, point.m_eDestBlend);\n', '', ''),
 (K, 'slot draw: the blend states are not popped', 'this.renderVertex(this.m_Vertex, point, point.m_iDrawCount);\n      render?.states.popTo(top);', 'this.renderVertex(this.m_Vertex, point, point.m_iDrawCount);', ''),
 (K, 'slot draw: the blend states are popped to the bottom of the stack', 'render?.states.popTo(top);', 'render?.states.popTo(0);', ''),
 (K, 'slot draw: the blend states are popped from a stack top of 0', 'const top = render?.states.stackPointer ?? 0;', 'const top = 0;', ''),
 # the edges of a picture
 (K, 'slot draw: no edge before the picture', _EDGE_1, 'this.updateVertex(this.m_Vertex, point);', ''),
 (K, 'slot draw: no edge after the picture', _EDGE_2, 'render?.states.popTo(top);', ''),
 (K, 'slot draw: the first edge is drawn inside the blend states', f'{_EDGE_1}\n      const top = render?.states.stackPointer ?? 0;\n      render?.states.setRenderState(D3DRS.SRCBLEND, point.m_eSrcBlend);\n      render?.states.setRenderState(D3DRS.DESTBLEND, point.m_eDestBlend);', f'this.updateVertex(this.m_Vertex, point);\n      const top = render?.states.stackPointer ?? 0;\n      render?.states.setRenderState(D3DRS.SRCBLEND, point.m_eSrcBlend);\n      render?.states.setRenderState(D3DRS.DESTBLEND, point.m_eDestBlend);\n      if (picture.m_EdgeWidth !== 0) {_EDGE_CALL}', ''),
 (K, 'slot draw: the second edge is drawn inside the blend states', _EDGE_2, f'if (picture.m_EdgeWidth !== 0) {_EDGE_CALL}\n      render?.states.popTo(top);', ''),
]
# the two edges of a picture: each argument, each of the two calls
for _where, _anchor, _wrap in (('first', _EDGE_1, lambda call: f'if (picture.m_EdgeWidth !== 0) {call}\n      this.updateVertex(this.m_Vertex, point);'), ('second', _EDGE_2, lambda call: f'render?.states.popTo(top);\n      if (picture.m_EdgeWidth !== 0) {call}')):
    M += [
        (K, f'slot draw: the {_where} edge is drawn outside always', _anchor, _wrap(_EDGE_CALL.replace('picture.m_bDrawEdgeOut', 'true')), ''),
        (K, f'slot draw: the {_where} edge is drawn inside always', _anchor, _wrap(_EDGE_CALL.replace('picture.m_bDrawEdgeOut', 'false')), ''),
        (K, f'slot draw: the {_where} edge is drawn on the other side', _anchor, _wrap(_EDGE_CALL.replace('picture.m_bDrawEdgeOut', '!picture.m_bDrawEdgeOut')), ''),
        (K, f'slot draw: the {_where} edge is one wide', _anchor, _wrap(_EDGE_CALL.replace('picture.m_EdgeWidth, picture.m_EdgeColor', '1, picture.m_EdgeColor')), ''),
        (K, f'slot draw: the {_where} edge has the colour of the slot', _anchor, _wrap(_EDGE_CALL.replace('picture.m_EdgeColor', 'this.m_Color')), ''),
        (K, f'slot draw: the {_where} edge is of the current point', _anchor, _wrap(_EDGE_CALL.replace(', point);', ', this.m_NowPoint);')), ''),
        (K, f'slot draw: the {_where} edge is drawn for a width other than 0 only when positive', _anchor, _wrap(_EDGE_CALL).replace('picture.m_EdgeWidth !== 0', 'picture.m_EdgeWidth > 0'), ''),
        (K, f'slot draw: the {_where} edge is drawn for a width of 0', _anchor, _wrap(_EDGE_CALL).replace('picture.m_EdgeWidth !== 0', 'picture.m_EdgeWidth === 0'), ''),
    ]
M += [
 # -- OnFrameRender: the string
 (K, 'slot draw: the string is drawn for a slot without data', 'if (data) drawUKString(this.ctx, this, data, data.msg);', 'if (!data) drawUKString(this.ctx, this, data!, data!.msg);', ''),
 (K, 'slot draw: the string is not drawn', '    const data = this.m_pStringData;\n    if (data) drawUKString(this.ctx, this, data, data.msg);\n', '', ''),
 (K, 'slot draw: an empty message is not drawn', 'if (data) drawUKString(this.ctx, this, data, data.msg);', 'if (data && data.msg.length > 0) drawUKString(this.ctx, this, data, data.msg);', ''),
 (K, 'slot draw: the message is empty', 'drawUKString(this.ctx, this, data, data.msg);', 'drawUKString(this.ctx, this, data, "");', ''),
 (K, 'slot draw: the string is drawn before the pictures too', 'const render = this.ctx.render;\n    for (const picture of this.additionalPictures()) {', 'if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);\n    const render = this.ctx.render;\n    for (const picture of this.additionalPictures()) {', ''),
 (K, 'slot draw: a slot answers 1', 'drawUKString(this.ctx, this, data, data.msg);\n    return 0;', 'drawUKString(this.ctx, this, data, data.msg);\n    return 1;', ''),
]
M += [
 # -- DrawEdge
 (K, 'slot edge: a width of 0 draws bars', _GUARD, 'if (!this.m_pEdgeTexture || !point) return;', ''),
 (K, 'slot edge: an edge needs its texture', _GUARD, 'if (edgeWidth === 0 || !point) return;', ''),
 (K, 'slot edge: an edge needs a point', _GUARD, 'if (edgeWidth === 0 || !this.m_pEdgeTexture) return;', ''),
 (K, 'slot edge: a negative width draws no bars', _GUARD, 'if (edgeWidth <= 0 || !this.m_pEdgeTexture || !point) return;', ''),
 (K, 'slot edge: an edge needs a width or a texture', _GUARD, 'if (edgeWidth === 0 && !this.m_pEdgeTexture || !point) return;', ''),
 (K, 'slot edge: the width is the right-bottom corner\'s', _NW, 'const nWidth = ftoi(f(point.rightBottomPoint.x - point.leftTopPoint.x));', ''),
 (K, 'slot edge: the width is from the left-bottom corner', _NW, 'const nWidth = ftoi(f(point.rightTopPoint.x - point.leftBottomPoint.x));', ''),
 (K, 'slot edge: the width is the height', _NW, 'const nWidth = ftoi(f(point.rightTopPoint.y - point.leftTopPoint.y));', ''),
 (K, 'slot edge: the width is rounded, not cut', _NW, 'const nWidth = Math.round(f(point.rightTopPoint.x - point.leftTopPoint.x));', ''),
 (K, 'slot edge: the width is cut downwards', _NW, 'const nWidth = Math.floor(f(point.rightTopPoint.x - point.leftTopPoint.x));', ''),
 (K, 'slot edge: the width is the other way round', _NW, 'const nWidth = ftoi(f(point.leftTopPoint.x - point.rightTopPoint.x));', ''),
 (K, 'slot edge: the height is the left-bottom corner\'s', _NH, 'const nHeight = ftoi(f(point.leftBottomPoint.y - point.leftTopPoint.y));', ''),
 (K, 'slot edge: the height is from the right-top corner', _NH, 'const nHeight = ftoi(f(point.rightBottomPoint.y - point.rightTopPoint.y));', ''),
 (K, 'slot edge: the height is the width', _NH, 'const nHeight = ftoi(f(point.rightBottomPoint.x - point.leftTopPoint.x));', ''),
 (K, 'slot edge: the height is rounded, not cut', _NH, 'const nHeight = Math.round(f(point.rightBottomPoint.y - point.leftTopPoint.y));', ''),
 (K, 'slot edge: the height is cut downwards', _NH, 'const nHeight = Math.floor(f(point.rightBottomPoint.y - point.leftTopPoint.y));', ''),
 (K, 'slot edge: the height is the other way round', _NH, 'const nHeight = ftoi(f(point.leftTopPoint.y - point.rightBottomPoint.y));', ''),
 (K, 'slot edge: the bars are drawn on the other side', _BARS, 'this.drawEdgeBars(this.m_pEdgeTexture, !drawOut, edgeWidth, edgeColor, point, nWidth, nHeight);', ''),
 (K, 'slot edge: the bars are one wide', _BARS, 'this.drawEdgeBars(this.m_pEdgeTexture, drawOut, 1, edgeColor, point, nWidth, nHeight);', ''),
 (K, 'slot edge: the bars have the colour of the slot', _BARS, 'this.drawEdgeBars(this.m_pEdgeTexture, drawOut, edgeWidth, this.m_Color, point, nWidth, nHeight);', ''),
 (K, 'slot edge: the width and the height are swapped', _BARS, 'this.drawEdgeBars(this.m_pEdgeTexture, drawOut, edgeWidth, edgeColor, point, nHeight, nWidth);', ''),
 (K, 'slot edge: the bars are of the current point', _BARS, 'this.drawEdgeBars(this.m_pEdgeTexture, drawOut, edgeWidth, edgeColor, this.m_NowPoint, nWidth, nHeight);', ''),
 (K, 'slot edge: the bars are drawn outside always', _BARS, 'this.drawEdgeBars(this.m_pEdgeTexture, true, edgeWidth, edgeColor, point, nWidth, nHeight);', ''),
 (K, 'slot edge: the bars are drawn inside always', _BARS, 'this.drawEdgeBars(this.m_pEdgeTexture, false, edgeWidth, edgeColor, point, nWidth, nHeight);', ''),
 (K, 'slot edge: the bars are not drawn', '    this.drawEdgeBars(this.m_pEdgeTexture, drawOut, edgeWidth, edgeColor, point, nWidth, nHeight);\n', '', ''),
 # -- UpdateDraggingVertex
 (K, 'slot drag vertex: a slot in no dialog is updated', 'if (!this.m_pDialog) return;\n    const scale = this.ctx.render?.resolutionScale;\n    const sx', 'const scale = this.ctx.render?.resolutionScale;\n    const sx', ''),
 (K, 'slot drag vertex: the scale of x is the y one', 'const sx = scale ? scale.x : 1, sy = scale ? scale.y : 1;', 'const sx = scale ? scale.y : 1, sy = scale ? scale.y : 1;', ''),
 (K, 'slot drag vertex: the scale of y is the x one', 'const sx = scale ? scale.x : 1, sy = scale ? scale.y : 1;', 'const sx = scale ? scale.x : 1, sy = scale ? scale.x : 1;', ''),
 (K, 'slot drag vertex: no scale is 2', 'const sx = scale ? scale.x : 1, sy = scale ? scale.y : 1;', 'const sx = scale ? scale.x : 2, sy = scale ? scale.y : 1;', ''),
 (K, 'slot drag vertex: no scale is 2 (y)', 'const sx = scale ? scale.x : 1, sy = scale ? scale.y : 1;', 'const sx = scale ? scale.x : 1, sy = scale ? scale.y : 2;', ''),
 (K, 'slot drag vertex: the colour is the slot\'s', 'const c = point.color;', 'const c = this.m_Color;', ''),
 (K, 'slot drag vertex: the colour is the dialog\'s', 'const c = point.color;', 'const c = this.m_pDialog.m_Color;', ''),
 (K, 'slot drag vertex: the alpha and the red are swapped', 'clampedByte(c.a) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b)) >>> 0', 'clampedByte(c.r) << 8) | clampedByte(c.a)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b)) >>> 0', ''),
 (K, 'slot drag vertex: the red and the green are swapped', 'clampedByte(c.a) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b)) >>> 0', 'clampedByte(c.a) << 8) | clampedByte(c.g)) << 8 | clampedByte(c.r)) << 8 | clampedByte(c.b)) >>> 0', ''),
 (K, 'slot drag vertex: the green and the blue are swapped', 'clampedByte(c.a) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b)) >>> 0', 'clampedByte(c.a) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.b)) << 8 | clampedByte(c.g)) >>> 0', ''),
 (K, 'slot drag vertex: the alpha is not clamped', 'clampedByte(c.a) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b)) >>> 0', '(c.a * 255 | 0) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b)) >>> 0', ''),
 (K, 'slot drag vertex: the colour is not made unsigned', 'clampedByte(c.a) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b)) >>> 0', 'clampedByte(c.a) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b))', 'VertexUI4.setColor stores value >>> 0 itself'),
 (K, 'slot drag vertex: left-bottom and right-top are swapped', 'const corners = [point.leftTopPoint, point.rightTopPoint, point.leftBottomPoint, point.rightBottomPoint];', 'const corners = [point.leftTopPoint, point.leftBottomPoint, point.rightTopPoint, point.rightBottomPoint];', ''),
 (K, 'slot drag vertex: left-top and right-top are swapped', 'const corners = [point.leftTopPoint, point.rightTopPoint, point.leftBottomPoint, point.rightBottomPoint];', 'const corners = [point.rightTopPoint, point.leftTopPoint, point.leftBottomPoint, point.rightBottomPoint];', ''),
 (K, 'slot drag vertex: left-bottom and right-bottom are swapped', 'const corners = [point.leftTopPoint, point.rightTopPoint, point.leftBottomPoint, point.rightBottomPoint];', 'const corners = [point.leftTopPoint, point.rightTopPoint, point.rightBottomPoint, point.leftBottomPoint];', ''),
 (K, 'slot drag vertex: x takes the y of the corner', 'vertex.setX(i, f(sx * corner.x));', 'vertex.setX(i, f(sx * corner.y));', ''),
 (K, 'slot drag vertex: y takes the x of the corner', 'vertex.setY(i, f(sy * corner.y));', 'vertex.setY(i, f(sy * corner.x));', ''),
 (K, 'slot drag vertex: x is scaled by the y scale', 'vertex.setX(i, f(sx * corner.x));', 'vertex.setX(i, f(sy * corner.x));', ''),
 (K, 'slot drag vertex: y is scaled by the x scale', 'vertex.setY(i, f(sy * corner.y));', 'vertex.setY(i, f(sx * corner.y));', ''),
 (K, 'slot drag vertex: x is not scaled', 'vertex.setX(i, f(sx * corner.x));', 'vertex.setX(i, f(corner.x));', ''),
 (K, 'slot drag vertex: y is not scaled', 'vertex.setY(i, f(sy * corner.y));', 'vertex.setY(i, f(corner.y));', ''),
 (K, 'slot drag vertex: z is 0', 'vertex.setZ(i, 1);', 'vertex.setZ(i, 0);', ''),
 (K, 'slot drag vertex: rhw is 0', 'vertex.setRhw(i, 1);', 'vertex.setRhw(i, 0);', ''),
 (K, 'slot drag vertex: the texture coordinates are not copied', 'if (texture) {\n      for (let i = 0; i < 4; i++) {\n        vertex.setU(i, texture.uvTexture[i]!.x);', 'if (!texture) {\n      for (let i = 0; i < 4; i++) {\n        vertex.setU(i, texture!.uvTexture[i]!.x);', ''),
 (K, 'slot drag vertex: u takes the v', 'vertex.setU(i, texture.uvTexture[i]!.x);', 'vertex.setU(i, texture.uvTexture[i]!.y);', ''),
 (K, 'slot drag vertex: v takes the u', 'vertex.setV(i, texture.uvTexture[i]!.y);', 'vertex.setV(i, texture.uvTexture[i]!.x);', ''),
 (K, 'slot drag vertex: u is the one of the next corner', 'vertex.setU(i, texture.uvTexture[i]!.x);', 'vertex.setU(i, texture.uvTexture[(i + 1) % 4]!.x);', ''),
 (K, 'slot drag vertex: v is the one of the next corner', 'vertex.setV(i, texture.uvTexture[i]!.y);', 'vertex.setV(i, texture.uvTexture[(i + 1) % 4]!.y);', ''),
 (K, 'slot drag vertex: x is moved half a pixel right', 'vertex.setX(i, f(f(ftoi(vertex.x(i))) - 0.5));', 'vertex.setX(i, f(f(ftoi(vertex.x(i))) + 0.5));', ''),
 (K, 'slot drag vertex: y is moved half a pixel down', 'vertex.setY(i, f(f(ftoi(vertex.y(i))) - 0.5));', 'vertex.setY(i, f(f(ftoi(vertex.y(i))) + 0.5));', ''),
 (K, 'slot drag vertex: x is not cut', 'vertex.setX(i, f(f(ftoi(vertex.x(i))) - 0.5));', 'vertex.setX(i, f(vertex.x(i) - 0.5));', ''),
 (K, 'slot drag vertex: y is not cut', 'vertex.setY(i, f(f(ftoi(vertex.y(i))) - 0.5));', 'vertex.setY(i, f(vertex.y(i) - 0.5));', ''),
 (K, 'slot drag vertex: x is rounded', 'vertex.setX(i, f(f(ftoi(vertex.x(i))) - 0.5));', 'vertex.setX(i, f(f(Math.round(vertex.x(i))) - 0.5));', ''),
 (K, 'slot drag vertex: y is rounded', 'vertex.setY(i, f(f(ftoi(vertex.y(i))) - 0.5));', 'vertex.setY(i, f(f(Math.round(vertex.y(i))) - 0.5));', ''),
 (K, 'slot drag vertex: x is cut downwards', 'vertex.setX(i, f(f(ftoi(vertex.x(i))) - 0.5));', 'vertex.setX(i, f(f(Math.floor(vertex.x(i))) - 0.5));', ''),
 (K, 'slot drag vertex: y is cut downwards', 'vertex.setY(i, f(f(ftoi(vertex.y(i))) - 0.5));', 'vertex.setY(i, f(f(Math.floor(vertex.y(i))) - 0.5));', ''),
]
_DRAG_IF = 'if (this.m_eControlState === SCS.ONDRAG && this.m_bHasFocus && normal && normal.pUITextureData) {'
_DX = 'const x = f(f(this.ctx.mouse.GetXPos()) / (scale ? scale.x : 1));'
_DY = 'const y = f(f(this.ctx.mouse.GetYPos()) / (scale ? scale.y : 1));'
_HW = 'const halfWidth = f(f(drag.rightTopPoint.x - drag.leftTopPoint.x) * 0.5);'
_HH = 'const halfHeight = f(f(drag.leftBottomPoint.y - drag.leftTopPoint.y) * 0.5);'
_LR = 'const left = f(-halfWidth + x), right = f(halfWidth + x);'
_UL = 'const upper = f(-halfHeight + y), lower = f(halfHeight + y);'
_SET = 'drag.leftTopPoint.set(left, upper);\n      drag.rightTopPoint.set(right, upper);\n      drag.leftBottomPoint.set(left, lower);\n      drag.rightBottomPoint.set(right, lower);'
M += [
 # -- RenderDragSlot
 (K, 'slot drag: the sampler states are not pushed', '      for (const s of DIALOG_SAMPLER_STATES) states.setSamplerState(s.stage, s.type, s.value);\n', '', ''),
 (K, 'slot drag: only the first sampler state is pushed', 'for (const s of DIALOG_SAMPLER_STATES) states.setSamplerState(s.stage, s.type, s.value);', 'for (const s of DIALOG_SAMPLER_STATES.slice(0, 1)) states.setSamplerState(s.stage, s.type, s.value);', ''),
 (K, 'slot drag: the last sampler state is not pushed', 'for (const s of DIALOG_SAMPLER_STATES) states.setSamplerState(s.stage, s.type, s.value);', 'for (const s of DIALOG_SAMPLER_STATES.slice(0, -1)) states.setSamplerState(s.stage, s.type, s.value);', ''),
 (K, 'slot drag: the sampler states are pushed in the opposite order', 'for (const s of DIALOG_SAMPLER_STATES) states.setSamplerState(s.stage, s.type, s.value);', 'for (const s of [...DIALOG_SAMPLER_STATES].reverse()) states.setSamplerState(s.stage, s.type, s.value);', ''),
 (K, 'slot drag: the states of a dialog are not applied', '      states.apply(RSI_UI_DIALOG);\n', '', ''),
 (K, 'slot drag: the states are not popped', '    states?.popTo(top);\n    return 0;', '    return 0;', ''),
 (K, 'slot drag: the states are popped to the bottom of the stack', 'states?.popTo(top);', 'states?.popTo(0);', ''),
 (K, 'slot drag: the states are popped from a stack top of 0', 'const top = states?.stackPointer ?? 0;\n    if (states) {', 'const top = 0;\n    if (states) {', ''),
 (K, 'slot drag: it answers 1', 'states?.popTo(top);\n    return 0;', 'states?.popTo(top);\n    return 1;', ''),
 (K, 'slot drag: a slot that is not dragged is drawn', _DRAG_IF, 'if (this.m_bHasFocus && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: a slot that is dragged only', _DRAG_IF, 'if (this.m_eControlState !== SCS.ONDRAG && this.m_bHasFocus && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: a slot without the focus is drawn', _DRAG_IF, 'if (this.m_eControlState === SCS.ONDRAG && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: a slot without the focus only', _DRAG_IF, 'if (this.m_eControlState === SCS.ONDRAG && !this.m_bHasFocus && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: a slot without a normal point is drawn', _DRAG_IF, 'if (this.m_eControlState === SCS.ONDRAG && this.m_bHasFocus && normal?.pUITextureData !== undefined) {', ''),
 (K, 'slot drag: a normal point without a texture is drawn', _DRAG_IF, 'if (this.m_eControlState === SCS.ONDRAG && this.m_bHasFocus && normal) {', ''),
 (K, 'slot drag: a normal point needs no texture', _DRAG_IF, 'if (this.m_eControlState === SCS.ONDRAG && this.m_bHasFocus && normal && !normal.pUITextureData) {', ''),
 (K, 'slot drag: the dragged state is another one (down)', _DRAG_IF, 'if (this.m_eControlState === SCS.DOWN && this.m_bHasFocus && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: the dragged state is another one (mouse over)', _DRAG_IF, 'if (this.m_eControlState === SCS.MOUSEOVER && this.m_bHasFocus && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: the dragged state is another one (normal)', _DRAG_IF, 'if (this.m_eControlState === SCS.NORMAL && this.m_bHasFocus && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: the dragged state is another one (disabled)', _DRAG_IF, 'if (this.m_eControlState === SCS.DISABLE && this.m_bHasFocus && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: one of the four things is enough', _DRAG_IF, 'if (this.m_eControlState === SCS.ONDRAG || this.m_bHasFocus && normal && normal.pUITextureData) {', ''),
 (K, 'slot drag: the focus or the normal point is enough', _DRAG_IF, 'if (this.m_eControlState === SCS.ONDRAG && (this.m_bHasFocus || normal && normal.pUITextureData)) {', ''),
 (K, 'slot drag: the normal point or its texture is enough', _DRAG_IF, 'if (this.m_eControlState === SCS.ONDRAG && this.m_bHasFocus && (normal || normal?.pUITextureData)) {', ''),
 (K, 'slot drag: a dragged slot without a dragging point is not noticed', '      if (!drag) throw new Error("CKTDGUISlot::RenderDragSlot: the dragged slot has no dragging point (SetPoint makes it); the exe dereferences null");\n', '', ''),
 (K, 'slot drag: the dragging point is the normal point', 'const drag = this.m_pDraggingPoint;', 'const drag = this.m_pNormalPoint;', ''),
 (K, 'slot drag: the dragging point is the mouse over point', 'const drag = this.m_pDraggingPoint;', 'const drag = this.m_pMouseOverPoint;', ''),
 (K, 'slot drag: the dragging point is the current point', 'const drag = this.m_pDraggingPoint;', 'const drag = this.m_NowPoint;', ''),
 (K, 'slot drag: x is the mouse y', _DX, 'const x = f(f(this.ctx.mouse.GetYPos()) / (scale ? scale.x : 1));', ''),
 (K, 'slot drag: y is the mouse x', _DY, 'const y = f(f(this.ctx.mouse.GetXPos()) / (scale ? scale.y : 1));', ''),
 (K, 'slot drag: x is divided by the y scale', _DX, 'const x = f(f(this.ctx.mouse.GetXPos()) / (scale ? scale.y : 1));', ''),
 (K, 'slot drag: y is divided by the x scale', _DY, 'const y = f(f(this.ctx.mouse.GetYPos()) / (scale ? scale.x : 1));', ''),
 (K, 'slot drag: x is multiplied by the scale', _DX, 'const x = f(f(this.ctx.mouse.GetXPos()) * (scale ? scale.x : 1));', ''),
 (K, 'slot drag: y is multiplied by the scale', _DY, 'const y = f(f(this.ctx.mouse.GetYPos()) * (scale ? scale.y : 1));', ''),
 (K, 'slot drag: x is not scaled', _DX, 'const x = f(f(this.ctx.mouse.GetXPos()));', ''),
 (K, 'slot drag: y is not scaled', _DY, 'const y = f(f(this.ctx.mouse.GetYPos()));', ''),
 (K, 'slot drag: no scale is 2 for x', _DX, 'const x = f(f(this.ctx.mouse.GetXPos()) / (scale ? scale.x : 2));', ''),
 (K, 'slot drag: no scale is 2 for y', _DY, 'const y = f(f(this.ctx.mouse.GetYPos()) / (scale ? scale.y : 2));', ''),
 (K, 'slot drag: the width is of the bottom side', _HW, 'const halfWidth = f(f(drag.rightBottomPoint.x - drag.leftBottomPoint.x) * 0.5);', ''),
 (K, 'slot drag: the width is from the left-top to the right-bottom', _HW, 'const halfWidth = f(f(drag.rightBottomPoint.x - drag.leftTopPoint.x) * 0.5);', ''),
 (K, 'slot drag: the width is from the left-bottom to the right-top', _HW, 'const halfWidth = f(f(drag.rightTopPoint.x - drag.leftBottomPoint.x) * 0.5);', ''),
 (K, 'slot drag: the width is the other way round', _HW, 'const halfWidth = f(f(drag.leftTopPoint.x - drag.rightTopPoint.x) * 0.5);', ''),
 (K, 'slot drag: the width is the height', _HW, 'const halfWidth = f(f(drag.rightTopPoint.y - drag.leftTopPoint.y) * 0.5);', ''),
 (K, 'slot drag: the half width is a quarter', _HW, 'const halfWidth = f(f(drag.rightTopPoint.x - drag.leftTopPoint.x) * 0.25);', ''),
 (K, 'slot drag: the half width is the whole width', _HW, 'const halfWidth = f(f(drag.rightTopPoint.x - drag.leftTopPoint.x) * 1);', ''),
 (K, 'slot drag: the height is of the right side', _HH, 'const halfHeight = f(f(drag.rightBottomPoint.y - drag.rightTopPoint.y) * 0.5);', ''),
 (K, 'slot drag: the height is from the left-top to the right-bottom', _HH, 'const halfHeight = f(f(drag.rightBottomPoint.y - drag.leftTopPoint.y) * 0.5);', ''),
 (K, 'slot drag: the height is from the right-top to the left-bottom', _HH, 'const halfHeight = f(f(drag.leftBottomPoint.y - drag.rightTopPoint.y) * 0.5);', ''),
 (K, 'slot drag: the height is the other way round', _HH, 'const halfHeight = f(f(drag.leftTopPoint.y - drag.leftBottomPoint.y) * 0.5);', ''),
 (K, 'slot drag: the height is the width', _HH, 'const halfHeight = f(f(drag.leftBottomPoint.x - drag.leftTopPoint.x) * 0.5);', ''),
 (K, 'slot drag: the half height is a quarter', _HH, 'const halfHeight = f(f(drag.leftBottomPoint.y - drag.leftTopPoint.y) * 0.5);'.replace('* 0.5', '* 0.25'), ''),
 (K, 'slot drag: the half height is the whole height', _HH, 'const halfHeight = f(f(drag.leftBottomPoint.y - drag.leftTopPoint.y) * 0.5);'.replace('* 0.5', '* 1'), ''),
 (K, 'slot drag: the left side is right of the mouse', _LR, 'const left = f(halfWidth + x), right = f(halfWidth + x);', ''),
 (K, 'slot drag: the right side is left of the mouse', _LR, 'const left = f(-halfWidth + x), right = f(-halfWidth + x);', ''),
 (K, 'slot drag: the left side is the mouse', _LR, 'const left = f(x), right = f(halfWidth + x);', ''),
 (K, 'slot drag: the right side is the mouse', _LR, 'const left = f(-halfWidth + x), right = f(x);', ''),
 (K, 'slot drag: the sides are swapped', _LR, 'const left = f(halfWidth + x), right = f(-halfWidth + x);', ''),
 (K, 'slot drag: the sides are a width apart', _LR, 'const left = f(-halfWidth + x), right = f(halfWidth * 2 + x);', ''),
 (K, 'slot drag: the upper side is below the mouse', _UL, 'const upper = f(halfHeight + y), lower = f(halfHeight + y);', ''),
 (K, 'slot drag: the lower side is above the mouse', _UL, 'const upper = f(-halfHeight + y), lower = f(-halfHeight + y);', ''),
 (K, 'slot drag: the upper side is the mouse', _UL, 'const upper = f(y), lower = f(halfHeight + y);', ''),
 (K, 'slot drag: the lower side is the mouse', _UL, 'const upper = f(-halfHeight + y), lower = f(y);', ''),
 (K, 'slot drag: the sides are swapped (y)', _UL, 'const upper = f(halfHeight + y), lower = f(-halfHeight + y);', ''),
 (K, 'slot drag: the width is added to the height', _UL, 'const upper = f(-halfHeight + y), lower = f(halfWidth + y);', ''),
 (K, 'slot drag: the height is added to the width', _LR, 'const left = f(-halfWidth + x), right = f(halfHeight + x);', ''),
 (K, 'slot drag: the left-top corner is the left-bottom one', _SET, _SET.replace('drag.leftTopPoint.set(left, upper);', 'drag.leftTopPoint.set(left, lower);'), ''),
 (K, 'slot drag: the left-top corner is the right-top one', _SET, _SET.replace('drag.leftTopPoint.set(left, upper);', 'drag.leftTopPoint.set(right, upper);'), ''),
 (K, 'slot drag: the left-top corner is not set', _SET, _SET.replace('drag.leftTopPoint.set(left, upper);\n      ', ''), ''),
 (K, 'slot drag: the right-top corner is the left-top one', _SET, _SET.replace('drag.rightTopPoint.set(right, upper);', 'drag.rightTopPoint.set(left, upper);'), ''),
 (K, 'slot drag: the right-top corner is the right-bottom one', _SET, _SET.replace('drag.rightTopPoint.set(right, upper);', 'drag.rightTopPoint.set(right, lower);'), ''),
 (K, 'slot drag: the right-top corner is not set', _SET, _SET.replace('drag.rightTopPoint.set(right, upper);\n      ', ''), ''),
 (K, 'slot drag: the left-bottom corner is the left-top one', _SET, _SET.replace('drag.leftBottomPoint.set(left, lower);', 'drag.leftBottomPoint.set(left, upper);'), ''),
 (K, 'slot drag: the left-bottom corner is the right-bottom one', _SET, _SET.replace('drag.leftBottomPoint.set(left, lower);', 'drag.leftBottomPoint.set(right, lower);'), ''),
 (K, 'slot drag: the left-bottom corner is not set', _SET, _SET.replace('drag.leftBottomPoint.set(left, lower);\n      ', ''), ''),
 (K, 'slot drag: the right-bottom corner is the left-bottom one', _SET, _SET.replace('drag.rightBottomPoint.set(right, lower);', 'drag.rightBottomPoint.set(left, lower);'), ''),
 (K, 'slot drag: the right-bottom corner is the right-top one', _SET, _SET.replace('drag.rightBottomPoint.set(right, lower);', 'drag.rightBottomPoint.set(right, upper);'), ''),
 (K, 'slot drag: the right-bottom corner is not set', _SET, _SET.replace('\n      drag.rightBottomPoint.set(right, lower);', ''), ''),
 (K, 'slot drag: the corners take x and y the wrong way round', 'drag.leftTopPoint.set(left, upper);', 'drag.leftTopPoint.set(upper, left);', ''),
 (K, 'slot drag: the right-top corner takes x and y the wrong way round', 'drag.rightTopPoint.set(right, upper);', 'drag.rightTopPoint.set(upper, right);', ''),
 (K, 'slot drag: the left-bottom corner takes x and y the wrong way round', 'drag.leftBottomPoint.set(left, lower);', 'drag.leftBottomPoint.set(lower, left);', ''),
 (K, 'slot drag: the right-bottom corner takes x and y the wrong way round', 'drag.rightBottomPoint.set(right, lower);', 'drag.rightBottomPoint.set(lower, right);', ''),
 (K, 'slot drag: the vertex is made with UpdateVertex', 'this.updateDraggingVertex(this.m_DragVertex, drag);', 'this.updateVertex(this.m_DragVertex, drag);', ''),
 (K, 'slot drag: the vertex is made in the vertices of the slot', 'this.updateDraggingVertex(this.m_DragVertex, drag);', 'this.updateDraggingVertex(this.m_Vertex, drag);', ''),
 (K, 'slot drag: the vertex is made of the normal point', 'this.updateDraggingVertex(this.m_DragVertex, drag);', 'this.updateDraggingVertex(this.m_DragVertex, normal);', ''),
 (K, 'slot drag: the vertex is not made', '      this.updateDraggingVertex(this.m_DragVertex, drag);\n', '', ''),
 (K, 'slot drag: the quad is drawn from the vertices of the slot', 'this.renderVertex(this.m_DragVertex, drag, 1);', 'this.renderVertex(this.m_Vertex, drag, 1);', ''),
 (K, 'slot drag: the quad is drawn with the normal point', 'this.renderVertex(this.m_DragVertex, drag, 1);', 'this.renderVertex(this.m_DragVertex, normal, 1);', ''),
 (K, 'slot drag: the quad is drawn as often as the point says', 'this.renderVertex(this.m_DragVertex, drag, 1);', 'this.renderVertex(this.m_DragVertex, drag, drag.m_iDrawCount);', ''),
 (K, 'slot drag: the quad is drawn twice', 'this.renderVertex(this.m_DragVertex, drag, 1);', 'this.renderVertex(this.m_DragVertex, drag, 2);', ''),
 (K, 'slot drag: the quad is not drawn', '      this.renderVertex(this.m_DragVertex, drag, 1);\n', '', ''),
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
