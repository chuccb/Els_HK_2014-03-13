/** WebGPU device + the D3D9 layer presenting to a canvas. */
import { D3DFMT, Direct3DDevice9 } from "@els/d3d9";

export interface BrowserD3D {
  readonly gpu: GPUDevice;
  readonly dev: Direct3DDevice9;
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly adapterInfo: string;
  /** canvas / back buffer format */
  readonly format: GPUTextureFormat;
}

let instance: Promise<BrowserD3D> | null = null;

/** One device for the page (WebGPU hands out an adapter once per request, and the layer is single-device). The back buffer is 1024x768, the client's base resolution. */
export function getBrowserD3D(width = 1024, height = 768): Promise<BrowserD3D> {
  instance ??= (async () => {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    const features = (["texture-compression-bc"] as GPUFeatureName[]).filter((f) => adapter.features.has(f));
    const gpu = await adapter.requestDevice({ requiredFeatures: features });
    gpu.addEventListener("uncapturederror", (e) => console.error("[webgpu]", (e as GPUUncapturedErrorEvent).error.message));
    void gpu.lost.then((info) => console.error(`[webgpu] device lost (${info.reason}): ${info.message}`));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("no webgpu canvas context");
    // ?format=rgba8unorm | bgra8unorm forces the canvas / back buffer format (tests run both: the preferred one differs between platforms)
    const forced = new URLSearchParams(location.search).get("format");
    const format = (forced === "rgba8unorm" || forced === "bgra8unorm" ? forced : navigator.gpu.getPreferredCanvasFormat()) as GPUTextureFormat;
    ctx.configure({ device: gpu, format, alphaMode: "opaque", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
    const dev = new Direct3DDevice9({
      gpu, width, height, backBufferFormat: D3DFMT.X8R8G8B8, backBufferGpuFormat: format,
      warn: (m) => console.warn("[d3d9]", m),
      onPresent: (bb) => {
        const enc = gpu.createCommandEncoder();
        enc.copyTextureToTexture({ texture: bb }, { texture: ctx.getCurrentTexture() }, [width, height]);
        gpu.queue.submit([enc.finish()]);
      },
    });
    const info = adapter.info;
    return { gpu, dev, canvas, width, height, format, adapterInfo: `${info.vendor || "?"} ${info.architecture || ""} ${info.description || ""}`.trim() };
  })();
  return instance;
}
