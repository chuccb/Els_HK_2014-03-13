/**
 * Per-frame bump allocator for data that is written once and read by recorded draws (uniform blocks, dynamic vertex/index data,
 * converted triangle fans).  Data is staged in CPU memory and uploaded with one `queue.writeBuffer` per chunk just before the
 * command buffer is submitted; after the submit the chunks are reused (queue operations execute in order, so the next write cannot
 * overtake the previous command buffer).
 */
export interface ArenaChunk { readonly id: number; readonly gpu: GPUBuffer; readonly cpu: Uint8Array; used: number }
export interface ArenaAlloc { chunk: ArenaChunk; offset: number }

let chunkIds = 0;

export class TransientArena {
  private chunks: ArenaChunk[] = [];
  private current = 0;

  constructor(private readonly gpu: GPUDevice, private readonly chunkSize = 4 << 20, private readonly usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST) {}

  /** Reserve `size` bytes aligned to `align` (a power of two). */
  alloc(size: number, align = 4): ArenaAlloc {
    for (; this.current < this.chunks.length; this.current++) {
      const c = this.chunks[this.current]!;
      const off = (c.used + align - 1) & ~(align - 1);
      if (off + size <= c.cpu.length) { c.used = off + size; return { chunk: c, offset: off }; }
    }
    const len = Math.max(this.chunkSize, (size + align + 3) & ~3);
    const c: ArenaChunk = { id: ++chunkIds, gpu: this.gpu.createBuffer({ size: len, usage: this.usage }), cpu: new Uint8Array(len), used: 0 };
    this.chunks.push(c);
    this.current = this.chunks.length - 1;
    c.used = size;
    return { chunk: c, offset: 0 };
  }

  /** Upload everything written since the last flush. Call right before `queue.submit`. */
  upload(): void {
    for (const c of this.chunks) {
      if (c.used === 0) continue;
      const n = (c.used + 3) & ~3;
      this.gpu.queue.writeBuffer(c.gpu, 0, c.cpu, 0, n);
    }
  }

  /** Make the chunks reusable (call after `queue.submit`). */
  reset(): void {
    for (const c of this.chunks) c.used = 0;
    this.current = 0;
  }

  get totalBytes(): number { return this.chunks.reduce((n, c) => n + c.cpu.length, 0); }
}
