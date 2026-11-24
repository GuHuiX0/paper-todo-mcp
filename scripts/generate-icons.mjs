import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconsDir = path.join(root, 'desktop', 'win-native');
fs.mkdirSync(iconsDir, { recursive: true });

// --- Minimal pure-Node RGBA PNG + ICO encoder ---
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const bodies = [];
  for (let i = 0; i < count; i++) {
    const { size, png } = entries[i];
    const base = 6 + i * 16;
    header[base] = size >= 256 ? 0 : size;
    header[base + 1] = size >= 256 ? 0 : size;
    header[base + 2] = 0;
    header[base + 3] = 0;
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(png.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += png.length;
    bodies.push(png);
  }
  return Buffer.concat([header, ...bodies]);
}

// --- Anti-aliased SDF renderer for minimalist paper stationery icon ---
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return out + inside - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function blendPixel(buf, idx, r, g, b, a) {
  if (a <= 0) return;
  const sa = clamp(a, 0, 1);
  const da = buf[idx + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  buf[idx] = Math.round((r * sa + buf[idx] * da * (1 - sa)) / outA);
  buf[idx + 1] = Math.round((g * sa + buf[idx + 1] * da * (1 - sa)) / outA);
  buf[idx + 2] = Math.round((b * sa + buf[idx + 2] * da * (1 - sa)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function renderPaperIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.25 / size;

  for (let y = 0; y < size; y++) {
    const ny = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const idx = (y * size + x) * 4;

      // Soft warm shadow beneath paper card
      const dShadow = sdRoundedBox(nx, ny, 0.5, 0.525, 0.355, 0.405, 0.085);
      const shadowAlpha = (1 - smoothstep(-0.01, 0.05, dShadow)) * 0.18;
      blendPixel(rgba, idx, 38, 30, 22, shadowAlpha);

      // Warm cotton paper card (#FBF8F1)
      const dCard = sdRoundedBox(nx, ny, 0.5, 0.5, 0.35, 0.40, 0.085);
      const fillAlpha = 1 - smoothstep(-aa, aa, dCard);
      blendPixel(rgba, idx, 251, 248, 241, fillAlpha);

      // Crisp dark charcoal ink border (#3A352F)
      const borderWidth = 0.024;
      const dBorder = Math.abs(dCard) - borderWidth * 0.5;
      const borderAlpha = 1 - smoothstep(-aa, aa, dBorder);
      blendPixel(rgba, idx, 58, 53, 47, borderAlpha);

      // Inside card details
      if (dCard < -0.015) {
        // Subtle vertical terracotta margin rule
        const dMargin = Math.abs(nx - 0.335) - 0.008;
        if (ny > 0.14 && ny < 0.86) {
          const mAlpha = (1 - smoothstep(-aa, aa, dMargin)) * 0.55;
          blendPixel(rgba, idx, 206, 134, 114, mAlpha);
        }

        // Ruled horizontal ink lines
        const l1 = sdSegment(nx, ny, 0.405, 0.34, 0.75, 0.34) - 0.022;
        blendPixel(rgba, idx, 48, 43, 38, 1 - smoothstep(-aa, aa, l1));

        const l2 = sdSegment(nx, ny, 0.405, 0.52, 0.72, 0.52) - 0.019;
        blendPixel(rgba, idx, 128, 120, 110, 1 - smoothstep(-aa, aa, l2));

        const l3 = sdSegment(nx, ny, 0.405, 0.69, 0.65, 0.69) - 0.019;
        blendPixel(rgba, idx, 166, 158, 146, 1 - smoothstep(-aa, aa, l3));

        // Vermilion ink checkmark on line 1 (#B84A39)
        const c1 = sdSegment(nx, ny, 0.215, 0.345, 0.255, 0.388) - 0.023;
        const c2 = sdSegment(nx, ny, 0.255, 0.388, 0.335, 0.295) - 0.023;
        const dCheck = Math.min(c1, c2);
        blendPixel(rgba, idx, 184, 74, 57, 1 - smoothstep(-aa, aa, dCheck));

        // Subtle ink dots for lines 2 and 3
        const dot2 = Math.abs(Math.hypot(nx - 0.255, ny - 0.52) - 0.024) - 0.010;
        blendPixel(rgba, idx, 118, 110, 100, 1 - smoothstep(-aa, aa, dot2));

        const dot3 = Math.abs(Math.hypot(nx - 0.255, ny - 0.69) - 0.024) - 0.010;
        blendPixel(rgba, idx, 156, 148, 138, 1 - smoothstep(-aa, aa, dot3));
      }
    }
  }

  return encodePng(size, size, rgba);
}

const sizes = [16, 32, 48, 128, 256];
const pngs = new Map();
for (const s of sizes) {
  pngs.set(s, renderPaperIcon(s));
}

fs.writeFileSync(
  path.join(iconsDir, 'icon.ico'),
  encodeIco([
    { size: 16, png: pngs.get(16) },
    { size: 32, png: pngs.get(32) },
    { size: 48, png: pngs.get(48) },
    { size: 256, png: pngs.get(256) },
  ])
);

console.log(`Generated native Windows icon at ${path.join(iconsDir, 'icon.ico')}`);
