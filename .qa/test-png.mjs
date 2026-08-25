import { deflateSync } from 'node:zlib';
import { pngCrc32 } from './png-evidence.mjs';

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(pngCrc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

/** Small compressed 1-bit grayscale PNG with arbitrary evidence dimensions. */
export function makeTestPng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1;
  ihdr[9] = 0;
  const rowBytes = Math.ceil(width / 8);
  const raw = Buffer.alloc(height * (rowBytes + 1));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
