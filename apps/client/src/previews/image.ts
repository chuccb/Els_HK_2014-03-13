import { ImageFormatError, decodeImage, sniffImage } from "@els/assets";
import type { Preview } from "../preview.ts";
import { el } from "../ui.ts";

/** TGA / DDS / BMP / PNG as the exe's D3DX call sees them (level 0, content sniffed); JPEG goes through the browser's decoder. */
export async function imagePreview(name: string, bytes: Uint8Array): Promise<Preview> {
  let width: number, height: number, rgba: Uint8Array, info: string;
  if (sniffImage(bytes) === "jpeg") {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
    width = bmp.width; height = bmp.height;
    const c = new OffscreenCanvas(width, height).getContext("2d")!;
    c.drawImage(bmp, 0, 0);
    rgba = new Uint8Array(c.getImageData(0, 0, width, height).data.buffer);
    info = `${width}x${height} JPEG (decoded by the browser)`;
  } else {
    const img = decodeImage(bytes);
    ({ width, height, rgba } = img);
    info = `${width}x${height} ${img.format} in a ${img.container.toUpperCase()} container${img.hasAlpha ? ", with alpha" : ""}`;
  }
  const canvas = el("canvas", { class: "checker" });
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const fit = el("input", { type: "checkbox", checked: true, onchange: () => canvas.classList.toggle("fit", fit.checked) });
  canvas.classList.add("fit");
  if (width <= 128 && height <= 128) canvas.classList.add("pixelated");
  const bar = el("div", { class: "bar" }, el("label", {}, fit, " fit to window"), el("span", { text: name }));
  const holder = el("div", { class: "imgwrap" }, canvas);
  return {
    el: el("div", { class: "pane" }, bar, holder),
    info,
    dispose() {},
    async snapshot() { return { width, height, rgba }; },
  };
}
export { ImageFormatError };
