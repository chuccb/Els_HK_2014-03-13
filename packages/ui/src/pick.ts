/**
 * The geometry of the mouse: which control is under a point.
 *
 * `Pick2DRect` (32946C10) is the exe's test for a point in a quadrilateral, and `CKTDGUIControl::ContainsPoint` (32924310) and the
 * `ContainsPoint` of `CKTDGUIStatic` (32928E90) are the same test written out again (the cross products are taken in the same order, so
 * every step rounds the same).  The corners are taken in the order left-top, right-top, right-bottom, left-bottom; the
 * point is inside when it is on the same side of all four edges (the four cross products all above 0, or all below 0), so a point on
 * an edge is outside and a quadrilateral that is walked the other way round (left and right swapped) still holds its points.  Every
 * step is one single-precision operation (`subss`, `mulss`) and the compares are `comiss`, for which a NaN is never above or below
 * 0: such a point is outside.
 *
 * The dialog hands a control the point in the control's own layout pixels: `(int)((pt - (int)(scale * m_OffsetPos)) / scale)` per axis
 * (`localPoint`).
 */
import { ftoi } from "./rect.ts";
import type { CKTDGUIControl, UIContext } from "./control.ts";
import type { Rect } from "./rect.ts";

const f = Math.fround;

/** a corner of a quadrilateral (a `D3DXVECTOR2`, or the corner of a `UIPointData`) */
export interface Corner {
  readonly x: number;
  readonly y: number;
}

/**
 * `Pick2DRect(ptMouse, vLeftTop, vRightTop, vLeftBottom, vRightBottom)` (32946C10): the point `(x, y)` (integers) is inside the
 * quadrilateral left-top, right-top, right-bottom, left-bottom.
 */
export function pick2DRect(x: number, y: number, leftTop: Corner, rightTop: Corner, leftBottom: Corner, rightBottom: Corner): boolean {
  const px = f(x), py = f(y);
  const ltx = leftTop.x, lty = leftTop.y, rtx = rightTop.x, rty = rightTop.y;
  const lbx = leftBottom.x, lby = leftBottom.y, rbx = rightBottom.x, rby = rightBottom.y;
  // the edges: left-top -> right-top -> right-bottom -> left-bottom -> left-top
  const e1x = f(rtx - ltx), e1y = f(rty - lty);
  const e2x = f(rbx - rtx), e2y = f(rby - rty);
  const e3x = f(lbx - rbx), e3y = f(lby - rby);
  const e4x = f(ltx - lbx), e4y = f(lty - lby);
  const c1 = f(f(f(py - lty) * e1x) - f(f(px - ltx) * e1y));
  const c2 = f(f(f(py - rty) * e2x) - f(f(px - rtx) * e2y));
  const c3 = f(f(f(py - rby) * e3x) - f(f(px - rbx) * e3y));
  const c4 = f(f(f(py - lby) * e4x) - f(f(px - lbx) * e4y));
  return (c1 > 0 && c2 > 0 && c3 > 0 && c4 > 0) || (c1 < 0 && c2 < 0 && c3 < 0 && c4 < 0);
}

/** `Pick2DRect` on the four corners of an integer rectangle (`rc.left, top` .. `rc.right, bottom`), as the list box and the control list ask it of a scroll bar */
export function pick2DRectOfRect(x: number, y: number, rc: Rect): boolean {
  const left = f(rc.left), top = f(rc.top), right = f(rc.right), bottom = f(rc.bottom);
  return pick2DRect(x, y, { x: left, y: top }, { x: right, y: top }, { x: left, y: bottom }, { x: right, y: bottom });
}

/**
 * `(int)(float)((float)(pt - (int)(float)(scale * m_OffsetPos)) / scale)` for one axis (`mulss`, `cvttss2si`, an integer subtraction,
 * `cvtdq2ps`, `divss`, `cvttss2si`): the coordinate of a point on the screen in the layout pixels of a control whose offset is `offset`.
 */
export function localAxis(pt: number, scale: number, offset: number): number {
  const origin = ftoi(f(scale * offset));
  return ftoi(f(f((pt - origin) | 0) / scale));
}

/** the scale from the layout to the back buffer (`g_pKTDXApp->m_ResolutionScale`; 1 without a render: nothing is scaled) */
export function resolutionScale(ctx: UIContext): { readonly x: number; readonly y: number } {
  return ctx.render?.resolutionScale ?? { x: 1, y: 1 };
}

/** the width of the back buffer in pixels (`DXUTGetBackBufferSurfaceDesc()->Width`; 1024 without a render, the size the layout is made for) */
export function backBufferWidth(ctx: UIContext): number {
  return ctx.render?.backBuffer.width ?? 1024;
}

/** the point `(x, y)` of the screen in the layout pixels of `control` (what every dialog function hands to `ContainsPoint` and `HandleMouse`) */
export function localPoint(ctx: UIContext, control: CKTDGUIControl, x: number, y: number): { x: number; y: number } {
  const scale = resolutionScale(ctx);
  return { x: localAxis(x, scale.x, control.m_OffsetPos.x), y: localAxis(y, scale.y, control.m_OffsetPos.y) };
}
