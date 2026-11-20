// Renders the app icons from one drawing. Run with `npm run icons` after changing the design.
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const YELLOW = '#ffd60a';
const INK = '#15171c';

// A shopping basket with a tick: "the list, checked against real prices".
const basket = `
  <path d="M176 232 224 136M336 232 288 136" stroke="${INK}" stroke-width="30" stroke-linecap="round" fill="none"/>
  <path d="M112 216H400a16 16 0 0 1 15.6 19.5L388 360a40 40 0 0 1-39 31H163a40 40 0 0 1-39-31L96.4 235.500A16 16 0 0 1 112 216Z" fill="${INK}"/>
  <path d="M200 300 240 338 316 262" stroke="${YELLOW}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

const svg = (radius, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${YELLOW}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -264)">${basket}</g>
</svg>`;

const rounded = svg(112, 1);
const fullBleed = svg(0, 0.78); // maskable icons keep the drawing inside the safe zone

writeFileSync('public/icon.svg', rounded);
const png = (source, size, file) => sharp(Buffer.from(source)).resize(size, size).png().toFile(`public/${file}`);
await Promise.all([
  png(rounded, 192, 'pwa-192.png'),
  png(rounded, 512, 'pwa-512.png'),
  png(fullBleed, 512, 'pwa-maskable-512.png'),
  png(svg(0, 0.9), 180, 'apple-touch-icon.png'),
]);
console.log('Icons written to public/');
