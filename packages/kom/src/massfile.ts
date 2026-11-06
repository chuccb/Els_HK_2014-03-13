/**
 * `KGCMassFileManager`: the set of mounted KOM archives and the lookup `LoadDataFile` does (x2.exe.c: `AddMassFile` L299222,
 * `LoadDataFile` L300437, `LockMassFileMap` L301723, `MassFileMapping` L301729; the list of archives is built in `CX2Main::CX2Main`,
 * L528010-L528060).
 *
 *  - The archives are `datai001.kom` .. `datai023.kom`, then `data001.kom` .. `data150.kom` (`datai%03d.kom` and `data%03d.kom`),
 *    each opened as `./<name>` relative to the working directory (here: whatever the caller's `open` callback maps the name to).
 *  - `AddMassFile` opens the archive and inserts every member into one hash map keyed by the member's name.  A name that is already
 *    in the map ends in `"<kom>(<member>) is duplicated"`, a message box and a deliberate null write: the original *requires* the names
 *    to be unique across the archives (the shipped 173 archives are: 97,891 entries, 97,891 distinct names, `tools/verify-kom.ts`).
 *    A KOM that cannot be opened also crashes the exe (`MEMORY[0] = 1`).  Here both throw a `MassFileError`.
 *  - `LockMassFileMap` ends the mounting: a later `AddMassFile` only logs an error and returns null.
 *  - `LoadDataFile(name)` upper-cases the whole name (`_towupper` per character) and looks it up; a name that is not mounted logs an
 *    error (`CKTDXLog::PushErrorLog(0x87, name)`) and yields an empty result (size 0).  There is no fallback to loose files at this
 *    level (`LoadDataFile_LocalFile` is the separate entry for those).
 */
import { KomArchive } from "./archive.ts";
import type { ByteSource, KomEntry } from "./archive.ts";

export class MassFileError extends Error {}

/** `datai001..datai023`, then `data001..data150` (the order `CX2Main` pushes into `m_KOMList`). */
export const CLIENT_KOM_NAMES: readonly string[] = [
  ...Array.from({ length: 23 }, (_, i) => `datai${String(i + 1).padStart(3, "0")}.kom`),
  ...Array.from({ length: 150 }, (_, i) => `data${String(i + 1).padStart(3, "0")}.kom`),
];

export interface MassFileLocation {
  readonly kom: KomArchive;
  readonly komName: string;
  readonly entry: KomEntry;
}

export class MassFileManager {
  private readonly map = new Map<string, MassFileLocation>();
  private readonly mounted: { name: string; kom: KomArchive }[] = [];
  private locked = false;

  /** receives the exe's `PushErrorLog` messages (a missing member, `AddMassFile` after the lock) */
  constructor(private readonly onError: (message: string) => void = () => {}) {}

  get isLocked(): boolean { return this.locked; }
  /** number of members over all mounted archives */
  get size(): number { return this.map.size; }
  get archives(): readonly { name: string; kom: KomArchive }[] { return this.mounted; }

  /** `AddMassFile`: mounts an archive.  Returns null (and logs) once the map is locked; throws `MassFileError` on a duplicated member name. */
  async addMassFile(name: string, source: ByteSource): Promise<KomArchive | null> {
    if (this.locked) { this.onError(`AddMassFile(${name}) after LockMassFileMap`); return null; }
    return this.addArchive(name, await KomArchive.open(source));
  }

  /** The second half of `AddMassFile` for an archive that is already open. */
  addArchive(name: string, kom: KomArchive): KomArchive | null {
    if (this.locked) { this.onError(`AddMassFile(${name}) after LockMassFileMap`); return null; }
    const added: string[] = [];
    for (const entry of kom.entries) {
      const key = entry.name.toUpperCase();
      const have = this.map.get(key);
      if (have) {
        for (const k of added) this.map.delete(k); // the exe deletes the archive again
        throw new MassFileError(`${name}(${entry.name}) is duplicated (already in ${have.komName})`);
      }
      this.map.set(key, { kom, komName: name, entry });
      added.push(key);
    }
    this.mounted.push({ name, kom });
    return kom;
  }

  /** `LockMassFileMap` (the exe calls `MassFileMapping` right after the lock; the map is built incrementally here). */
  lock(): void { this.locked = true; }

  /** The location of a member (the name is upper-cased like `LoadDataFile` does), or undefined. */
  find(name: string): MassFileLocation | undefined { return this.map.get(name.toUpperCase()); }
  has(name: string): boolean { return this.map.has(name.toUpperCase()); }

  /** `LoadDataFile`: the decoded bytes of a member, or null (after logging) when no archive has it. */
  async loadDataFile(name: string): Promise<Uint8Array | null> {
    const loc = this.find(name);
    if (!loc) { this.onError(`LoadDataFile: ${name} is not in any archive`); return null; }
    return loc.kom.read(loc.entry);
  }

  /** Every member name as stored in the archives (not upper-cased), archives in mount order. */
  *names(): IterableIterator<string> {
    for (const { kom } of this.mounted) for (const e of kom.entries) yield e.name;
  }
}

export interface MountOptions {
  /** archives to mount, in this order (default `CLIENT_KOM_NAMES`) */
  names?: readonly string[];
  /** how many archives are opened at once (the header + manifest reads are what is parallel; default 8) */
  concurrency?: number;
  /** called for every archive that `open` could not provide; the exe would crash, so by default this throws */
  onMissing?: (name: string) => void;
  /** progress callback: archives opened so far, of the total */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Mounts the client's archives the way `CX2Main` does: opens them (concurrently), adds them in list order and locks the map.
 * `open(name)` returns the byte source of `<name>` or null when there is no such file.
 */
export async function mountClientArchives(
  manager: MassFileManager,
  open: (komName: string) => Promise<ByteSource | null>,
  options: MountOptions = {},
): Promise<{ mounted: number; missing: string[] }> {
  const names = options.names ?? CLIENT_KOM_NAMES;
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const opened: (KomArchive | null)[] = new Array(names.length).fill(null);
  let next = 0, done = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < names.length; i = next++) {
      const source = await open(names[i]!);
      opened[i] = source ? await KomArchive.open(source) : null;
      options.onProgress?.(++done, names.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
  const missing: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const kom = opened[i];
    if (!kom) {
      missing.push(names[i]!);
      if (!options.onMissing) throw new MassFileError(`cannot open ${names[i]}`);
      options.onMissing(names[i]!);
      continue;
    }
    manager.addArchive(names[i]!, kom);
  }
  manager.lock();
  return { mounted: names.length - missing.length, missing };
}
