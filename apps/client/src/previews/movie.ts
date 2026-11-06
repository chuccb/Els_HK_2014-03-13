import { Mpeg1Movie, yuv420ToBgra } from "@els/assets";
import type { Preview } from "../preview.ts";
import { el } from "../ui.ts";

/** data/movie/*.avi: the software MPEG-1 decoder (packages/assets) at the movie's frame rate, drawn on a 2D canvas. */
export function moviePreview(name: string, bytes: Uint8Array): Preview {
  const movie = Mpeg1Movie.open(bytes);
  const { width, height, frameCount, frameRate, durationMs } = movie.info;
  const canvas = el("canvas", { class: "movie" });
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(width, height);
  let rgba = new Uint8Array(image.data.buffer);
  let shown = -1, decodeMs = 0, playing = true, startedAt = performance.now(), startFrame = 0, raf = 0;
  const label = el("span", { class: "mono" });
  const slider = el("input", { type: "range", min: "0", max: String(frameCount - 1), value: "0", oninput: () => { show(Number(slider.value)); startedAt = performance.now(); startFrame = shown; } });
  const toggle = el("button", { text: "pause", onclick: () => { playing = !playing; toggle.textContent = playing ? "pause" : "play"; startedAt = performance.now(); startFrame = shown; } });

  function show(i: number): void {
    i = Math.max(0, Math.min(frameCount - 1, i));
    const t0 = performance.now();
    let f = null;
    if (i === shown + 1) f = movie.next();
    else { f = movie.frame(i); }
    if (!f) return;
    decodeMs = performance.now() - t0;
    const bgra = yuv420ToBgra(f);
    for (let p = 0; p < bgra.length; p += 4) { rgba[p] = bgra[p + 2]!; rgba[p + 1] = bgra[p + 1]!; rgba[p + 2] = bgra[p]!; rgba[p + 3] = 255; }
    ctx.putImageData(image, 0, 0);
    shown = i;
    slider.value = String(i);
    label.textContent = `frame ${i + 1}/${frameCount}  ${decodeMs.toFixed(1)} ms decode`;
  }
  function tick(): void {
    if (playing) {
      const want = (startFrame + Math.floor(((performance.now() - startedAt) * frameRate.num) / (1000 * frameRate.den))) % frameCount;
      if (want !== shown) show(want);
    }
    raf = requestAnimationFrame(tick);
  }
  show(0);
  raf = requestAnimationFrame(tick);
  void rgba;
  return {
    el: el("div", { class: "pane" }, el("div", { class: "bar" }, toggle, slider, label), el("div", { class: "imgwrap" }, canvas)),
    info: `${width}x${height}, ${frameCount} pictures at ${(frameRate.num / frameRate.den).toFixed(2)} fps (${(durationMs / 1000).toFixed(1)} s), MPEG-1 in AVI`,
    dispose() { cancelAnimationFrame(raf); },
    async snapshot() { return { width, height, rgba: new Uint8Array(rgba) }; },
    state() { return { shown, frameCount, playing }; },
  };
}
