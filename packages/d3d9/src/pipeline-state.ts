/** D3D9 render state -> WebGPU pipeline state translation (blend, depth/stencil, rasteriser, samplers). */
import { D3DBLEND, D3DBLENDOP, D3DCMP, D3DCULL, D3DPT, D3DRS, D3DSAMP, D3DSTENCILOP, D3DTADDRESS, D3DTEXF, D3DCOLORWRITEENABLE } from "./enums.ts";
import { dwordToFloat, NUM_SAMP } from "./state.ts";

export function compareFunc(f: number): GPUCompareFunction {
  switch (f) {
    case D3DCMP.NEVER: return "never";
    case D3DCMP.LESS: return "less";
    case D3DCMP.EQUAL: return "equal";
    case D3DCMP.LESSEQUAL: return "less-equal";
    case D3DCMP.GREATER: return "greater";
    case D3DCMP.NOTEQUAL: return "not-equal";
    case D3DCMP.GREATEREQUAL: return "greater-equal";
    default: return "always";
  }
}

export function stencilOp(o: number): GPUStencilOperation {
  switch (o) {
    case D3DSTENCILOP.ZERO: return "zero";
    case D3DSTENCILOP.REPLACE: return "replace";
    case D3DSTENCILOP.INCRSAT: return "increment-clamp";
    case D3DSTENCILOP.DECRSAT: return "decrement-clamp";
    case D3DSTENCILOP.INVERT: return "invert";
    case D3DSTENCILOP.INCR: return "increment-wrap";
    case D3DSTENCILOP.DECR: return "decrement-wrap";
    default: return "keep";
  }
}

/** D3DBLEND_* -> [factor, forcedOtherFactor?]; BOTHSRCALPHA/BOTHINVSRCALPHA are the legacy shorthand that sets both factors. */
export function blendFactor(b: number): GPUBlendFactor {
  switch (b) {
    case D3DBLEND.ZERO: return "zero";
    case D3DBLEND.ONE: return "one";
    case D3DBLEND.SRCCOLOR: return "src";
    case D3DBLEND.INVSRCCOLOR: return "one-minus-src";
    case D3DBLEND.SRCALPHA: return "src-alpha";
    case D3DBLEND.INVSRCALPHA: return "one-minus-src-alpha";
    case D3DBLEND.DESTALPHA: return "dst-alpha";
    case D3DBLEND.INVDESTALPHA: return "one-minus-dst-alpha";
    case D3DBLEND.DESTCOLOR: return "dst";
    case D3DBLEND.INVDESTCOLOR: return "one-minus-dst";
    case D3DBLEND.SRCALPHASAT: return "src-alpha-saturated";
    case D3DBLEND.BLENDFACTOR: return "constant";
    case D3DBLEND.INVBLENDFACTOR: return "one-minus-constant";
    case D3DBLEND.BOTHSRCALPHA: return "src-alpha";
    case D3DBLEND.BOTHINVSRCALPHA: return "one-minus-src-alpha";
    default: return "one"; // dual-source blending (SRCCOLOR2) is not available
  }
}

export function blendOperation(o: number): GPUBlendOperation {
  switch (o) {
    case D3DBLENDOP.SUBTRACT: return "subtract";
    case D3DBLENDOP.REVSUBTRACT: return "reverse-subtract";
    case D3DBLENDOP.MIN: return "min";
    case D3DBLENDOP.MAX: return "max";
    default: return "add";
  }
}

/** The WebGPU blend state for the current render states, or undefined when blending is off. */
export function blendState(rs: Uint32Array): GPUBlendState | undefined {
  if (!rs[D3DRS.ALPHABLENDENABLE]) return undefined;
  let src = rs[D3DRS.SRCBLEND]!, dst = rs[D3DRS.DESTBLEND]!;
  if (src === D3DBLEND.BOTHSRCALPHA) dst = D3DBLEND.INVSRCALPHA;
  else if (src === D3DBLEND.BOTHINVSRCALPHA) dst = D3DBLEND.SRCALPHA;
  let op = rs[D3DRS.BLENDOP]!;
  const color = mkComponent(src, dst, op);
  if (!rs[D3DRS.SEPARATEALPHABLENDENABLE]) return { color, alpha: color };
  let sa = rs[D3DRS.SRCBLENDALPHA]!, da = rs[D3DRS.DESTBLENDALPHA]!;
  if (sa === D3DBLEND.BOTHSRCALPHA) da = D3DBLEND.INVSRCALPHA;
  else if (sa === D3DBLEND.BOTHINVSRCALPHA) da = D3DBLEND.SRCALPHA;
  op = rs[D3DRS.BLENDOPALPHA]!;
  return { color, alpha: mkComponent(sa, da, op) };
}
function mkComponent(src: number, dst: number, op: number): GPUBlendComponent {
  const o = blendOperation(op);
  // min/max ignore the factors in D3D; WebGPU requires them to be "one"
  if (o === "min" || o === "max") return { operation: o, srcFactor: "one", dstFactor: "one" };
  return { operation: o, srcFactor: blendFactor(src), dstFactor: blendFactor(dst) };
}

/** D3DCOLORWRITEENABLE_* bits -> GPUColorWrite mask (alpha dropped for formats without alpha). */
export function colorWriteMask(bits: number, hasAlpha: boolean): number {
  let m = 0;
  if (bits & D3DCOLORWRITEENABLE.RED) m |= GPUColorWrite.RED;
  if (bits & D3DCOLORWRITEENABLE.GREEN) m |= GPUColorWrite.GREEN;
  if (bits & D3DCOLORWRITEENABLE.BLUE) m |= GPUColorWrite.BLUE;
  if (hasAlpha && (bits & D3DCOLORWRITEENABLE.ALPHA)) m |= GPUColorWrite.ALPHA;
  return m;
}

/** The D3D cull mode as WebGPU face culling.  D3D's front faces are clockwise (as seen on screen), so `frontFace` is "cw". */
export function cullState(mode: number): { frontFace: GPUFrontFace; cullMode: GPUCullMode } {
  switch (mode) {
    case D3DCULL.CW: return { frontFace: "cw", cullMode: "front" };
    case D3DCULL.CCW: return { frontFace: "cw", cullMode: "back" };
    default: return { frontFace: "cw", cullMode: "none" };
  }
}

export function topology(prim: number): { topology: GPUPrimitiveTopology; isFan: boolean } {
  switch (prim) {
    case D3DPT.POINTLIST: return { topology: "point-list", isFan: false };
    case D3DPT.LINELIST: return { topology: "line-list", isFan: false };
    case D3DPT.LINESTRIP: return { topology: "line-strip", isFan: false };
    case D3DPT.TRIANGLESTRIP: return { topology: "triangle-strip", isFan: false };
    case D3DPT.TRIANGLEFAN: return { topology: "triangle-list", isFan: true };
    default: return { topology: "triangle-list", isFan: false };
  }
}

/** Number of vertices (or indices) a D3DPRIMITIVETYPE draw of `n` primitives consumes. */
export function vertexCountFor(prim: number, n: number): number {
  switch (prim) {
    case D3DPT.POINTLIST: return n;
    case D3DPT.LINELIST: return n * 2;
    case D3DPT.LINESTRIP: return n + 1;
    case D3DPT.TRIANGLELIST: return n * 3;
    default: return n + 2; // strip and fan
  }
}

const addressMode = (a: number): GPUAddressMode => {
  switch (a) {
    case D3DTADDRESS.MIRROR: return "mirror-repeat";
    case D3DTADDRESS.CLAMP: case D3DTADDRESS.BORDER: case D3DTADDRESS.MIRRORONCE: return "clamp-to-edge";
    default: return "repeat";
  }
};

/** Sampler descriptor for sampler slot `slot` of a `samp` state table. */
export function samplerDescriptor(samp: Uint32Array, slot: number): GPUSamplerDescriptor {
  const o = slot * NUM_SAMP;
  const mag = samp[o + D3DSAMP.MAGFILTER]!, min = samp[o + D3DSAMP.MINFILTER]!, mip = samp[o + D3DSAMP.MIPFILTER]!;
  const aniso = mag === D3DTEXF.ANISOTROPIC || min === D3DTEXF.ANISOTROPIC;
  const linear = (f: number): boolean => f === D3DTEXF.LINEAR || f === D3DTEXF.ANISOTROPIC || f === D3DTEXF.PYRAMIDALQUAD || f === D3DTEXF.GAUSSIANQUAD;
  const d: GPUSamplerDescriptor = {
    addressModeU: addressMode(samp[o + D3DSAMP.ADDRESSU]!),
    addressModeV: addressMode(samp[o + D3DSAMP.ADDRESSV]!),
    addressModeW: addressMode(samp[o + D3DSAMP.ADDRESSW]!),
    magFilter: linear(mag) ? "linear" : "nearest",
    minFilter: linear(min) ? "linear" : "nearest",
    mipmapFilter: mip === D3DTEXF.LINEAR ? "linear" : "nearest",
    lodMinClamp: Math.min(samp[o + D3DSAMP.MAXMIPLEVEL]!, 15),
    // D3DTEXF_NONE: no mip mapping, the base level only
    lodMaxClamp: mip === D3DTEXF.NONE || mip === 0 ? Math.min(samp[o + D3DSAMP.MAXMIPLEVEL]!, 15) : 32,
  };
  if (aniso) {
    d.maxAnisotropy = Math.max(1, Math.min(16, samp[o + D3DSAMP.MAXANISOTROPY]!));
    if (d.maxAnisotropy > 1) { d.magFilter = "linear"; d.minFilter = "linear"; d.mipmapFilter = "linear"; }
  }
  return d;
}
export const samplerKey = (d: GPUSamplerDescriptor): string =>
  `${d.addressModeU}${d.addressModeV}${d.addressModeW}${d.magFilter}${d.minFilter}${d.mipmapFilter}${d.lodMinClamp}${d.lodMaxClamp}${d.maxAnisotropy ?? 1}`;

export { dwordToFloat };
