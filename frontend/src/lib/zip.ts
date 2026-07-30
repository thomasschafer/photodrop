/**
 * Minimal ZIP writer (store method, no compression) for the group photo
 * export. Photos are already JPEG/WebP-compressed, so deflating them again
 * buys nothing — storing keeps this dependency-free and streaming-simple.
 */

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

// DOS date/time epoch floor: ZIP has no timezone story worth having, and the
// archive contents carry their own timestamps in the manifest.
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01

export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let offset = 0;

  const centralRecords: Array<{
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    localOffset: number;
  }> = [];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const header = new ArrayBuffer(30);
    const view = new DataView(header);
    writeUint32(view, 0, 0x04034b50); // local file header signature
    writeUint16(view, 4, 20); // version needed
    writeUint16(view, 6, 0x0800); // UTF-8 names
    writeUint16(view, 8, 0); // store
    writeUint16(view, 10, DOS_TIME);
    writeUint16(view, 12, DOS_DATE);
    writeUint32(view, 14, crc);
    writeUint32(view, 18, entry.data.length);
    writeUint32(view, 22, entry.data.length);
    writeUint16(view, 26, nameBytes.length);
    writeUint16(view, 28, 0); // extra length

    centralRecords.push({ nameBytes, crc, size: entry.data.length, localOffset: offset });
    localParts.push(header, nameBytes, entry.data);
    offset += 30 + nameBytes.length + entry.data.length;
  }

  let centralSize = 0;
  for (const record of centralRecords) {
    const header = new ArrayBuffer(46);
    const view = new DataView(header);
    writeUint32(view, 0, 0x02014b50); // central directory signature
    writeUint16(view, 4, 20); // version made by
    writeUint16(view, 6, 20); // version needed
    writeUint16(view, 8, 0x0800); // UTF-8 names
    writeUint16(view, 10, 0); // store
    writeUint16(view, 12, DOS_TIME);
    writeUint16(view, 14, DOS_DATE);
    writeUint32(view, 16, record.crc);
    writeUint32(view, 20, record.size);
    writeUint32(view, 24, record.size);
    writeUint16(view, 28, record.nameBytes.length);
    // extra, comment, disk, internal attrs, external attrs all zero
    writeUint32(view, 42, record.localOffset);

    centralParts.push(header, record.nameBytes);
    centralSize += 46 + record.nameBytes.length;
  }

  const end = new ArrayBuffer(22);
  const endView = new DataView(end);
  writeUint32(endView, 0, 0x06054b50); // end of central directory signature
  writeUint16(endView, 8, centralRecords.length);
  writeUint16(endView, 10, centralRecords.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
