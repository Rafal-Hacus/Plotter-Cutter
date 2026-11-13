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
  it('marks names with letters outside ASCII as UTF-8, and leaves plain names as they were', async () => {
    const flagsOf = async name => new DataView(await makeZip([{ name, text: 'IN @;' }]).arrayBuffer()).getUint16(6, true);
    expect(await flagsOf('kiss.plt')).toBe(0);
    expect(await flagsOf('żółw-kiss.plt')).toBe(0x0800);
    const got = await readZipPlts(await makeZip([{ name: 'żółw-kiss.plt', text: 'IN @;' }]).arrayBuffer());
    expect(got[0].name).toBe('żółw-kiss.plt');
  });
  it('rejects something that is not a zip', async () => {
    await expect(readZipPlts(new ArrayBuffer(100))).rejects.toThrow('Not a zip');
  });
});
