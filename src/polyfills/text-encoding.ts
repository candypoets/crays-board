import { getRandomValues } from "expo-crypto";

class SimpleTextEncoder {
  encode(input = ""): Uint8Array {
    const bytes: number[] = [];

    for (let index = 0; index < input.length; index += 1) {
      let codePoint = input.charCodeAt(index);
      if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < input.length) {
        const next = input.charCodeAt(++index);
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
      }

      if (codePoint < 0x80) {
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
      } else if (codePoint < 0x10000) {
        bytes.push(
          0xe0 | (codePoint >> 12),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      } else {
        bytes.push(
          0xf0 | (codePoint >> 18),
          0x80 | ((codePoint >> 12) & 0x3f),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      }
    }

    return new Uint8Array(bytes);
  }
}

class SimpleTextDecoder {
  decode(input?: ArrayBuffer | ArrayBufferView | null): string {
    if (!input) return "";

    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let output = "";

    for (let index = 0; index < bytes.length; index += 1) {
      const first = bytes[index]!;
      if (first < 0x80) {
        output += String.fromCharCode(first);
      } else if ((first & 0xe0) === 0xc0) {
        const second = bytes[++index] ?? 0;
        output += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
      } else if ((first & 0xf0) === 0xe0) {
        const second = bytes[++index] ?? 0;
        const third = bytes[++index] ?? 0;
        output += String.fromCharCode(
          ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f),
        );
      } else {
        const second = bytes[++index] ?? 0;
        const third = bytes[++index] ?? 0;
        const fourth = bytes[++index] ?? 0;
        const codePoint =
          ((first & 0x07) << 18) |
          ((second & 0x3f) << 12) |
          ((third & 0x3f) << 6) |
          (fourth & 0x3f);
        output += String.fromCodePoint(codePoint);
      }
    }

    return output;
  }
}

const runtime = globalThis as unknown as {
  crypto?: {
    getRandomValues?: typeof getRandomValues;
  };
  TextEncoder?: typeof SimpleTextEncoder;
  TextDecoder?: typeof SimpleTextDecoder;
};

if (typeof runtime.crypto === "undefined") {
  runtime.crypto = { getRandomValues };
} else if (typeof runtime.crypto.getRandomValues === "undefined") {
  runtime.crypto.getRandomValues = getRandomValues;
}

if (typeof runtime.TextEncoder === "undefined") {
  runtime.TextEncoder = SimpleTextEncoder;
}

if (typeof runtime.TextDecoder === "undefined") {
  runtime.TextDecoder = SimpleTextDecoder;
}
