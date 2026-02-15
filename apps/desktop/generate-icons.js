#!/usr/bin/env node
/**
 * Generate MoA desktop app icons from SVG using sharp.
 * Creates PNG at various sizes + ICO for Windows.
 * (macOS ICNS requires iconutil which is macOS-only)
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ICONS_DIR = path.join(__dirname, "icons");
const SVG_PATH = path.join(ICONS_DIR, "icon.svg");
const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

async function main() {
  const svgBuffer = fs.readFileSync(SVG_PATH);
  console.log("Generating MoA desktop app icons...");

  // Generate PNGs at all sizes
  for (const size of SIZES) {
    const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`  Created icon-${size}.png`);
  }

  // Main icon.png (256x256)
  fs.copyFileSync(
    path.join(ICONS_DIR, "icon-256.png"),
    path.join(ICONS_DIR, "icon.png"),
  );
  console.log("  Created icon.png (256x256)");

  // Tray icon (16x16)
  fs.copyFileSync(
    path.join(ICONS_DIR, "icon-16.png"),
    path.join(__dirname, "tray-icon.png"),
  );
  console.log("  Created tray-icon.png (16x16)");

  // Windows ICO: multi-resolution icon file
  // ICO format: header + directory entries + image data
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];
  for (const size of icoSizes) {
    const buf = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push({ size, data: buf });
  }

  const icoBuffer = createIco(pngBuffers);
  fs.writeFileSync(path.join(ICONS_DIR, "icon.ico"), icoBuffer);
  console.log("  Created icon.ico (Windows)");

  console.log("Done! Icons generated in", ICONS_DIR);
}

/**
 * Create a Windows .ico file from PNG buffers.
 * Uses the PNG-in-ICO format (supported since Windows Vista).
 */
function createIco(entries) {
  const numImages = entries.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  let dataOffset = headerSize + dirSize;

  // ICO header: reserved(2) + type(2) + count(2)
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type = 1 (ICO)
  header.writeUInt16LE(numImages, 4);  // image count

  // Directory entries
  const dirEntries = Buffer.alloc(dirSize);
  const imageBuffers = [];

  for (let i = 0; i < numImages; i++) {
    const { size, data } = entries[i];
    const offset = i * dirEntrySize;
    dirEntries.writeUInt8(size >= 256 ? 0 : size, offset);      // width (0 = 256)
    dirEntries.writeUInt8(size >= 256 ? 0 : size, offset + 1);  // height
    dirEntries.writeUInt8(0, offset + 2);                         // color palette
    dirEntries.writeUInt8(0, offset + 3);                         // reserved
    dirEntries.writeUInt16LE(1, offset + 4);                      // color planes
    dirEntries.writeUInt16LE(32, offset + 6);                     // bits per pixel
    dirEntries.writeUInt32LE(data.length, offset + 8);            // image size
    dirEntries.writeUInt32LE(dataOffset, offset + 12);            // data offset

    imageBuffers.push(data);
    dataOffset += data.length;
  }

  return Buffer.concat([header, dirEntries, ...imageBuffers]);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
