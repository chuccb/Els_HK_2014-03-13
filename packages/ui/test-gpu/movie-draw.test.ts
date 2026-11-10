/**
 * A movie of the client's own files drawn through the whole stack on the device: the player of the platform (`Mpeg1VideoLibrary`), `CMovieData::OnFrameMove`
 * copying the frame that is due into the video texture (`CBandiVideoTexture_DX9`), `CKTDGUIStatic::OnFrameRender` placing the movie in its dialog,
 * `CMovieData::OnFrameRender` drawing the video into the render target texture (`CKTDXDeviceRenderTargetTexture`: its own target, cleared) and the render target
 * texture onto the back buffer; and the same two draws composed again on the CPU by the rules of Direct3D 9 (`reference.ts`), the second one from the
 * pixels the first one left in the render target texture.  Needs a WebGPU adapter (`./tools/gpu.sh`: SwiftShader) and `data/movie`.
 *
 * The movie is `movie_create_es_base.avi` (400 x 220); the dialog is at (100, 50) and the movie's rectangle at (20, 30) in it, so the render target
 * texture is drawn at (120, 80): its quad runs from (119.5, 79.5) to (520, 300) and covers the pixels 120 .. 519 and 80 .. 299.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Mpeg1Movie, StringTable, yuv420ToBgra } from "@els/assets";
import { D3DCLEAR } from "@els/d3d9";
import { BandiVideoTextureDX9, CKTDGUIDialog, CKTDGUIStatic, CMovieData, installMovies } from "../src/index.ts";
import { gpuAvailable, newD3D9, snap } from "../../d3d9/test/gpu-helper.ts";
import { setup } from "../test/harness.ts";
import { CLEAR, HEIGHT, TOLERANCE, WIDTH, composeDraws, recordDraws } from "./draw.ts";
import { compareImages, newTarget } from "./reference.ts";
import type { RefImage } from "./reference.ts";

const FILE = join(import.meta.dir, "..", "..", "..", "data", "movie", "movie_create_es_base.avi");
const HAVE_GPU = existsSync(FILE) && (await gpuAvailable());
const suite = HAVE_GPU ? describe : describe.skip;

/** frame `n` of the file as R, G, B, A (the decoder's own, bit-exact against the MPEG-1 oracle) */
function frameImage(n: number): RefImage {
  const f = Mpeg1Movie.open(new Uint8Array(readFileSync(FILE))).frame(n)!;
  const bgra = yuv420ToBgra(f);
  const rgba = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]!;
    rgba[i + 1] = bgra[i + 1]!;
    rgba[i + 2] = bgra[i]!;
    rgba[i + 3] = 255;
  }
  return { width: f.width, height: f.height, rgba };
}

suite("a movie drawn through the whole stack", () => {
  async function scene(shown: boolean, atMs: number, savedAs?: string) {
    const dev = await newD3D9(WIDTH, HEIGHT);
    const { w } = setup(new StringTable([]), { device: dev, backBuffer: { width: WIDTH, height: HEIGHT } });
    const clock = { t: 0 };
    const file = new Uint8Array(readFileSync(FILE));
    installMovies(w.devices, (name) => (name === "es.avi" ? file : null), () => clock.t);
    w.devices.currentDirectory = "C:\\Els";
    const dialog = new CKTDGUIDialog(w);
    dialog.m_Pos.set(100, 50);
    const control = new CKTDGUIStatic(w);
    dialog.AddControl(control);
    const movie = new CMovieData(w);
    movie.SetRect(20, 30, 400, 220);
    movie.SetMovieFileName("es.avi"); // the player starts at the clock's 0
    movie.m_bShow = shown;
    control.AddMovieData(movie);
    clock.t = atMs;
    control.onFrameMove(0, 0);
    const rec = recordDraws(w.render!);
    dev.BeginScene();
    try {
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, (0xff000000 | (CLEAR[0]! << 16) | (CLEAR[1]! << 8) | CLEAR[2]!) >>> 0, 1, 0);
      dialog.onFrameRender(true);
    } finally {
      dev.EndScene();
      rec.stop();
    }
    const shot = await snap(dev);
    if (savedAs) shot.save(savedAs);
    const image: RefImage = { width: shot.width, height: shot.height, rgba: shot.rgba };
    return { w, dev, movie, draws: rec.draws, image };
  }

  test("frame 24 (the player's clock at 1,000 ms): the video is drawn into the render target texture and that onto the back buffer, as Direct3D 9 does it", async () => {
    const { w, movie, draws, image, dev } = await scene(true, 1000, "ui-movie-frame24");
    // two draws: the video texture into the render target texture, the render target texture onto the back buffer
    expect(draws.length).toBe(2);
    const [video, target] = [draws[0]!, draws[1]!];
    expect([video.type, video.primitive, video.numPrimitives, video.numDraws, video.data.length]).toEqual([3, 5, 2, 1, 112]);
    expect([target.type, target.primitive, target.numPrimitives, target.numDraws, target.data.length]).toEqual([3, 5, 2, 1, 112]);
    expect(video.texture).toBe((movie.m_pBvt as BandiVideoTextureDX9).m_texture); // the video texture ...
    expect(target.texture).toBe(movie.m_pRenderTargetTexture!.m_pRenderTargetTexture); // ... then the render target texture
    expect([video.addressU, video.addressV, video.minFilter, video.magFilter]).toEqual([3, 3, 2, 2]); // clamped, linear
    expect([target.alphaTest, target.alphaFunc, target.alphaRef, target.cullMode]).toEqual([1, 6, 0, 2]); // akRSICKTDXDeviceTexture
    // the render target texture holds the video as Direct3D draws it into a 400 x 220 target (the quad has no half pixel taken off: the texels are shifted)
    const rtt = composeDraws([video], () => frameImage(24), newTarget(400, 220, 0, 0, 0));
    expect(rtt.referenceError).toBeUndefined();
    const reference = composeDraws([target], () => rtt.reference);
    expect(reference.referenceError).toBeUndefined();
    const d = compareImages(image, reference.reference, TOLERANCE);
    expect(d.over, JSON.stringify(d.firstOver)).toBe(0);
    // it is a picture of the movie, in the right place: the pixels of the rectangle are not the clear colour, those around it are
    const rect = (x0: number, y0: number, x1: number, y1: number): RefImage => {
      const rgba = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
      for (let y = y0; y < y1; y++) rgba.set(image.rgba.subarray((y * WIDTH + x0) * 4, (y * WIDTH + x1) * 4), (y - y0) * (x1 - x0) * 4);
      return { width: x1 - x0, height: y1 - y0, rgba };
    };
    const inside = rect(120, 80, 520, 300);
    expect(compareImages(inside, newTarget(400, 220, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!), 0).over).toBeGreaterThan(87_000);
    for (const strip of [rect(119, 80, 120, 300), rect(520, 80, 521, 300), rect(120, 79, 520, 80), rect(120, 300, 520, 301)]) {
      expect(compareImages(strip, newTarget(strip.width, strip.height, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!), 0).over).toBe(0);
    }
    // it is the picture of frame 24: the mean colour of the rectangle is the frame's (the two draws only shift and blur the texels by half a pixel each)
    const mean = (img: RefImage): number[] => {
      const sum = [0, 0, 0];
      for (let i = 0; i < img.width * img.height; i++) for (let c = 0; c < 3; c++) sum[c]! += img.rgba[i * 4 + c]!;
      return sum.map((v) => v / (img.width * img.height));
    };
    const [shown, wanted] = [mean(inside), mean(frameImage(24))];
    for (let c = 0; c < 3; c++) expect(Math.abs(shown[c]! - wanted[c]!)).toBeLessThan(2);
    expect(wanted.some((v) => v > 20)).toBe(true); // a frame with something in it
    expect(w.render!.states.stackPointer).toBe(0);
    expect(w.devices.massFiles.log.entries).toEqual([]);
    // the device is back on the back buffer (the next scene of the world draws there)
    expect(dev.GetRenderTarget(0)!.GetDesc().Width).toBe(WIDTH);
  }, 120_000);

  test("another moment (3,000 ms: frame 72) is another picture; frame 0 is black", async () => {
    const a = await scene(true, 3000, "ui-movie-frame72");
    const rtt = composeDraws([a.draws[0]!], () => frameImage(72), newTarget(400, 220, 0, 0, 0));
    const reference = composeDraws([a.draws[1]!], () => rtt.reference);
    expect(reference.referenceError).toBeUndefined();
    expect(compareImages(a.image, reference.reference, TOLERANCE).over).toBe(0);
    const b = await scene(true, 0);
    const black = composeDraws([b.draws[0]!], () => frameImage(0), newTarget(400, 220, 0, 0, 0));
    const blackReference = composeDraws([b.draws[1]!], () => black.reference);
    expect(compareImages(b.image, blackReference.reference, TOLERANCE).over).toBe(0);
    expect(compareImages(a.image, b.image, 10).over).toBeGreaterThan(50_000); // not the same picture
  }, 120_000);

  test("a movie that is not shown draws nothing: no draw, no clear of the render target, the back buffer is the clear colour", async () => {
    const { draws, image } = await scene(false, 1000);
    expect(draws.length).toBe(0);
    expect(compareImages(image, newTarget(WIDTH, HEIGHT, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!), 0).over).toBe(0);
  }, 120_000);
});
