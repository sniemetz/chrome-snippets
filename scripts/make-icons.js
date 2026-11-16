// Generates placeholder icons: node scripts/make-icons.js
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const outDir = new URL("../extension/icons/", import.meta.url);
const BG = [37, 99, 235, 255];
const FG = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function pixel(x, y, s) {
  const r = s * 0.2;
  const dx = Math.max(r - x, 0, x - (s - 1 - r));
  const dy = Math.max(r - y, 0, y - (s - 1 - r));
  if (dx * dx + dy * dy > r * r) return CLEAR;
  // "{ }" mark: two vertical bars with short serifs, left and right of center
  const u = s / 16;
  const bar = (cx) => Math.abs(x - cx) < Math.max(u * 0.8, 0.6) && y > u * 4 && y < u * 12;
  const serif = (cx, dir) =>
    (y > u * 4 - 0.5 && y < u * 4 + u * 0.9 || y > u * 12 - u * 0.9 && y < u * 12 + 0.5) &&
    (dir < 0 ? x >= cx && x < cx + u * 2.5 : x <= cx && x > cx - u * 2.5);
  const L = u * 5, R = u * 11;
  return bar(L) || bar(R) || serif(L, -1) || serif(R, 1) ? FG : BG;
}

function png(s) {
  const raw = Buffer.alloc((s * 4 + 1) * s);
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0;
    for (let x = 0; x < s; x++) {
      const p = pixel(x, y, s);
      raw.set(p, y * (s * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(new URL(`icon${s}.png`, outDir), png(s));
console.log("icons written");
