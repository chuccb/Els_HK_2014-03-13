/**
 * The Win32 `RECT` and the helpers of user32 that the controls use (`SetRect`, `OffsetRect`), and `CKTDGUIControl::VERTEX_UI`.  Every
 * coordinate is a 32-bit `int`: the helpers wrap like the API does.
 */

/** `tagRECT` */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** `CKTDGUIControl::VERTEX_UI` */
export interface VertexUI {
  x: number;
  y: number;
  z: number;
  rhw: number;
  color: number;
  u: number;
  v: number;
}

export const newRect = (): Rect => ({ left: 0, top: 0, right: 0, bottom: 0 });

export const newVertices = (): VertexUI[] => Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0, rhw: 0, color: 0, u: 0, v: 0 }));

/** `SetRect(rc, left, top, right, bottom)` */
export function setRect(rc: Rect, left: number, top: number, right: number, bottom: number): void {
  rc.left = left | 0;
  rc.top = top | 0;
  rc.right = right | 0;
  rc.bottom = bottom | 0;
}

/** `OffsetRect(rc, dx, dy)` */
export function offsetRect(rc: Rect, dx: number, dy: number): void {
  rc.left = (rc.left + dx) | 0;
  rc.right = (rc.right + dx) | 0;
  rc.top = (rc.top + dy) | 0;
  rc.bottom = (rc.bottom + dy) | 0;
}

/** C++ struct assignment `dst = src` */
export function copyRect(dst: Rect, src: Rect): void {
  dst.left = src.left;
  dst.top = src.top;
  dst.right = src.right;
  dst.bottom = src.bottom;
}

/** `a * b` of two `int`s (the low 32 bits, as `imul` leaves them) */
export const imul = (a: number, b: number): number => Math.imul(a, b);

/** `a / b` of two `int`s: `idiv` truncates toward zero; a zero divisor is the processor's divide error */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new Error("integer division by zero (the exe faults here: EXCEPTION_INT_DIVIDE_BY_ZERO)");
  return (a / b) | 0;
}
