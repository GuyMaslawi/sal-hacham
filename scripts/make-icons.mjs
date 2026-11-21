// Renders every app icon from one drawing: the web app's, the Android app's and the Play Store's.
// Run with `npm run icons` after changing the design.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const YELLOW = '#ffd60a';
const INK = '#15171c';

// A shopping basket with a tick: "the list, checked against real prices".
const handles = `<path d="M176 232 224 136M336 232 288 136" stroke="${INK}" stroke-width="30" stroke-linecap="round" fill="none"/>`;
const body = `<path d="M112 216H400a16 16 0 0 1 15.6 19.5L388 360a40 40 0 0 1-39 31H163a40 40 0 0 1-39-31L96.4 235.500A16 16 0 0 1 112 216Z" fill="${INK}"/>`;
const tick = (colour) =>
  `<path d="M200 300 240 338 316 262" stroke="${colour}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
const basket = handles + body + tick(YELLOW);

const place = (scale, drawing) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -264)">${drawing}</g>`;
const svg = (radius, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${YELLOW}"/>
  ${place(scale, basket)}
</svg>`;
/** The drawing alone on a transparent canvas. */
const bare = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${place(scale, basket)}</svg>`;
/** One colour with the tick cut out, for Android's themed icons. */
const monochrome = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><mask id="m"><rect width="512" height="512" fill="#fff"/>${place(scale, tick('#000'))}</mask></defs>
  <g mask="url(#m)">${place(scale, handles + body)}</g>
</svg>`;

const rounded = svg(112, 1);
const fullBleed = svg(0, 0.78); // maskable icons keep the drawing inside the safe zone

const png = (source, size, file) => {
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  return sharp(Buffer.from(source)).resize(size, size).png().toFile(file);
};

writeFileSync('public/icon.svg', rounded);
const jobs = [
  png(rounded, 192, 'public/pwa-192.png'),
  png(rounded, 512, 'public/pwa-512.png'),
  png(fullBleed, 512, 'public/pwa-maskable-512.png'),
  png(svg(0, 0.9), 180, 'public/apple-touch-icon.png'),
  // Google Play rounds the corners itself, so its icon is a full square.
  png(svg(0, 0.88), 512, 'store/icon-512.png'),
];

// Android: a classic icon for old phones, an adaptive one (108dp canvas, of which the middle
// 72dp shows) with a themed variant, and the splash picture shown while the app opens.
const RES = 'android/app/src/main/res';
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, factor] of Object.entries(DENSITIES)) {
  jobs.push(
    png(rounded, 48 * factor, `${RES}/mipmap-${density}/ic_launcher.png`),
    png(bare(0.74), 108 * factor, `${RES}/mipmap-${density}/ic_launcher_foreground.png`),
    png(monochrome(0.74), 108 * factor, `${RES}/mipmap-${density}/ic_launcher_monochrome.png`),
    png(bare(1.11), 160 * factor, `${RES}/drawable-${density}/splash.png`),
  );
}

await Promise.all(jobs);
console.log('Icons written to public/, store/ and android/');
