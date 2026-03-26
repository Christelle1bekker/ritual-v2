const sharp = require('sharp');
const path = require('path');

const size = 2732;
const c = size / 2;
const logoSize = 300;
const outer = logoSize * 0.36;
const inner = logoSize * 0.15;
const lc = logoSize / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#F2EDE7"/>
  <g transform="translate(${c - lc}, ${c - lc})">
    <polygon points="${lc},${lc - outer} ${lc + outer},${lc} ${lc},${lc + outer} ${lc - outer},${lc}" fill="#C17B4E"/>
    <polygon points="${lc},${lc - inner} ${lc + inner},${lc} ${lc},${lc + inner} ${lc - inner},${lc}" fill="#F2EDE7"/>
  </g>
</svg>`;

sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, '../public/splash.png'))
  .then(() => console.log('✓ splash.png generated (2732x2732)'))
  .catch(err => { console.error(err); process.exit(1); });
