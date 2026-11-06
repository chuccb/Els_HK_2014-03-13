/**
 * Direct3D 9 constants.
 *
 * The plain enums (render states, texture-stage states, blend factors, formats, ...) are generated from the definitions IDA
 * recovered into data/x2.exe.h (see enums.generated.ts / tools/gen-d3d9-enums.ts).  What is not an enum in d3d9types.h but a
 * set of #define'd DWORD flags is written down here: FVF codes, D3DTA_*, texture-coordinate generation, lock/usage/clear flags.
 * The FVF values were cross-checked against the four dynamic vertex-buffer formats in CKTDGDynamicVBManager (x2.exe.c L313446..:
 * 66 = XYZ|DIFFUSE, 322 = XYZ|DIFFUSE|TEX1, 258 = XYZ|TEX1, 324 = XYZRHW|DIFFUSE|TEX1).
 */
export * from "./enums.generated.ts";

/** `D3DTS_WORLDMATRIX(n)` (the generated D3DTS enum only has the named states). */
export const D3DTS_WORLD = 256;
export const d3dtsWorldMatrix = (n: number): number => 256 + n;

/** D3DFVF_* flexible-vertex-format flags. */
export const D3DFVF = {
  RESERVED0: 0x001,
  POSITION_MASK: 0x400e,
  XYZ: 0x002,
  XYZRHW: 0x004,
  XYZB1: 0x006,
  XYZB2: 0x008,
  XYZB3: 0x00a,
  XYZB4: 0x00c,
  XYZB5: 0x00e,
  XYZW: 0x4002,
  NORMAL: 0x010,
  PSIZE: 0x020,
  DIFFUSE: 0x040,
  SPECULAR: 0x080,
  TEXCOUNT_MASK: 0xf00,
  TEXCOUNT_SHIFT: 8,
  TEX0: 0x000,
  TEX1: 0x100,
  TEX2: 0x200,
  TEX3: 0x300,
  TEX4: 0x400,
  TEX5: 0x500,
  TEX6: 0x600,
  TEX7: 0x700,
  TEX8: 0x800,
  LASTBETA_UBYTE4: 0x1000,
  LASTBETA_D3DCOLOR: 0x8000,
  RESERVED2: 0x6000,
} as const;

/** D3DFVF_TEXCOORDSIZE1..4(i): the 2-bit size code of texture-coordinate set `i` lives at bits 16+2i. */
export const d3dfvfTexCoordSize = (components: 1 | 2 | 3 | 4, i: number): number =>
  ((components === 1 ? 3 : components === 3 ? 1 : components === 4 ? 2 : 0) << (i * 2 + 16)) >>> 0;

/** D3DTA_* texture-stage argument selectors and modifiers. */
export const D3DTA = {
  SELECTMASK: 0x0000000f,
  DIFFUSE: 0x00000000,
  CURRENT: 0x00000001,
  TEXTURE: 0x00000002,
  TFACTOR: 0x00000003,
  SPECULAR: 0x00000004,
  TEMP: 0x00000005,
  CONSTANT: 0x00000006,
  COMPLEMENT: 0x00000010,
  ALPHAREPLICATE: 0x00000020,
} as const;

/** D3DTSS_TCI_*: texture coordinate generation, OR-ed into D3DTSS_TEXCOORDINDEX (low 16 bits = coordinate set). */
export const D3DTSS_TCI = {
  PASSTHRU: 0x00000000,
  CAMERASPACENORMAL: 0x00010000,
  CAMERASPACEPOSITION: 0x00020000,
  CAMERASPACEREFLECTIONVECTOR: 0x00030000,
  SPHEREMAP: 0x00040000,
} as const;

export const D3DLOCK = {
  READONLY: 0x00000010,
  NOSYSLOCK: 0x00000800,
  NOOVERWRITE: 0x00001000,
  DISCARD: 0x00002000,
  DONOTWAIT: 0x00004000,
  NO_DIRTY_UPDATE: 0x00008000,
} as const;

export const D3DUSAGE = {
  RENDERTARGET: 0x00000001,
  DEPTHSTENCIL: 0x00000002,
  WRITEONLY: 0x00000008,
  SOFTWAREPROCESSING: 0x00000010,
  DONOTCLIP: 0x00000020,
  POINTS: 0x00000040,
  RTPATCHES: 0x00000080,
  NPATCHES: 0x00000100,
  DYNAMIC: 0x00000200,
  AUTOGENMIPMAP: 0x00000400,
  DMAP: 0x00004000,
} as const;

export const D3DCLEAR = { TARGET: 0x1, ZBUFFER: 0x2, STENCIL: 0x4 } as const;

export const D3DCOLORWRITEENABLE = { RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8 } as const;

/** D3DCAPS2/D3DPRESENT flags we need. */
export const D3DPRESENT = { INTERVAL_DEFAULT: 0, INTERVAL_ONE: 1, DONOTWAIT: 1 } as const;

/** D3DCOLOR (A8R8G8B8 packed into a DWORD): helpers. */
export const d3dcolor = (a: number, r: number, g: number, b: number): number => (((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
export const d3dcolorXRGB = (r: number, g: number, b: number): number => d3dcolor(255, r, g, b);
/** `D3DCOLOR_COLORVALUE(r, g, b, a)` for floats in [0,1] (truncating *255, like the macro's `(DWORD)(x*255.f)`). */
export const d3dcolorValue = (r: number, g: number, b: number, a: number): number =>
  d3dcolor(Math.trunc(a * 255), Math.trunc(r * 255), Math.trunc(g * 255), Math.trunc(b * 255));
