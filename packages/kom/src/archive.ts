/**
 * KOM archive reader ("KOG GC TEAM MASSFILE V.0.3.").
 *
 * Layout (decoded from CMassFile::LoadMassFile x2.exe.c L300714 and _GetMemberFile L302911; verified on all
 * 173 archives of the client: parsed end offset == file size, every entry's size and Adler-32 match):
 *
 *   0x00  char[50] magic  "KOG GC TEAM MASSFILE V.0.3."   (the version digits are parsed from this string)
 *   0x34  u32      file count
 *   0x38  u8       bCompressed
 *   0x3C  u32      file time
 *   0x40  u32      adler32 (of the XML manifest)
 *   0x44  u32      XML size N
 *   0x48  char[N]  XML manifest  <Files><File Name Size CompressedSize Checksum FileTime Algorithm/>...</Files>
 *   0x48+N         entry data, packed back to back in manifest order, `CompressedSize` bytes each
 *
 * Entry decoding:   Algorithm 0 -> zlib stream;   Algorithm 2 -> XORCRCDecrypt(stored) then zlib.
 * (The engine's loader ignores `Algorithm`; algorithm-2 entries are decrypted by the Lua/text loaders — see
 * xorcrc.ts — which is why they are one decode step here.)
 * Names are matched case-insensitively (KGCMassFileManager upper-cases them).
 */
import { unzlibSync } from "fflate";
import { adler32 } from "./adler32.ts";
import { xorCrcDecrypt } from "./xorcrc.ts";

export interface KomEntry {
  readonly name: string;
  /** uncompressed size */
  readonly size: number;
  /** stored size */
  readonly csize: number;
  /** manifest Checksum (Adler-32 of the stored bytes) or null when the attribute is absent */
  readonly checksum: number | null;
  readonly algorithm: number;
  /** absolute byte offset of the stored data inside the .kom file */
  readonly offset: number;
}

/** Random-access byte source (a file on disk, or an HTTP resource served with Range support). */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export const KOM_MAGIC_PREFIX = "KOG GC TEAM MASSFILE V.";
const HEADER_SIZE = 0x48;

function decodeXmlAttr(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    switch (e) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default:
        return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

/** Parses the (very regular) manifest produced by the KOM packer without needing a DOM. */
export function parseManifest(xml: string, dataStart: number): KomEntry[] {
  const entries: KomEntry[] = [];
  let offset = dataStart;
  const fileRe = /<File\b([^>]*?)\/?>/g;
  const attrRe = /([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m = fileRe.exec(xml); m; m = fileRe.exec(xml)) {
    const attrs = new Map<string, string>();
    attrRe.lastIndex = 0;
    for (let a = attrRe.exec(m[1]!); a; a = attrRe.exec(m[1]!)) attrs.set(a[1]!, decodeXmlAttr(a[2] ?? a[3] ?? ""));
    const csize = Number(attrs.get("CompressedSize"));
    const ck = attrs.get("Checksum");
    entries.push({
      name: attrs.get("Name") ?? "",
      size: Number(attrs.get("Size")),
      csize,
      checksum: ck === undefined || ck === "" ? null : parseInt(ck, 16) >>> 0,
      algorithm: Number(attrs.get("Algorithm") ?? "0"),
      offset,
    });
    offset += csize;
  }
  return entries;
}

export class KomArchive {
  readonly entries: readonly KomEntry[];
  /** file offset one past the last entry — equals the file size for a well-formed archive */
  readonly end: number;
  readonly fileCount: number;
  readonly compressed: boolean;
  readonly version: string;
  private readonly byName = new Map<string, KomEntry>();

  private constructor(
    readonly source: ByteSource,
    entries: KomEntry[],
    meta: { fileCount: number; compressed: boolean; version: string; end: number },
  ) {
    this.entries = entries;
    this.end = meta.end;
    this.fileCount = meta.fileCount;
    this.compressed = meta.compressed;
    this.version = meta.version;
    for (const e of entries) this.byName.set(e.name.toUpperCase(), e);
  }

  static async open(source: ByteSource): Promise<KomArchive> {
    const head = await source.read(0, HEADER_SIZE);
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let magicEnd = 0;
    while (magicEnd < 0x34 && head[magicEnd] !== 0) magicEnd++;
    const magic = new TextDecoder("latin1").decode(head.subarray(0, magicEnd));
    if (!magic.startsWith(KOM_MAGIC_PREFIX)) throw new Error(`not a KOM archive (magic "${magic}")`);
    const version = magic.slice(KOM_MAGIC_PREFIX.length).replace(/\.$/, "");
    if (version !== "0.3") throw new Error(`unsupported KOM version ${version} (only V.0.3 occurs in this client)`);
    const fileCount = dv.getUint32(0x34, true);
    const compressed = head[0x38] !== 0;
    const xmlSize = dv.getUint32(0x44, true);
    const xml = new TextDecoder("utf-8").decode(await source.read(HEADER_SIZE, xmlSize));
    const dataStart = HEADER_SIZE + xmlSize;
    const entries = parseManifest(xml, dataStart);
    if (entries.length !== fileCount) throw new Error(`KOM manifest lists ${entries.length} files, header says ${fileCount}`);
    const last = entries[entries.length - 1];
    const end = last ? last.offset + last.csize : dataStart;
    return new KomArchive(source, entries, { fileCount, compressed, version, end });
  }

  find(name: string): KomEntry | undefined {
    return this.byName.get(name.toUpperCase());
  }

  /** The stored bytes exactly as they sit in the archive. */
  readStored(entry: KomEntry): Promise<Uint8Array> {
    return this.source.read(entry.offset, entry.csize);
  }

  /** Decodes stored bytes of `entry` (decrypt if algorithm 2, then inflate). */
  decode(entry: KomEntry, stored: Uint8Array): Uint8Array {
    let data = stored;
    if (entry.algorithm === 2) data = xorCrcDecrypt(data, entry.name, entry.csize);
    else if (entry.algorithm !== 0) throw new Error(`unknown KOM algorithm ${entry.algorithm} for ${entry.name}`);
    return this.compressed ? unzlibSync(data, { out: new Uint8Array(entry.size) }) : data;
  }

  async read(entry: KomEntry): Promise<Uint8Array> {
    return this.decode(entry, await this.readStored(entry));
  }

  /** Adler-32 integrity check of stored bytes against the manifest (true when no checksum is recorded). */
  verifyStored(entry: KomEntry, stored: Uint8Array): boolean {
    return entry.checksum === null || adler32(stored) === entry.checksum;
  }
}
