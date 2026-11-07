import { FT_OUTLINE, type Outline, outlineDecompose } from "./outline.ts";
import type { Bitmap } from "./slot.ts";
import { FtErr } from "./types.ts";

/**
 * The anti-aliasing scan converter of FreeType 2.4.11 (src/smooth/ftgrays.c, PIXEL_BITS = 8): outline -> 8 bit coverage.  Every formula is the C one:
 * cells accumulate `area` and `cover` per (x, scanline) in sorted per-scanline lists, `gray_sweep` turns them into spans, `gray_render_span` fills the bitmap
 * upside down.  One deliberate difference: the C code splits a glyph into horizontal bands sized by the 16 KB render pool (117 scanlines, ~900 cells per band)
 * and bisects a band whose cells do not fit; the cells of a scanline do not depend on the band, so this port renders one band over the whole glyph
 * (the result is identical; tools/verify-freetype.ts checks it against the exe, including glyphs far larger than the pool).
 */

const PIXEL_BITS = 8;
const ONE_PIXEL = 1 << PIXEL_BITS;
const FT_MAX_GRAY_SPANS = 32;
const INT_MAX = 0x7fffffff;

const trunc = (x: number): number => x >> PIXEL_BITS;
const subpixels = (x: number): number => (x << PIXEL_BITS) | 0;
const upscale = (x: number): number => (x << (PIXEL_BITS - 6)) | 0;
const abs = (x: number): number => (x < 0 ? -x | 0 : x);

export class GrayRaster {
  // gray_TWorker
  private ex = 0;
  private ey = 0;
  private minEx = 0;
  private maxEx = 0;
  private minEy = 0;
  private maxEy = 0;
  private countEx = 0;
  private countEy = 0;
  private area = 0;
  private cover = 0;
  private invalid = true;
  // cells: struct of arrays, `next` = index or -1
  private cellX: Int32Array = new Int32Array(1024);
  private cellCover: Int32Array = new Int32Array(1024);
  private cellArea: Int32Array = new Int32Array(1024);
  private cellNext: Int32Array = new Int32Array(1024);
  private numCells = 0;
  private ycells: Int32Array = new Int32Array(0);
  private ycount = 0;
  private x = 0;
  private y = 0;
  private lastEy = 0;
  private readonly bez = new Int32Array((32 * 3 + 1) * 2);
  private readonly lev = new Int32Array(32);
  private outline!: Outline;
  private target!: Bitmap;
  private clipXMin = 0;
  private clipYMin = 0;
  private clipXMax = 0;
  private clipYMax = 0;
  // gray_spans
  private readonly spanX = new Int16Array(FT_MAX_GRAY_SPANS);
  private readonly spanLen = new Uint16Array(FT_MAX_GRAY_SPANS);
  private readonly spanCov = new Uint8Array(FT_MAX_GRAY_SPANS);
  private numGraySpans = 0;
  private spanY = 0;

  /** gray_compute_cbox */
  private computeCbox(): void {
    const o = this.outline;
    const p = o.points;
    if (o.nPoints <= 0) {
      this.minEx = this.maxEx = 0;
      this.minEy = this.maxEy = 0;
      return;
    }
    this.minEx = this.maxEx = p[0]!;
    this.minEy = this.maxEy = p[1]!;
    for (let i = 1; i < o.nPoints; i++) {
      const x = p[2 * i]!;
      const y = p[2 * i + 1]!;
      if (x < this.minEx) this.minEx = x;
      if (x > this.maxEx) this.maxEx = x;
      if (y < this.minEy) this.minEy = y;
      if (y > this.maxEy) this.maxEy = y;
    }
    this.minEx = this.minEx >> 6;
    this.minEy = this.minEy >> 6;
    this.maxEx = (this.maxEx + 63) >> 6;
    this.maxEy = (this.maxEy + 63) >> 6;
  }

  /** gray_find_cell: the cell (ex, ey) of the current scanline, inserted in x order when missing */
  private findCell(): number {
    let x = this.ex;
    if (x > this.countEx) x = this.countEx;
    let prev = -1;
    let cell = this.ycells[this.ey]!;
    for (;;) {
      if (cell === -1 || this.cellX[cell]! > x) break;
      if (this.cellX[cell] === x) return cell;
      prev = cell;
      cell = this.cellNext[cell]!;
    }
    if (this.numCells >= this.cellX.length) this.growCells();
    const idx = this.numCells++;
    this.cellX[idx] = x;
    this.cellArea[idx] = 0;
    this.cellCover[idx] = 0;
    this.cellNext[idx] = cell;
    if (prev === -1) this.ycells[this.ey] = idx;
    else this.cellNext[prev] = idx;
    return idx;
  }

  private growCells(): void {
    const n = this.cellX.length * 2;
    const g = (a: Int32Array): Int32Array => {
      const b = new Int32Array(n);
      b.set(a);
      return b;
    };
    this.cellX = g(this.cellX);
    this.cellCover = g(this.cellCover);
    this.cellArea = g(this.cellArea);
    this.cellNext = g(this.cellNext);
  }

  /** gray_record_cell */
  private recordCell(): void {
    if (!this.invalid && (this.area | this.cover)) {
      const c = this.findCell();
      this.cellArea[c] = (this.cellArea[c]! + this.area) | 0;
      this.cellCover[c] = (this.cellCover[c]! + this.cover) | 0;
    }
  }

  /** gray_set_cell */
  private setCell(ex: number, ey: number): void {
    ey -= this.minEy;
    if (ex > this.maxEx) ex = this.maxEx;
    ex -= this.minEx;
    if (ex < 0) ex = -1;
    if (ex !== this.ex || ey !== this.ey) {
      if (!this.invalid) this.recordCell();
      this.area = 0;
      this.cover = 0;
    }
    this.ex = ex;
    this.ey = ey;
    this.invalid = ey >>> 0 >= this.countEy >>> 0 || ex >= this.countEx;
  }

  /** gray_start_cell */
  private startCell(ex: number, ey: number): void {
    if (ex > this.maxEx) ex = this.maxEx;
    if (ex < this.minEx) ex = this.minEx - 1;
    this.area = 0;
    this.cover = 0;
    this.ex = ex - this.minEx;
    this.ey = ey - this.minEy;
    this.lastEy = subpixels(ey);
    this.invalid = false;
    this.setCell(ex, ey);
  }

  /** gray_render_scanline */
  private renderScanline(ey: number, x1: number, y1: number, x2: number, y2: number): void {
    let dx = (x2 - x1) | 0;
    let ex1 = trunc(x1);
    const ex2 = trunc(x2);
    const fx1 = (x1 - subpixels(ex1)) | 0;
    const fx2 = (x2 - subpixels(ex2)) | 0;
    if (y1 === y2) {
      this.setCell(ex2, ey);
      return;
    }
    if (ex1 === ex2) {
      const delta = (y2 - y1) | 0;
      this.area = (this.area + Math.imul(fx1 + fx2, delta)) | 0;
      this.cover = (this.cover + delta) | 0;
      return;
    }
    let p = Math.imul(ONE_PIXEL - fx1, y2 - y1);
    let first = ONE_PIXEL;
    let incr = 1;
    if (dx < 0) {
      p = Math.imul(fx1, y2 - y1);
      first = 0;
      incr = -1;
      dx = -dx | 0;
    }
    let delta = Math.trunc(p / dx) | 0;
    let mod = p % dx | 0;
    if (mod < 0) {
      delta--;
      mod = (mod + dx) | 0;
    }
    this.area = (this.area + Math.imul(fx1 + first, delta)) | 0;
    this.cover = (this.cover + delta) | 0;
    ex1 += incr;
    this.setCell(ex1, ey);
    y1 = (y1 + delta) | 0;
    if (ex1 !== ex2) {
      p = Math.imul(ONE_PIXEL, (y2 - y1 + delta) | 0);
      let lift = Math.trunc(p / dx) | 0;
      let rem = p % dx | 0;
      if (rem < 0) {
        lift--;
        rem = (rem + dx) | 0;
      }
      mod = (mod - dx) | 0;
      while (ex1 !== ex2) {
        delta = lift;
        mod = (mod + rem) | 0;
        if (mod >= 0) {
          mod = (mod - dx) | 0;
          delta++;
        }
        this.area = (this.area + Math.imul(ONE_PIXEL, delta)) | 0;
        this.cover = (this.cover + delta) | 0;
        y1 = (y1 + delta) | 0;
        ex1 += incr;
        this.setCell(ex1, ey);
      }
    }
    delta = (y2 - y1) | 0;
    this.area = (this.area + Math.imul(fx2 + ONE_PIXEL - first, delta)) | 0;
    this.cover = (this.cover + delta) | 0;
  }

  /** gray_render_line */
  private renderLine(toX: number, toY: number): void {
    let ey1 = trunc(this.lastEy);
    const ey2 = trunc(toY);
    const fy1 = (this.y - this.lastEy) | 0;
    const fy2 = (toY - subpixels(ey2)) | 0;
    let dx = (toX - this.x) | 0;
    let dy = (toY - this.y) | 0;
    const min = ey1 < ey2 ? ey1 : ey2;
    const max = ey1 < ey2 ? ey2 : ey1;
    if (min >= this.maxEy || max < this.minEy) {
      this.endLine(toX, toY, ey2);
      return;
    }
    if (ey1 === ey2) {
      this.renderScanline(ey1, this.x, fy1, toX, fy2);
      this.endLine(toX, toY, ey2);
      return;
    }
    let incr = 1;
    if (dx === 0) {
      const ex = trunc(this.x);
      const twoFx = ((this.x - subpixels(ex)) << 1) | 0;
      let first = ONE_PIXEL;
      if (dy < 0) {
        first = 0;
        incr = -1;
      }
      let delta = (first - fy1) | 0;
      this.area = (this.area + Math.imul(twoFx, delta)) | 0;
      this.cover = (this.cover + delta) | 0;
      ey1 += incr;
      this.setCell(ex, ey1);
      delta = (first + first - ONE_PIXEL) | 0;
      const area = Math.imul(twoFx, delta);
      while (ey1 !== ey2) {
        this.area = (this.area + area) | 0;
        this.cover = (this.cover + delta) | 0;
        ey1 += incr;
        this.setCell(ex, ey1);
      }
      delta = (fy2 - ONE_PIXEL + first) | 0;
      this.area = (this.area + Math.imul(twoFx, delta)) | 0;
      this.cover = (this.cover + delta) | 0;
      this.endLine(toX, toY, ey2);
      return;
    }
    let p = Math.imul(ONE_PIXEL - fy1, dx);
    let first = ONE_PIXEL;
    incr = 1;
    if (dy < 0) {
      p = Math.imul(fy1, dx);
      first = 0;
      incr = -1;
      dy = -dy | 0;
    }
    let delta = Math.trunc(p / dy) | 0;
    let mod = p % dy | 0;
    if (mod < 0) {
      delta--;
      mod = (mod + dy) | 0;
    }
    let x = (this.x + delta) | 0;
    this.renderScanline(ey1, this.x, fy1, x, first);
    ey1 += incr;
    this.setCell(trunc(x), ey1);
    if (ey1 !== ey2) {
      p = Math.imul(ONE_PIXEL, dx);
      let lift = Math.trunc(p / dy) | 0;
      let rem = p % dy | 0;
      if (rem < 0) {
        lift--;
        rem = (rem + dy) | 0;
      }
      mod = (mod - dy) | 0;
      while (ey1 !== ey2) {
        delta = lift;
        mod = (mod + rem) | 0;
        if (mod >= 0) {
          mod = (mod - dy) | 0;
          delta++;
        }
        const x2 = (x + delta) | 0;
        this.renderScanline(ey1, x, ONE_PIXEL - first, x2, first);
        x = x2;
        ey1 += incr;
        this.setCell(trunc(x), ey1);
      }
    }
    this.renderScanline(ey1, x, ONE_PIXEL - first, toX, fy2);
    this.endLine(toX, toY, ey2);
  }

  /** the `End:` label of gray_render_line */
  private endLine(toX: number, toY: number, ey2: number): void {
    this.x = toX;
    this.y = toY;
    this.lastEy = subpixels(ey2);
  }

  /** gray_split_conic on bez[base .. base + 4] (vector indices) */
  private splitConic(b: number): void {
    const v = this.bez;
    for (let c = 0; c < 2; c++) {
      v[(b + 4) * 2 + c] = v[(b + 2) * 2 + c]!;
      let t = v[(b + 1) * 2 + c]!;
      const a = (v[(b + 3) * 2 + c] = Math.trunc((v[(b + 2) * 2 + c]! + t) / 2) | 0);
      t = v[(b + 1) * 2 + c] = Math.trunc((v[b * 2 + c]! + t) / 2) | 0;
      v[(b + 2) * 2 + c] = Math.trunc((a + t) / 2) | 0;
    }
  }

  /** gray_render_conic */
  private renderConic(cx: number, cy: number, toX: number, toY: number): void {
    const v = this.bez;
    const levels = this.lev;
    let arc = 0;
    v[0] = upscale(toX);
    v[1] = upscale(toY);
    v[2] = upscale(cx);
    v[3] = upscale(cy);
    v[4] = this.x;
    v[5] = this.y;
    let top = 0;
    let dx = abs((v[4]! + v[0]! - 2 * v[2]!) | 0);
    const dy = abs((v[5]! + v[1]! - 2 * v[3]!) | 0);
    if (dx < dy) dx = dy;
    let draw = dx < ONE_PIXEL / 4;
    if (!draw) {
      let min = v[1]!;
      let max = v[1]!;
      let y = v[3]!;
      if (y < min) min = y;
      if (y > max) max = y;
      y = v[5]!;
      if (y < min) min = y;
      if (y > max) max = y;
      if (trunc(min) >= this.maxEy || trunc(max) < this.minEy) draw = true;
    }
    if (draw) {
      this.renderLine(v[0]!, v[1]!);
      return;
    }
    let level = 0;
    do {
      dx >>= 2;
      level++;
    } while (dx > ONE_PIXEL / 4);
    levels[0] = level;
    do {
      level = levels[top]!;
      if (level > 0) {
        this.splitConic(arc);
        arc += 2;
        top++;
        levels[top] = levels[top - 1] = level - 1;
        continue;
      }
      this.renderLine(v[arc * 2]!, v[arc * 2 + 1]!);
      top--;
      arc -= 2;
    } while (top >= 0);
  }

  /** gray_split_cubic on bez[base .. base + 6] */
  private splitCubic(b: number): void {
    const v = this.bez;
    for (let k = 0; k < 2; k++) {
      v[(b + 6) * 2 + k] = v[(b + 3) * 2 + k]!;
      let c = v[(b + 1) * 2 + k]!;
      const d = v[(b + 2) * 2 + k]!;
      let a = (v[(b + 1) * 2 + k] = Math.trunc((v[b * 2 + k]! + c) / 2) | 0);
      let bb = (v[(b + 5) * 2 + k] = Math.trunc((v[(b + 3) * 2 + k]! + d) / 2) | 0);
      c = Math.trunc((c + d) / 2) | 0;
      a = v[(b + 2) * 2 + k] = Math.trunc((a + c) / 2) | 0;
      bb = v[(b + 4) * 2 + k] = Math.trunc((bb + c) / 2) | 0;
      v[(b + 3) * 2 + k] = Math.trunc((a + bb) / 2) | 0;
    }
  }

  /** gray_render_cubic */
  private renderCubic(c1x: number, c1y: number, c2x: number, c2y: number, toX: number, toY: number): void {
    const v = this.bez;
    let arc = 0;
    v[0] = upscale(toX);
    v[1] = upscale(toY);
    v[2] = upscale(c2x);
    v[3] = upscale(c2y);
    v[4] = upscale(c1x);
    v[5] = upscale(c1y);
    v[6] = this.x;
    v[7] = this.y;
    let min = v[1]!;
    let max = v[1]!;
    for (let i = 1; i <= 3; i++) {
      const y = v[i * 2 + 1]!;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    let draw = trunc(min) >= this.maxEy || trunc(max) < this.minEy;
    for (;;) {
      if (!draw) {
        // decide: draw or split
        let split = false;
        const a0x = v[arc * 2]!;
        const a0y = v[arc * 2 + 1]!;
        const dx = (v[(arc + 3) * 2]! - a0x) | 0;
        const dy = (v[(arc + 3) * 2 + 1]! - a0y) | 0;
        const dx_ = abs(dx);
        const dy_ = abs(dy);
        const L = (dx_ > dy_ ? (Math.imul(236, dx_) + Math.imul(97, dy_)) | 0 : (Math.imul(97, dx_) + Math.imul(236, dy_)) | 0) >> 8;
        if (L > 32767) split = true;
        else {
          const sLimit = Math.imul(L, ONE_PIXEL / 6);
          const dx1 = (v[(arc + 1) * 2]! - a0x) | 0;
          const dy1 = (v[(arc + 1) * 2 + 1]! - a0y) | 0;
          let s = abs((Math.imul(dy, dx1) - Math.imul(dx, dy1)) | 0);
          if (s > sLimit) split = true;
          else {
            const dx2 = (v[(arc + 2) * 2]! - a0x) | 0;
            const dy2 = (v[(arc + 2) * 2 + 1]! - a0y) | 0;
            s = abs((Math.imul(dy, dx2) - Math.imul(dx, dy2)) | 0);
            if (s > sLimit) split = true;
            else if (
              ((Math.imul(dx1, (dx1 - dx) | 0) + Math.imul(dy1, (dy1 - dy) | 0)) | 0) > 0 ||
              ((Math.imul(dx2, (dx2 - dx) | 0) + Math.imul(dy2, (dy2 - dy) | 0)) | 0) > 0
            )
              split = true;
          }
        }
        if (split) {
          this.splitCubic(arc);
          arc += 3;
          continue;
        }
      }
      draw = false;
      this.renderLine(v[arc * 2]!, v[arc * 2 + 1]!);
      if (arc === 0) return;
      arc -= 3;
    }
  }

  // ---- gray_sweep / spans

  /** gray_render_span: fill the bitmap rows (the bitmap is written upside down) */
  private renderSpans(y: number, count: number): void {
    const map = this.target;
    const buf = map.buffer!;
    let rowStart = -y * map.pitch;
    if (map.pitch >= 0) rowStart += (map.rows - 1) * map.pitch;
    for (let i = 0; i < count; i++) {
      const cov = this.spanCov[i]!;
      if (cov) buf.fill(cov, rowStart + this.spanX[i]!, rowStart + this.spanX[i]! + this.spanLen[i]!);
    }
  }

  /** gray_hline */
  private hline(x: number, y: number, area: number, acount: number): void {
    let coverage = area >> (PIXEL_BITS * 2 + 1 - 8);
    if (coverage < 0) coverage = -coverage;
    if (this.outline.flags & FT_OUTLINE.EVEN_ODD_FILL) {
      coverage &= 511;
      if (coverage > 256) coverage = 512 - coverage;
      else if (coverage === 256) coverage = 255;
    } else if (coverage >= 256) coverage = 255;
    y += this.minEy;
    x += this.minEx;
    if (x >= 32767) x = 32767;
    if (y >= INT_MAX) y = INT_MAX;
    if (coverage) {
      let count = this.numGraySpans;
      const last = count - 1;
      if (count > 0 && this.spanY === y && this.spanX[last]! + this.spanLen[last]! === x && this.spanCov[last] === coverage) {
        this.spanLen[last] = (this.spanLen[last]! + acount) & 0xffff;
        return;
      }
      let at: number;
      if (this.spanY !== y || count >= FT_MAX_GRAY_SPANS) {
        if (count > 0) this.renderSpans(this.spanY, count);
        this.numGraySpans = 0;
        this.spanY = y;
        count = 0;
        at = 0;
      } else at = count;
      this.spanX[at] = x;
      this.spanLen[at] = acount & 0xffff;
      this.spanCov[at] = coverage;
      this.numGraySpans++;
    }
  }

  /** gray_sweep */
  private sweep(): void {
    if (this.numCells === 0) return;
    this.numGraySpans = 0;
    for (let yindex = 0; yindex < this.ycount; yindex++) {
      let cell = this.ycells[yindex]!;
      let cover = 0;
      let x = 0;
      for (; cell !== -1; cell = this.cellNext[cell]!) {
        const cx = this.cellX[cell]!;
        if (cx > x && cover !== 0) this.hline(x, yindex, Math.imul(cover, ONE_PIXEL * 2), cx - x);
        cover = (cover + this.cellCover[cell]!) | 0;
        const area = (Math.imul(cover, ONE_PIXEL * 2) - this.cellArea[cell]!) | 0;
        if (area !== 0 && cx >= 0) this.hline(cx, yindex, area, 1);
        x = cx + 1;
      }
      if (cover !== 0) this.hline(x, yindex, Math.imul(cover, ONE_PIXEL * 2), this.countEx - x);
    }
    if (this.numGraySpans > 0) this.renderSpans(this.spanY, this.numGraySpans);
  }

  /**
   * gray_raster_render + gray_convert_glyph for a bitmap target (FT_RASTER_FLAG_AA): 0 or an FT_Error.  `outline` is in 26.6 pixels with the origin at
   * the bottom left of the bitmap.
   */
  render(outline: Outline, target: Bitmap): number {
    if (outline.nPoints === 0 || outline.nContours <= 0) return 0;
    if (outline.nPoints !== outline.contours[outline.nContours - 1]! + 1) return FtErr.Invalid_Outline;
    if (!target.width || !target.rows) return 0;
    if (!target.buffer) return FtErr.Invalid_Argument;
    this.clipXMin = 0;
    this.clipYMin = 0;
    this.clipXMax = target.width;
    this.clipYMax = target.rows;
    this.outline = outline;
    this.target = target;
    this.numCells = 0;
    this.invalid = true;
    this.numGraySpans = 0;
    // gray_convert_glyph, one band
    this.computeCbox();
    if (this.maxEx <= this.clipXMin || this.minEx >= this.clipXMax || this.maxEy <= this.clipYMin || this.minEy >= this.clipYMax) return 0;
    if (this.minEx < this.clipXMin) this.minEx = this.clipXMin;
    if (this.minEy < this.clipYMin) this.minEy = this.clipYMin;
    if (this.maxEx > this.clipXMax) this.maxEx = this.clipXMax;
    if (this.maxEy > this.clipYMax) this.maxEy = this.clipYMax;
    this.countEx = this.maxEx - this.minEx;
    this.countEy = this.maxEy - this.minEy;
    this.ycount = this.countEy;
    if (this.ycells.length < this.ycount) this.ycells = new Int32Array(this.ycount);
    this.ycells.fill(-1, 0, this.ycount);
    this.numCells = 0;
    this.invalid = true;
    const funcs = {
      moveTo: (x: number, y: number): number => {
        this.recordCell();
        const ux = upscale(x);
        const uy = upscale(y);
        this.startCell(trunc(ux), trunc(uy));
        this.x = ux;
        this.y = uy;
        return 0;
      },
      lineTo: (x: number, y: number): number => {
        this.renderLine(upscale(x), upscale(y));
        return 0;
      },
      conicTo: (cx: number, cy: number, x: number, y: number): number => {
        this.renderConic(cx, cy, x, y);
        return 0;
      },
      cubicTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): number => {
        this.renderCubic(c1x, c1y, c2x, c2y, x, y);
        return 0;
      },
    };
    const error = outlineDecompose(outline, funcs);
    this.recordCell();
    if (error) return 1;
    this.sweep();
    return 0;
  }
}
