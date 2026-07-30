import { describe, it, expect } from 'vitest';
import { createZip, crc32 } from './zip';

describe('crc32', () => {
  it('matches the standard test vector', () => {
    // CRC-32 of "123456789" is the canonical check value 0xCBF43926.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('createZip', () => {
  async function bytes(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer());
  }

  it('produces a structurally valid archive for multiple entries', async () => {
    const a = new TextEncoder().encode('hello');
    const b = new TextEncoder().encode('world!');
    const zip = await bytes(
      createZip([
        { name: 'a.txt', data: a },
        { name: 'dir/b.txt', data: b },
      ])
    );

    const view = new DataView(zip.buffer);
    // Two local file headers, in order.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const secondLocal = 30 + 'a.txt'.length + a.length;
    expect(view.getUint32(secondLocal, true)).toBe(0x04034b50);

    // End-of-central-directory record sits at the tail with the right count.
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 8, true)).toBe(2);

    // Central directory offset and size line up with the actual layout.
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    expect(centralOffset + centralSize).toBe(eocd);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);

    // Stored bytes appear verbatim.
    const text = new TextDecoder().decode(zip);
    expect(text).toContain('hello');
    expect(text).toContain('world!');
  });

  it('records each entry crc and size in its local header', async () => {
    const data = new TextEncoder().encode('123456789');
    const zip = await bytes(createZip([{ name: 'n', data }]));
    const view = new DataView(zip.buffer);

    expect(view.getUint32(14, true)).toBe(0xcbf43926);
    expect(view.getUint32(18, true)).toBe(9);
    expect(view.getUint32(22, true)).toBe(9);
  });
});
