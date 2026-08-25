import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePng } from './png-evidence.mjs';
import { makeTestPng } from './test-png.mjs';

test('decodes a structurally valid PNG through zlib scanlines', () => {
  const decoded = decodePng(makeTestPng(1080, 2400), 'fixture');
  assert.equal(decoded.width, 1080);
  assert.equal(decoded.height, 2400);
});

test('rejects a header-only PNG that claims dimensions without decodable pixels', () => {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(1080, 16);
  bytes.writeUInt32BE(2400, 20);
  assert.throws(() => decodePng(bytes, 'header-only'), /not a PNG|truncated|missing/);
});

test('rejects valid compressed pixels when a chunk CRC is corrupted', () => {
  const bytes = makeTestPng(8, 8);
  bytes[29] ^= 0xff;
  assert.throws(() => decodePng(bytes, 'corrupt'), /invalid IHDR CRC/);
});
