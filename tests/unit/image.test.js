import { describe, it, expect } from 'vitest';
import { imageDpi, jpegOrientation } from '../../src/core/image.js';
import { deflateSync, crc32 } from 'node:zlib';

const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t, 'latin1'), d])) >>> 0, 8 + d.length); return b; };
const png = dpi => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (dpi) { const p = Buffer.alloc(9); p.writeUInt32BE(Math.round(dpi / 0.0254)); p.writeUInt32BE(Math.round(dpi / 0.0254), 4); p[8] = 1; parts.push(chunk('pHYs', p)); }
  parts.push(chunk('IDAT', deflateSync(Buffer.alloc(14))), chunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
};
const jfif = (unit, d) => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, unit, d >> 8, d & 255, d >> 8, d & 255, 0, 0, 0xFF, 0xD9]);
const exif = o => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0xFF, 0xD9]);

describe('imageDpi', () => {
  it('reads PNG pHYs', () => { expect(imageDpi(png(350))).toBeCloseTo(350, 0); });
  it('is null for a PNG without density', () => { expect(imageDpi(png(null))).toBeNull(); });
  it('reads JFIF in dots per inch and per cm', () => {
    expect(imageDpi(jfif(1, 300))).toBe(300);
    expect(imageDpi(jfif(2, 118))).toBeCloseTo(299.7, 1);
  });
});
describe('jpegOrientation', () => {
  it('reads the EXIF orientation tag', () => { expect(jpegOrientation(exif(6))).toBe(6); });
  it('is 1 without EXIF', () => { expect(jpegOrientation(jfif(1, 72))).toBe(1); });
});
