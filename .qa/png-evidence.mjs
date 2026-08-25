import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

export function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function samplesPerPixel(colorType) {
  return new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
}

function validBitDepth(bitDepth, colorType) {
  const allowed = new Map([
    [0, [1, 2, 4, 8, 16]],
    [2, [8, 16]],
    [3, [1, 2, 4, 8]],
    [4, [8, 16]],
    [6, [8, 16]],
  ]).get(colorType);
  return allowed?.includes(bitDepth) ?? false;
}

function scanlineLength(width, bitDepth, colorType) {
  return Math.ceil((width * bitDepth * samplesPerPixel(colorType)) / 8);
}

function passSize(size, start, step) {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

function expectedInflatedSize(width, height, bitDepth, colorType, interlace) {
  if (interlace === 0) return height * (1 + scanlineLength(width, bitDepth, colorType));
  const passes = [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
    [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
  ];
  return passes.reduce((total, [x, y, dx, dy]) => {
    const passWidth = passSize(width, x, dx);
    const passHeight = passSize(height, y, dy);
    return total + (passWidth && passHeight ? passHeight * (1 + scanlineLength(passWidth, bitDepth, colorType)) : 0);
  }, 0);
}

function validateFilters(inflated, width, height, bitDepth, colorType, interlace) {
  let offset = 0;
  const validatePass = (passWidth, passHeight) => {
    const rowBytes = scanlineLength(passWidth, bitDepth, colorType);
    for (let row = 0; row < passHeight; row += 1) {
      if (inflated[offset] > 4) throw new Error(`invalid PNG scanline filter ${inflated[offset]}`);
      offset += 1 + rowBytes;
    }
  };
  if (interlace === 0) validatePass(width, height);
  else {
    for (const [x, y, dx, dy] of [
      [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
      [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
    ]) {
      const passWidth = passSize(width, x, dx);
      const passHeight = passSize(height, y, dy);
      if (passWidth && passHeight) validatePass(passWidth, passHeight);
    }
  }
}

/** Parse, CRC-check, inflate, and validate the scanline framing of one PNG. */
export function decodePng(bytes, label = 'PNG') {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${label} is not a PNG`);

  let offset = 8;
  let ihdr = null;
  let sawIend = false;
  const idat = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error(`${label} has a truncated PNG chunk`);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (crcOffset + 4 > bytes.length) throw new Error(`${label} has a truncated ${type || 'unknown'} chunk`);
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = pngCrc32(bytes.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) throw new Error(`${label} has an invalid ${type} CRC`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (!ihdr && type !== 'IHDR') throw new Error(`${label} does not start with IHDR`);
    if (type === 'IHDR') {
      if (ihdr || length !== 13) throw new Error(`${label} has an invalid IHDR`);
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
      if (!ihdr.width || !ihdr.height) throw new Error(`${label} has zero dimensions`);
      if (!validBitDepth(ihdr.bitDepth, ihdr.colorType)) throw new Error(`${label} has an invalid bit-depth/color-type pair`);
      if (ihdr.compression !== 0 || ihdr.filter !== 0 || ![0, 1].includes(ihdr.interlace)) {
        throw new Error(`${label} uses unsupported PNG encoding fields`);
      }
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') {
      if (length !== 0) throw new Error(`${label} has an invalid IEND`);
      sawIend = true;
      offset = crcOffset + 4;
      break;
    }
    offset = crcOffset + 4;
  }
  if (!ihdr || idat.length === 0 || !sawIend) throw new Error(`${label} is missing required PNG chunks`);
  if (offset !== bytes.length) throw new Error(`${label} has trailing bytes after IEND`);

  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch (error) {
    throw new Error(`${label} has invalid compressed image data: ${error.message}`);
  }
  const expected = expectedInflatedSize(ihdr.width, ihdr.height, ihdr.bitDepth, ihdr.colorType, ihdr.interlace);
  if (inflated.length !== expected) {
    throw new Error(`${label} decoded to ${inflated.length} bytes; expected ${expected}`);
  }
  validateFilters(inflated, ihdr.width, ihdr.height, ihdr.bitDepth, ihdr.colorType, ihdr.interlace);
  return ihdr;
}
