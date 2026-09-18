import fs from 'node:fs/promises';
import sharp from '../../node_modules/sharp/dist/index.mjs';

const files = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
];

await fs.rm('AppIcon.iconset', { recursive: true, force: true });
await fs.mkdir('AppIcon.iconset');
await Promise.all(files.map(([name, size]) => sharp('app-icon.svg').resize(size, size).png().toFile(`AppIcon.iconset/${name}`)));

const chunks = [
  ['icp4', 'icon_16x16.png'],
  ['icp5', 'icon_32x32.png'],
  ['icp6', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'],
  ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'],
  ['ic11', 'icon_16x16@2x.png'],
  ['ic12', 'icon_32x32@2x.png'],
  ['ic13', 'icon_128x128@2x.png'],
  ['ic14', 'icon_256x256@2x.png']
];
const payloads = await Promise.all(chunks.map(async ([type, name]) => {
  const png = await fs.readFile(`AppIcon.iconset/${name}`);
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
}));
const total = 8 + payloads.reduce((sum, chunk) => sum + chunk.length, 0);
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(total, 4);
await fs.writeFile('AppIcon.icns', Buffer.concat([header, ...payloads]));
