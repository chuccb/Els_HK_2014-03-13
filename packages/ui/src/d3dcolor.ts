/**
 * The colour the edit boxes' setters make of four floats (`SetTextColor_LUA` and its relatives): `(__int64)(float)(c * 255.0)` per channel
 * (a cast to float, then a truncation, no rounding), packed as `A << 24 | R << 16 | G << 8 | B` in 64 bits with only R, G and B cut to a
 * byte: the exe's own expression, kept in `bigint` so that an alpha outside 0..1 behaves as it does there.
 */
const f = Math.fround;

export function channel(c: number): bigint {
  const v = f(f(c) * 255.0);
  return Number.isFinite(v) && Math.abs(v) < 2 ** 63 ? BigInt(Math.trunc(v)) : -(2n ** 63n); // cvttss2si: the integer indefinite
}

export const byte = (v: bigint): bigint => BigInt.asUintN(8, v);

export function packArgb(r: number, g: number, b: number, a: number): bigint {
  const A = channel(a);
  return BigInt.asUintN(64, (((((A << 8n) | byte(channel(r))) << 8n) | byte(channel(g))) << 8n) | byte(channel(b)));
}

/** the DWORD stored in `m_TextColor` and its relatives (the store keeps the low 32 bits) */
export const d3dColor = (r: number, g: number, b: number, a: number): number => Number(BigInt.asUintN(32, packArgb(r, g, b, a)));

/** the `0.003921569f` the outline colour setter multiplies the channels by */
export const ONE_OVER_255 = f(0.003921569);
