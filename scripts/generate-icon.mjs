import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SIZE = 128;
const BACKGROUND = [0x0e, 0x63, 0x9c, 0xff];
const BUBBLE = [0xff, 0xff, 0xff, 0xff];
const ACCENT = [0x0e, 0x63, 0x9c, 0xff];

const pixels = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, [r, g, b, a]) {
  const offset = (y * SIZE + x) * 4;
  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = a;
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }

  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

// Speech bubble tail pointing to the lower left.
function insideTail(x, y) {
  return y >= 84 && y <= 104 && x >= 30 && x <= 52 && x - 30 >= (y - 84) * 0.9;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (insideRoundedRect(x, y, 6, 6, 121, 121, 26)) {
      setPixel(x, y, BACKGROUND);
    }
  }
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (insideRoundedRect(x, y, 24, 26, 104, 88, 16) || insideTail(x, y)) {
      setPixel(x, y, BUBBLE);
    }
  }
}

// Identifier segments inside the bubble.
for (const [left, right] of [
  [38, 58],
  [64, 78],
  [84, 92],
]) {
  for (let y = 44; y <= 52; y++) {
    for (let x = left; x <= right; x++) {
      if (insideRoundedRect(x, y, left, 44, right, 52, 4)) {
        setPixel(x, y, ACCENT);
      }
    }
  }
}

for (const [left, right] of [
  [38, 50],
  [56, 84],
]) {
  for (let y = 62; y <= 70; y++) {
    for (let x = left; x <= right; x++) {
      if (insideRoundedRect(x, y, left, 62, right, 70, 4)) {
        setPixel(x, y, ACCENT);
      }
    }
  }
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const target = path.resolve(import.meta.dirname, "..", "images", "icon.png");
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, png);
process.stdout.write(`Wrote ${target} (${png.length} bytes)\n`);
