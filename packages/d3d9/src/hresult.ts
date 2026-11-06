/** HRESULT values the D3D9 layer returns (the client tests them with FAILED()/SUCCEEDED(), i.e. the sign bit). */
export const D3D_OK = 0;
const h = (v: number): number => v | 0;
export const D3DERR_INVALIDCALL = h(0x8876086c);
export const D3DERR_NOTAVAILABLE = h(0x8876086a);
export const D3DERR_DEVICELOST = h(0x88760868);
export const D3DERR_DEVICENOTRESET = h(0x88760869);
export const D3DERR_OUTOFVIDEOMEMORY = h(0x8876017c);
export const D3DERR_WRONGTEXTUREFORMAT = h(0x88760818);
export const D3DERR_WASSTILLDRAWING = h(0x8876021c);
export const D3DXERR_INVALIDDATA = h(0x88760b59);
export const E_FAIL = h(0x80004005);
export const E_OUTOFMEMORY = h(0x8007000e);
export const E_INVALIDARG = h(0x80070057);
export const FAILED = (hr: number): boolean => hr < 0;
export const SUCCEEDED = (hr: number): boolean => hr >= 0;
