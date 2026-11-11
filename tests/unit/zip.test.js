import { describe, it, expect } from 'vitest';
import { makeZip, readZipPlts, crc32 } from '../../src/core/zip.js';

describe('zip', () => {
  it('crc32 of a known string', () => {
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
  it('round-trips PLT files and skips other entries', async () => {
    const blob = makeZip([{ name: 'a-kiss.plt', text: 'IN U0,0 D10,10 @;@;' }, { name: 'notes.txt', text: 'x' }, { name: 'b-die.plt', bytes: new TextEncoder().encode('IN U1,1 @;') }]);
    const got = await readZipPlts(await blob.arrayBuffer());
    expect(got).toEqual([{ name: 'a-kiss.plt', text: 'IN U0,0 D10,10 @;@;' }, { name: 'b-die.plt', text: 'IN U1,1 @;' }]);
  });
  it('rejects something that is not a zip', async () => {
    await expect(readZipPlts(new ArrayBuffer(100))).rejects.toThrow('Not a zip');
  });
});
