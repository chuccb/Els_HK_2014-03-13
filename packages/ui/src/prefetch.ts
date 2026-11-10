/**
 * A synchronous world over an asynchronous file system (not in the exe: platform glue).
 *
 * The Lua VM and the UI classes read files synchronously (`KGCMassFileManager::LoadDataFile`: a script, a texture, a font), and a browser reads a
 * member of an archive over the network.  `PrefetchSource` is the `MassFileSource` such a world reads: it hands out the members that are resident,
 * says "no such file" for the others and remembers what it was asked for; `settle` runs the code that reads (a world that builds a dialog) until
 * one run asks for nothing that is not resident, loading what each void run missed in between.  A run that missed a file is void (the exe's code
 * was told "no such file" and went on), so what it made is handed to `discard` and never kept.  `tools/komindex.ts` does the same for the census
 * over `fs`, where a read can be synchronous (`KomMassFileSource`).
 *
 * A file that is in no archive (`has` false) is not loaded: a world that asks for it is told, as the exe's `LoadDataFile` tells it, that there is none.
 */
import type { MassFileSource } from "@els/host";

/** the archives as the browser has them: membership is known at once (the manifests are mounted), a member's bytes come later */
export interface FileStore {
  has(upperName: string): boolean;
  load(upperName: string): Promise<Uint8Array>;
}

/** how many rounds `settle` makes at most before it gives up (a dialog needs a handful: scripts that load scripts, then the textures the controls name) */
export const MAX_ROUNDS = 64;

export class PrefetchSource implements MassFileSource {
  private readonly resident = new Map<string, Uint8Array>();
  /** what `read` handed out since the round began */
  private asked = new Set<string>();
  /** what `read` was asked for and could not hand out since the round began */
  readonly pending = new Set<string>();
  /** members loaded so far, and their bytes (statistics for the viewer) */
  loaded = 0;
  loadedBytes = 0;

  constructor(private readonly store: FileStore, private readonly concurrency = 8) {}

  has(upperName: string): boolean {
    return this.store.has(upperName);
  }

  read(upperName: string): Uint8Array | undefined {
    const bytes = this.resident.get(upperName);
    if (bytes) {
      this.asked.add(upperName);
      return bytes;
    }
    if (this.store.has(upperName)) this.pending.add(upperName);
    return undefined;
  }

  /** what is resident, in bytes */
  get residentBytes(): number {
    let n = 0;
    for (const bytes of this.resident.values()) n += bytes.length;
    return n;
  }

  /** the members of the archives, several at a time; the ones that are resident are not asked for again */
  async load(upperNames: Iterable<string>): Promise<void> {
    const todo = [...new Set(upperNames)].filter((name) => !this.resident.has(name) && this.store.has(name));
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < todo.length; i = next++) {
        const name = todo[i]!;
        const bytes = await this.store.load(name);
        this.resident.set(name, bytes);
        this.loaded++;
        this.loadedBytes += bytes.length;
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, todo.length) }, worker));
  }

  /**
   * Run `run` until a run reads only resident members (a run that throws because of a missing member is run again, too: a script that died on a
   * file it was told does not exist).  A run that is not the last one is void, and its result goes to `discard`.  The answer is what the last run
   * made, with the number of runs.  A run that throws with nothing missing is the error of the code: it is thrown.
   */
  async settle<T>(run: () => T, discard?: (result: T) => void): Promise<{ result: T; rounds: number }> {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      this.pending.clear();
      this.asked = new Set();
      let result: T | undefined;
      let error: unknown;
      let failed = false;
      try {
        result = run();
      } catch (e) {
        failed = true;
        error = e;
      }
      if (this.pending.size === 0) {
        if (failed) throw error;
        return { result: result as T, rounds: round };
      }
      if (!failed) discard?.(result as T);
      await this.load([...this.pending]);
    }
    throw new Error("the files did not settle");
  }

  /**
   * Forget resident members that `evictable` matches (the textures of dialogs that are no longer open) and the last round did not read, oldest first,
   * until at most `limit` bytes are left; a later `read` of one is pending again.  Returns the number of members forgotten.
   */
  trim(limit: number, evictable: RegExp): number {
    let total = this.residentBytes;
    let n = 0;
    for (const [name, bytes] of this.resident) {
      if (total <= limit) break;
      if (!evictable.test(name) || this.asked.has(name)) continue;
      this.resident.delete(name);
      total -= bytes.length;
      n++;
    }
    return n;
  }
}
