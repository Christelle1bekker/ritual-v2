#!/usr/bin/env node
/**
 * Wave 5: PWA Icon Generator
 * Generates all required icon sizes from an SVG template using sharp.
 * Run: node scripts/generate-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

// Brand colours
const BG = '#C17B4E';   // terracotta
const FG = '#FFFFFF';   // white

/**
 * Build an SVG for the given size.
 * Draws a white ◈ symbol: outer diamond + inner diamond cutout.
 */
function makeSVG(size) {
  const c = size / 2;           // center
  const outer = size * 0.36;   // outer diamond half-width
  const inner = size * 0.15;   // inner diamond half-width
  const strokeW = size * 0.055; // stroke thickness for rounded feel

  // Outer diamond (white filled, terracotta stroke to smooth edges)
  const od = outer;
  const id2 = inner;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" rx="${size * 0.18}"/>
  <!-- Outer diamond -->
  <polygon
    points="${c},${c - od} ${c + od},${c} ${c},${c + od} ${c - od},${c}"
    fill="${FG}"
  />
  <!-- Inner diamond cutout (terracotta = removes the middle) -->
  <polygon
    points="${c},${c - id2} ${c + id2},${c} ${c},${c + id2} ${c - id2},${c}"
    fill="${BG}"
  />
</svg>`;
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// iOS-specific icon sizes for Xcode asset catalog
const iosSizes = [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024];

async function generate() {
  // Standard PWA icon sizes
  for (const size of sizes) {
    const svg = Buffer.from(makeSVG(size));
    const outPath = path.join(iconsDir, `icon-${size}x${size}.png`);
    await sharp(svg).png().toFile(outPath);
    console.log(`  ✓ icon-${size}x${size}.png`);
  }

  // iOS-specific icon sizes
  for (const size of iosSizes) {
    const svg = Buffer.from(makeSVG(size));
    const outPath = path.join(iconsDir, `icon-${size}x${size}.png`);
    await sharp(svg).png().toFile(outPath);
    console.log(`  ✓ icon-${size}x${size}.png (iOS)`);
  }

  // apple-touch-icon (180x180) goes in public/
  const svg180 = Buffer.from(makeSVG(180));
  const applePath = path.join(__dirname, '../public/apple-touch-icon.png');
  await sharp(svg180).png().toFile(applePath);
  console.log('  ✓ apple-touch-icon.png (180x180)');

  // favicon.ico — use a 32x32 PNG named favicon.png (browsers accept PNG favicons)
  const svg32 = Buffer.from(makeSVG(32));
  const faviconPath = path.join(__dirname, '../public/favicon.png');
  await sharp(svg32).png().toFile(faviconPath);
  console.log('  ✓ favicon.png (32x32)');

  console.log('\nAll icons generated successfully.');
}

generate().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
