/**
 * The platform's video player (`Mpeg1VideoLibrary`, video.ts) and the wiring that makes a world play its movies (`installMovies`).  The player stands in for
 * Bandisoft's bdvid32.dll, which is not part of x2.exe: there is no oracle for it, so these tests pin the contract the exe relies on (what `IBandiVideo2`'s
 * `GetStatus`, `IsNextFrame`, `GetFrame`, `Seek`, `Play` and `Stop` answer for `CMovieData::OnFrameMove`) and the pixels, which are the decoder's
 * (`@els/assets`: bit-exact against the MPEG-1 oracle, packages/assets/test/mpeg1.test.ts) converted to the texture's format.  The movie is the smallest
 * of the client's own, `data/movie/movie_create_es_base.avi`: 400 x 220, 459 frames at 24 / 1 frames per second (19,125 ms).
 *
 * The clock is a number the test moves: the frame that is due at `t` milliseconds after `Play` is `floor(t * 24 / 1000)` (counted from where the movie
 * started), so frame 1 is due from 41.67 ms, frame 24 at 1,000 ms.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Mpeg1Movie, yuv420ToBgra } from "@els/assets";
import { BVLPF, BVL_E_ALREADY_CREATED, BVL_E_NOT_CREATED, BVL_SEEK, BVL_STATUS, CMovieData, E_FAIL, Mpeg1VideoLibrary, installMovies } from "../src/index.ts";
import type { BvlFrame } from "../src/index.ts";
import { movieWorld } from "./moviedevice.ts";

const FILE = join(import.meta.dir, "..", "..", "..", "data", "movie", "movie_create_es_base.avi");
const suite = existsSync(FILE) ? describe : describe.skip;

const bytes = (): Uint8Array => new Uint8Array(readFileSync(FILE));

const tag = (data: Uint8Array, at: number): string => String.fromCharCode(...data.subarray(at, at + 4));

/** the movie with another frame rate: dwRate / dwScale of the header of its video stream (`strh`: scale at 20, rate at 24 of the chunk's data) are `num` / `den` */
function rated(num: number, den: number): Uint8Array {
  const data = bytes();
  let at = 12;
  while (!(tag(data, at) === "strh" && tag(data, at + 8) === "vids")) at++;
  const view = new DataView(data.buffer);
  view.setUint32(at + 8 + 20, den, true);
  view.setUint32(at + 8 + 24, num, true);
  return data;
}

/** the movie with one more chunk of its video stream at the end of the `movi` list (four zero bytes: no picture in it), which the table counts as a frame */
function withEmptyChunk(): Uint8Array {
  const data = bytes();
  let list = 12;
  while (!(tag(data, list) === "LIST" && tag(data, list + 8) === "movi")) list++;
  const view = new DataView(data.buffer);
  const end = list + 8 + view.getUint32(list + 4, true); // the `idx1` chunk starts here
  const out = new Uint8Array(data.length + 12);
  out.set(data.subarray(0, end), 0);
  out.set([0x30, 0x30, 0x64, 0x63, 4, 0, 0, 0], end); // "00dc", 4 bytes of data (zeros)
  out.set(data.subarray(end), end + 12);
  const sizes = new DataView(out.buffer);
  sizes.setUint32(list + 4, view.getUint32(list + 4, true) + 12, true);
  sizes.setUint32(4, view.getUint32(4, true) + 12, true);
  return out;
}

/** a player on the movie (or on the bytes of another file) with a clock the test sets */
function open(created = true, file: () => Uint8Array = bytes) {
  const clock = { t: 0 };
  const asked: string[] = [];
  const lib = new Mpeg1VideoLibrary((path) => (asked.push(path), path === "es.avi" ? file() : null), () => clock.t);
  if (created) {
    lib.create();
    expect(lib.open("es.avi")).toBe(0);
  }
  return { lib, clock, asked };
}

/**
 * a frame buffer of `width` x `height` pixels of `bytesPerPixel` bytes, rows `pitch` bytes apart, filled with 0xAA (the bytes between the rows must stay),
 * and `guard` more bytes behind the last row (memory that is not the frame's, which must stay as well)
 */
function buffer(format: number, width = 400, height = 220, bytesPerPixel = 4, padding = 16, guard = 0): BvlFrame {
  const pitch = width * bytesPerPixel + padding;
  return { frame_buf: new Uint8Array(pitch * height + guard).fill(0xaa), frame_buf_size: pitch * height, pitch, width, height, pixel_format: format, frame_time: -1n, frame_number: -1n };
}

/** the decoder's frame `n` as B, G, R, 255 bytes (the order of a little-endian X8R8G8B8 pixel) */
const decoded = (n: number): { bgra: Uint8Array; width: number; height: number } => {
  const f = Mpeg1Movie.open(bytes()).frame(n)!;
  return { bgra: yuv420ToBgra(f), width: f.width, height: f.height };
};

const status = (lib: Mpeg1VideoLibrary): number => {
  const out = { status: 99 };
  expect(lib.getStatus(out)).toBe(0);
  return out.status;
};

suite("Mpeg1VideoLibrary: the player of the platform", () => {
  test("Create works once (a second one is 0x85861021), Verify needs a created player; Destroy takes the player away again", () => {
    const lib = new Mpeg1VideoLibrary(() => null, () => 0);
    expect([lib.isCreated(), lib.verify()]).toEqual([false, BVL_E_NOT_CREATED]);
    expect(lib.create()).toBe(0);
    expect([lib.isCreated(), lib.verify(), lib.create()]).toEqual([true, 0, BVL_E_ALREADY_CREATED]);
    expect(BVL_E_ALREADY_CREATED >>> 0).toBe(0x85861021);
    lib.destroy();
    expect([lib.isCreated(), lib.verify()]).toEqual([false, BVL_E_NOT_CREATED]);
    expect(lib.create()).toBe(0);
  });

  test("a player that is not created answers every call with 0x85861023 (IsNextFrame: 0) and writes nothing", () => {
    const { lib } = open(false);
    const out = { status: 99 };
    const frame = buffer(BVLPF.X8R8G8B8);
    expect([lib.open("es.avi"), lib.play(), lib.stop(), lib.seek(0n, 0), lib.getStatus(out), lib.getFrame(frame, 1)]).toEqual(Array(6).fill(BVL_E_NOT_CREATED));
    expect([lib.isNextFrame(), out.status, frame.frame_number, frame.frame_buf[0]]).toEqual([0, 99, -1n, 0xaa]);
    expect(BVL_E_NOT_CREATED >>> 0).toBe(0x85861023);
  });

  test("Open: a file that is not there, and one that is no AVI with an MPEG-1 video, are E_FAIL and leave the player closed; the path is passed on as it is", () => {
    const { lib, asked } = open(false);
    lib.create();
    expect(lib.open("C:\\Els\\movie\\none.avi")).toBe(E_FAIL);
    expect(status(lib)).toBe(BVL_STATUS.CLOSED);
    const garbage = new Mpeg1VideoLibrary(() => new Uint8Array(64).fill(7), () => 0);
    garbage.create();
    expect(garbage.open("junk")).toBe(E_FAIL);
    expect(status(garbage)).toBe(BVL_STATUS.CLOSED);
    expect(asked).toEqual(["C:\\Els\\movie\\none.avi"]);
    expect(lib.open("es.avi")).toBe(0);
    expect(status(lib)).toBe(BVL_STATUS.READY);
    expect(lib.open("none.avi")).toBe(E_FAIL); // the failing Open closes what was open
    expect(status(lib)).toBe(BVL_STATUS.CLOSED);
    expect(lib.play()).toBe(BVL_E_NOT_CREATED);
  });

  test("GetVideoInfo: the size, 24 / 1 frames per second, 459 frames, 19,125 ms (nothing before a file is open)", () => {
    const { lib } = open();
    const info = lib.getVideoInfo();
    expect([info.width, info.height, info.fps_rate, info.fps_scale, info.total_frames, info.total_time]).toEqual([400, 220, 24, 1, 459n, 19125n]);
    expect([info.samplerate, info.channels]).toEqual([0, 0]); // (no sound: the exe makes the library without a sound object)
    const closed = open(false).lib;
    closed.create();
    expect([closed.getVideoInfo().width, closed.getVideoInfo().height]).toEqual([0, 0]);
  });

  test("GetVideoInfo with other rates: the time is the frames' time in milliseconds, rounded to the nearest (459 frames at 30000 / 1001: 15,315.3; at 13: 35,307.69; at 7: 65,571.43)", () => {
    for (const [num, den, time] of [[30000, 1001, 15315n], [13, 1, 35308n], [7, 1, 65571n]] as const) {
      const info = open(true, () => rated(num, den)).lib.getVideoInfo();
      expect([num, den, info.fps_rate, info.fps_scale, info.total_frames, info.total_time]).toEqual([num, den, num, den, 459n, time]);
    }
  });

  test("Open starts a movie from its first frame: where Seek put the movie before it, and the frame it gave, are forgotten", () => {
    const { lib, clock } = open();
    lib.play();
    expect(lib.seek(100n, BVL_SEEK.FRAME)).toBe(0);
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(100n); // the movie is at frame 100 and has given it
    expect(lib.open("es.avi")).toBe(0);
    expect([status(lib), lib.isNextFrame()]).toEqual([BVL_STATUS.READY, 0]);
    expect(lib.play()).toBe(0);
    expect(lib.isNextFrame()).toBe(1); // frame 0 is due, and no frame was given: not "100 was"
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(0n); // not 100: the place Seek chose is gone
    clock.t = 41; // (41 ms * 24 / 1000 = 0.98: the next frame is not due yet)
    expect(lib.isNextFrame()).toBe(0);
  });

  test("Stop forgets where the movie was and the frame it gave: Play after it starts at frame 0 again, whatever Seek had chosen", () => {
    const { lib } = open();
    lib.play();
    expect(lib.seek(100n, BVL_SEEK.FRAME)).toBe(0);
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(100n);
    expect(lib.stop()).toBe(0);
    expect(lib.play()).toBe(0);
    expect(lib.isNextFrame()).toBe(1); // frame 0 is due, and nothing was given since
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(0n);
  });

  test("a movie that has not been told to play has no frame due; Play at t = 5,000 ms: frame 0 is due at once, frame 1 from 41.67 ms on", () => {
    const { lib, clock } = open();
    clock.t = 4000;
    expect([lib.isNextFrame(), status(lib)]).toEqual([0, BVL_STATUS.READY]);
    clock.t = 5000;
    expect(lib.play()).toBe(0);
    expect([lib.isNextFrame(), status(lib)]).toEqual([1, BVL_STATUS.PLAYING]);
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect([frame.frame_number, frame.frame_time]).toEqual([0n, 0n]);
    expect(lib.isNextFrame()).toBe(0);
    clock.t = 5041; // 41 ms * 24 / 1000 = 0.984
    expect(lib.isNextFrame()).toBe(0);
    clock.t = 5042; // 42 ms * 24 / 1000 = 1.008
    expect(lib.isNextFrame()).toBe(1);
  });

  test("GetFrame copies the frame that is due, as B, G, R, 255 for each pixel, row by row at the pitch; the bytes between the rows stay; the number and time of the frame are written", () => {
    const { lib, clock } = open();
    lib.play();
    clock.t = 1000; // frame 24 is due: 1000 * 24 / 1000
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    const want = decoded(24);
    for (let y = 0; y < 220; y++) {
      expect([y, Array.from(frame.frame_buf.subarray(y * frame.pitch, y * frame.pitch + 1600))]).toEqual([y, Array.from(want.bgra.subarray(y * 1600, (y + 1) * 1600))]);
      expect([y, frame.frame_buf.subarray(y * frame.pitch + 1600, (y + 1) * frame.pitch).every((b) => b === 0xaa)]).toEqual([y, true]);
    }
    // the middle pixel (200, 110) of frame 24: B 62, G 146, R 126, as the decoder (and Direct3D's X8R8G8B8 memory) has it
    const mid = 110 * frame.pitch + 200 * 4;
    expect(Array.from(frame.frame_buf.subarray(mid, mid + 4))).toEqual([62, 146, 126, 255]);
    expect([frame.frame_number, frame.frame_time]).toEqual([24n, 1000n]); // 24 * 1000 / 24 ms
  });

  test("a frame that is not due is E_FAIL and touches nothing; the frame is given once: after it nothing is due until the next frame's time", () => {
    const { lib, clock } = open();
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(E_FAIL); // not playing
    lib.play();
    expect(lib.getFrame(frame, 1)).toBe(0);
    const taken = frame.frame_buf.slice();
    expect(lib.getFrame(frame, 1)).toBe(E_FAIL); // given already
    expect(frame.frame_buf).toEqual(taken);
    clock.t = 10;
    expect(lib.getFrame(frame, 0)).toBe(E_FAIL);
  });

  test("CanSkip: a player that is behind gives the frame that is due now (1), or the next one of the sequence (0)", () => {
    const skip = open();
    skip.lib.play();
    skip.clock.t = 500; // frame 12 is due
    const a = buffer(BVLPF.X8R8G8B8);
    expect(skip.lib.getFrame(a, 1)).toBe(0);
    expect(a.frame_number).toBe(12n);
    const seq = open();
    seq.lib.play();
    seq.clock.t = 500;
    const b = buffer(BVLPF.X8R8G8B8);
    expect(seq.lib.getFrame(b, 0)).toBe(0);
    expect(b.frame_number).toBe(0n);
    expect(seq.lib.getFrame(b, 0)).toBe(0);
    expect(b.frame_number).toBe(1n);
    expect(Array.from(b.frame_buf.subarray(110 * b.pitch + 800, 110 * b.pitch + 804))).toEqual([9, 21, 19, 255]); // the middle pixel of frame 1
  });

  test("the pixel formats the texture asks for: X8R8G8B8 and A8R8G8B8 (4 bytes, alpha 255), R8G8B8 (3), R5G6B5 and R5G5B5 (2 bytes, low byte first)", () => {
    // the middle pixel of frame 24: R 126, G 146, B 62
    const cases: [number, number, number[]][] = [
      [BVLPF.X8R8G8B8, 4, [62, 146, 126, 255]],
      [BVLPF.A8R8G8B8, 4, [62, 146, 126, 255]],
      [BVLPF.R8G8B8, 3, [62, 146, 126]],
      // R5G6B5: (126 >> 3) << 11 | (146 >> 2) << 5 | 62 >> 3 = 15 * 2048 + 36 * 32 + 7 = 31879 = 0x7C87
      [BVLPF.R5G6B5, 2, [0x87, 0x7c]],
      // R5G5B5: (126 >> 3) << 10 | (146 >> 3) << 5 | 62 >> 3 = 15 * 1024 + 18 * 32 + 7 = 15943 = 0x3E47
      [BVLPF.R5G5B5, 2, [0x47, 0x3e]],
    ];
    for (const [format, size, pixel] of cases) {
      const { lib, clock } = open();
      lib.play();
      clock.t = 1000;
      const frame = buffer(format, 400, 220, size);
      expect(lib.getFrame(frame, 1)).toBe(0);
      const mid = 110 * frame.pitch + 200 * size;
      expect([format, Array.from(frame.frame_buf.subarray(mid, mid + size))]).toEqual([format, pixel]);
      expect([format, frame.frame_buf.subarray(220 * 0 + 400 * size, frame.pitch).every((b) => b === 0xaa)]).toEqual([format, true]); // the first row's padding
    }
  });

  test("a buffer smaller than the video gets the part that fits (the rows and columns it has); what follows the last row is not written", () => {
    const { lib, clock } = open();
    lib.play();
    clock.t = 1000;
    const frame = buffer(BVLPF.X8R8G8B8, 300, 100, 4, 0, 1200);
    expect(lib.getFrame(frame, 1)).toBe(0);
    const want = decoded(24);
    for (const y of [0, 50, 99]) expect(Array.from(frame.frame_buf.subarray(y * 1200, (y + 1) * 1200))).toEqual(Array.from(want.bgra.subarray(y * 1600, y * 1600 + 1200)));
    expect(frame.frame_buf.subarray(100 * 1200).every((b) => b === 0xaa)).toBe(true);
  });

  test("a buffer larger than the video gets the picture in its corner: the columns and rows beyond it stay as they were", () => {
    const { lib, clock } = open();
    lib.play();
    clock.t = 1000;
    const frame = buffer(BVLPF.X8R8G8B8, 420, 230, 4, 0, 1680); // 420 x 230 pixels, pitch 1680, and a row more
    expect(lib.getFrame(frame, 1)).toBe(0);
    const want = decoded(24);
    for (const y of [0, 1, 110, 219]) {
      expect([y, Array.from(frame.frame_buf.subarray(y * 1680, y * 1680 + 1600))]).toEqual([y, Array.from(want.bgra.subarray(y * 1600, (y + 1) * 1600))]);
      expect([y, frame.frame_buf.subarray(y * 1680 + 1600, (y + 1) * 1680).every((b) => b === 0xaa)]).toEqual([y, true]);
    }
    expect(frame.frame_buf.subarray(220 * 1680).every((b) => b === 0xaa)).toBe(true); // rows 220 to 229 and the row of guard
  });

  test("a buffer that has the video's size and no more is written to its last byte, and not beyond (rows 0 to 219)", () => {
    const { lib, clock } = open();
    lib.play();
    clock.t = 1000;
    const frame = buffer(BVLPF.X8R8G8B8, 400, 220, 4, 0, 1600);
    expect(lib.getFrame(frame, 1)).toBe(0);
    const want = decoded(24);
    expect(Array.from(frame.frame_buf.subarray(219 * 1600, 220 * 1600))).toEqual(Array.from(want.bgra.subarray(219 * 1600, 220 * 1600)));
    expect(frame.frame_buf.subarray(220 * 1600).every((b) => b === 0xaa)).toBe(true);
  });

  test("a frame the decoder cannot give (the table counts a frame that has no picture) is E_FAIL: nothing is written, and it was not given", () => {
    const { lib, clock } = open(true, withEmptyChunk);
    expect(lib.getVideoInfo().total_frames).toBe(460n);
    lib.play();
    clock.t = 30000; // the due frame is the last of the table, 459
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(E_FAIL);
    expect([frame.frame_number, frame.frame_time, frame.frame_buf.every((b) => b === 0xaa)]).toEqual([-1n, -1n, true]);
    expect([lib.isNextFrame(), status(lib)]).toEqual([1, BVL_STATUS.PLAYING]); // still due: nothing was given
    expect(lib.getFrame(frame, 0)).toBe(0); // the next one of the sequence is frame 0
    expect(frame.frame_number).toBe(0n);
  });

  test("the movie plays to its end: the last frame is due from 458 * 1000 / 24 ms, and the status is PLAYEND once it has been given and the movie's 19,125 ms are over", () => {
    const { lib, clock } = open();
    lib.play();
    clock.t = 19000; // frame floor(19 * 24) = 456
    expect(lib.isNextFrame()).toBe(1);
    expect(status(lib)).toBe(BVL_STATUS.PLAYING);
    clock.t = 19120; // frame 458 (the last), 19.12 * 24 = 458.88
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(458n);
    expect([lib.isNextFrame(), status(lib)]).toEqual([0, BVL_STATUS.PLAYING]); // its time is not over
    clock.t = 19125; // 19.125 * 24 = 459: past the last frame
    expect(status(lib)).toBe(BVL_STATUS.PLAYEND);
    expect(lib.isNextFrame()).toBe(0);
    expect(lib.getFrame(frame, 1)).toBe(E_FAIL);
  });

  test("a movie whose last frame was never fetched is not at its end yet: that frame is still due", () => {
    const { lib, clock } = open();
    lib.play();
    clock.t = 30000; // far past the end
    expect([status(lib), lib.isNextFrame()]).toEqual([BVL_STATUS.PLAYING, 1]);
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(458n); // the due frame is the last one, not one past it
    expect(status(lib)).toBe(BVL_STATUS.PLAYEND);
  });

  test("what OnFrameMove does at the end: Seek(0, time) makes it READY, Play starts again from the first frame at the new time, Stop leaves it READY at the first frame", () => {
    const { lib, clock } = open();
    lib.play();
    clock.t = 30000;
    const frame = buffer(BVLPF.X8R8G8B8);
    lib.getFrame(frame, 1);
    expect(status(lib)).toBe(BVL_STATUS.PLAYEND);
    expect(lib.seek(0n, BVL_SEEK.TIME)).toBe(0);
    expect(status(lib)).toBe(BVL_STATUS.READY);
    expect(lib.isNextFrame()).toBe(0);
    expect(lib.play()).toBe(0);
    expect([status(lib), lib.isNextFrame()]).toEqual([BVL_STATUS.PLAYING, 1]);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(0n);
    clock.t = 30000 + 500;
    expect(lib.isNextFrame()).toBe(1); // frame 12 of the new run
    expect(lib.stop()).toBe(0);
    expect([status(lib), lib.isNextFrame()]).toEqual([BVL_STATUS.READY, 0]);
  });

  test("Seek by frame (BVL_SEEK_FRAME 1) or by time (milliseconds): the movie goes on from there, the number is kept inside the movie", () => {
    const { lib, clock } = open();
    lib.play();
    expect(lib.seek(100n, BVL_SEEK.FRAME)).toBe(0);
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(100n);
    clock.t = 1000;
    expect(lib.seek(2500n, BVL_SEEK.TIME)).toBe(0); // 2.5 s: frame 60
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(60n);
    expect(lib.seek(9999n, BVL_SEEK.FRAME)).toBe(0); // beyond the end: the last frame
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(458n);
    expect(Array.from(frame.frame_buf.subarray(110 * frame.pitch + 800, 110 * frame.pitch + 804))).toEqual(Array.from(decoded(458).bgra.subarray(110 * 1600 + 800, 110 * 1600 + 804)));
  });

  test("Seek beyond the end puts the movie at its last frame (458): that frame is due, and the movie is over one frame's time after it", () => {
    const { lib, clock } = open();
    lib.play();
    expect(lib.seek(9999n, BVL_SEEK.FRAME)).toBe(0);
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(458n);
    expect(status(lib)).toBe(BVL_STATUS.PLAYING); // the last frame is on show for its 41.67 ms
    clock.t = 41;
    expect(status(lib)).toBe(BVL_STATUS.PLAYING); // 458 + floor(41 * 24 / 1000) = 458
    clock.t = 42;
    expect(status(lib)).toBe(BVL_STATUS.PLAYEND); // 458 + 1 = 459: past the last
  });

  test("Seek by time: the frame is floor(ms * rate / 1000): 999 ms at 24 frames per second is 23.98, frame 23 (not 24)", () => {
    const { lib } = open();
    lib.play();
    const frame = buffer(BVLPF.X8R8G8B8);
    for (const [ms, want] of [[999n, 23n], [1000n, 24n], [1030n, 24n], [1050n, 25n], [41n, 0n], [42n, 1n]] as const) {
      expect(lib.seek(ms, BVL_SEEK.TIME)).toBe(0);
      expect(lib.getFrame(frame, 1)).toBe(0);
      expect([ms, frame.frame_number]).toEqual([ms, want]);
    }
  });

  test("the time of a frame is counted with the movie's own rate (30000 / 1001): frame 29 is at 1,000 ms and 967.63 ms, frame 30 at 1,001 ms", () => {
    const { lib, clock } = open(true, () => rated(30000, 1001));
    lib.play();
    clock.t = 1000; // floor(1000 * 30000 / (1000 * 1001)) = floor(29.97)
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect([frame.frame_number, frame.frame_time]).toEqual([29n, 968n]); // 29 * 1000 * 1001 / 30000 = 967.63 ms
    clock.t = 1001; // floor(30.0)
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect([frame.frame_number, frame.frame_time]).toEqual([30n, 1001n]);
    expect(lib.seek(1001n, BVL_SEEK.TIME)).toBe(0); // the same number from a time
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(30n);
    expect(lib.seek(999n, BVL_SEEK.TIME)).toBe(0); // 29.94
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(29n);
  });

  test("the clock is counted from Play (the milliseconds since it), a clock that stands still or is set back is the first frame", () => {
    const { lib, clock } = open();
    clock.t = 100000;
    lib.play();
    clock.t = 100999; // 999 ms since Play: frame 23
    const frame = buffer(BVLPF.X8R8G8B8);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(23n);
    expect(lib.seek(0n, BVL_SEEK.FRAME)).toBe(0); // a new run from the clock of that moment
    clock.t = 100500; // set back by 499 ms: nothing has passed
    expect([lib.isNextFrame(), status(lib)]).toEqual([1, BVL_STATUS.PLAYING]);
    expect(lib.getFrame(frame, 1)).toBe(0);
    expect(frame.frame_number).toBe(0n);
  });

  test("Play and Stop need an open movie (the player may be created without one)", () => {
    const { lib } = open(false);
    lib.create();
    expect([lib.play(), lib.stop(), lib.seek(0n, 0)]).toEqual([BVL_E_NOT_CREATED, BVL_E_NOT_CREATED, BVL_E_NOT_CREATED]);
    expect([lib.isNextFrame(), status(lib)]).toEqual([0, BVL_STATUS.CLOSED]);
    expect(lib.getFrame(buffer(BVLPF.X8R8G8B8), 1)).toBe(BVL_E_NOT_CREATED);
  });

  test("Close forgets the movie (the status is CLOSED); Destroy forgets the player", () => {
    const { lib } = open();
    lib.close();
    expect(status(lib)).toBe(BVL_STATUS.CLOSED);
    expect(lib.play()).toBe(BVL_E_NOT_CREATED);
    expect(lib.open("es.avi")).toBe(0);
    lib.destroy();
    expect(lib.getFrame(buffer(BVLPF.X8R8G8B8), 1)).toBe(BVL_E_NOT_CREATED);
  });

  test("Destroy forgets the movie and its state too: a player that is created again has no movie, is CLOSED, and has no frame due", () => {
    const { lib } = open();
    expect(lib.play()).toBe(0);
    expect(status(lib)).toBe(BVL_STATUS.PLAYING);
    lib.destroy();
    expect(lib.isNextFrame()).toBe(0);
    expect(lib.create()).toBe(0);
    expect([status(lib), lib.isNextFrame(), lib.getVideoInfo().width, lib.play(), lib.seek(0n, 0), lib.stop()]).toEqual([BVL_STATUS.CLOSED, 0, 0, BVL_E_NOT_CREATED, BVL_E_NOT_CREATED, BVL_E_NOT_CREATED]);
    expect(lib.getFrame(buffer(BVLPF.X8R8G8B8), 1)).toBe(BVL_E_NOT_CREATED);
  });
});

suite("installMovies: a world that plays its movies", () => {
  test("the player reads <current directory>\\movie\\<name> through the platform's function (the folder is taken off; another path goes as it is) and the movie fills its video texture", () => {
    const { w, dev } = movieWorld();
    const asked: string[] = [];
    const clock = { t: 0 };
    installMovies(w.devices, (name) => (asked.push(name), name === "es.avi" ? bytes() : null), () => clock.t);
    w.devices.currentDirectory = "C:\\Els";
    const mv = new CMovieData(w);
    mv.SetRect(0, 0, 400, 220);
    mv.SetMovieFileName("es.avi");
    expect(asked).toEqual(["es.avi"]);
    expect([mv.m_wstrMovieFileName, mv.m_Info.width, mv.m_Info.height, mv.m_Bvl.isCreated()]).toEqual(["C:\\Els\\movie\\es.avi", 400, 220, true]);
    // the video texture is the exe's CBandiVideoTexture_DX9: X8R8G8B8 (the desktop's, which the default Direct3D object answers for), the video's size
    const texture = dev.made[1]!; // the render target's texture is the first
    expect([texture.width, texture.height, texture.format, mv.m_pBvt!.getFormat()]).toEqual([400, 220, 22 /* X8R8G8B8 */, BVLPF.X8R8G8B8]);
    expect(texture.bits.every((b) => b === 0xaa)).toBe(false); // zeroed by Open: 4 * 400 bytes of each row
    expect(texture.bits.subarray(0, 1600).every((b) => b === 0)).toBe(true);
    // a frame at 1,000 ms: OnFrameMove copies frame 24 into the locked texture
    clock.t = 1000;
    mv.onFrameMove();
    const want = decoded(24);
    for (const y of [0, 1, 110, 219]) expect([y, Array.from(texture.bits.subarray(y * texture.pitch, y * texture.pitch + 1600))]).toEqual([y, Array.from(want.bgra.subarray(y * 1600, (y + 1) * 1600))]);
    expect([texture.locks > 1, texture.unlocks > 1]).toEqual([true, true]);
    // another folder: the prefix is taken off the path of that moment; a path that does not start with it goes as it is; a file that is not there fails the open
    const other = new CMovieData(w);
    w.devices.currentDirectory = "D:\\Game";
    other.SetMovieFileName("none.avi");
    expect(asked).toEqual(["es.avi", "none.avi"]);
    expect(other.m_pBvt).toBeNull(); // Open failed: no video texture
    expect(other.m_Bvl.open("X:\\elsewhere\\a.avi", 0)).toBe(E_FAIL);
    expect(asked).toEqual(["es.avi", "none.avi", "X:\\elsewhere\\a.avi"]);
  });

  test("the movie loops: at its end OnFrameMove seeks to the start and plays again when m_bLoop is set, and stops when it is not", () => {
    for (const loop of [true, false]) {
      const { w } = movieWorld();
      const clock = { t: 0 };
      installMovies(w.devices, () => bytes(), () => clock.t);
      const mv = new CMovieData(w);
      mv.m_bLoop = loop;
      mv.SetRect(0, 0, 400, 220);
      mv.SetMovieFileName("es.avi");
      clock.t = 30000;
      mv.onFrameMove(); // the last frame is fetched: the status is PLAYEND at the next call
      clock.t = 30001;
      mv.onFrameMove(); // PLAYEND: Seek(0), then Play (loop) or Stop; a playing movie gives its first frame in the same call
      const out = { status: 99 };
      mv.m_Bvl.getStatus(out);
      expect([loop, out.status]).toEqual([loop, loop ? BVL_STATUS.PLAYING : BVL_STATUS.READY]);
      expect([loop, mv.m_Bvl.isNextFrame()]).toEqual([loop, 0]); // frame 0 has been given (loop) or none is due (stopped)
      clock.t = 31001; // a second into the new run: frame 24 is due for a movie that plays
      expect([loop, mv.m_Bvl.isNextFrame()]).toEqual([loop, loop ? 1 : 0]);
    }
  });
});
