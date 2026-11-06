/**
 * Host-side values that the scripts hold as userdata.
 *
 * `D3DXVECTOR2` / `D3DXVECTOR3` / `D3DXCOLOR` are plain C++ structs of `float`s that the exe copies on every crossing of the Lua boundary
 * (`lua_tinker::val2user<T>`: the userdata owns a heap copy; `read<T>` copies it out again). They keep that value semantics here: the
 * components live in a `Float32Array`, so a component is always exactly the float the C++ struct would hold (`v.x = 0.1` stores 0.1f), and
 * the binder clones on read and on push.
 */

/** Anything a script can hold a pointer to (`lua_tinker::ptr2user<T>`): the binder never looks inside. */
export type HostObject = object;

abstract class FloatStruct {
  protected readonly f: Float32Array;
  constructor(n: number, init: ArrayLike<number>) {
    this.f = new Float32Array(n);
    for (let i = 0; i < n; i++) this.f[i] = init[i] ?? 0;
  }
  toArray(): number[] {
    return Array.from(this.f);
  }
}

export class Vec2 extends FloatStruct implements HostObject {
  constructor(x = 0, y = 0) { super(2, [x, y]); }
  get x(): number { return this.f[0]!; }
  set x(v: number) { this.f[0] = v; }
  get y(): number { return this.f[1]!; }
  set y(v: number) { this.f[1] = v; }
  clone(): Vec2 { return new Vec2(this.f[0], this.f[1]); }
  set(x: number, y: number): this { this.f[0] = x; this.f[1] = y; return this; }
}

export class Vec3 extends FloatStruct implements HostObject {
  constructor(x = 0, y = 0, z = 0) { super(3, [x, y, z]); }
  get x(): number { return this.f[0]!; }
  set x(v: number) { this.f[0] = v; }
  get y(): number { return this.f[1]!; }
  set y(v: number) { this.f[1] = v; }
  get z(): number { return this.f[2]!; }
  set z(v: number) { this.f[2] = v; }
  clone(): Vec3 { return new Vec3(this.f[0], this.f[1], this.f[2]); }
  set(x: number, y: number, z: number): this { this.f[0] = x; this.f[1] = y; this.f[2] = z; return this; }
}

/** `D3DXCOLOR`: r, g, b, a in memory order (the Lua constructor is `D3DXCOLOR(r, g, b, a)`). */
export class Color extends FloatStruct implements HostObject {
  constructor(r = 0, g = 0, b = 0, a = 0) { super(4, [r, g, b, a]); }
  get r(): number { return this.f[0]!; }
  set r(v: number) { this.f[0] = v; }
  get g(): number { return this.f[1]!; }
  set g(v: number) { this.f[1] = v; }
  get b(): number { return this.f[2]!; }
  set b(v: number) { this.f[2] = v; }
  get a(): number { return this.f[3]!; }
  set a(v: number) { this.f[3] = v; }
  clone(): Color { return new Color(this.f[0], this.f[1], this.f[2], this.f[3]); }
  set(r: number, g: number, b: number, a: number): this { this.f[0] = r; this.f[1] = g; this.f[2] = b; this.f[3] = a; return this; }
}

/** `KHandleType<int, TAG>`: an `int` the scripts keep as an opaque value (particle sequences, mesh instances, effect sets...). */
export class HostHandle implements HostObject {
  constructor(public id = 0, readonly tag = "") {}
  clone(): HostHandle { return new HostHandle(this.id, this.tag); }
}
